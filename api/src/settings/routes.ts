import type { FastifyInstance, FastifyRequest } from 'fastify';
import { BY_KEY, GROUPS, SETTINGS, validate, type SettingValue } from './catalogue.js';
import type { Change, SettingsStore } from './store.js';
import { SecretKeyMissing } from './secret.js';
import { hpodConfigFromValues } from '../hpod/service.js';
import { realConnectivity, smtpFromValues, testEmailRecipients, type Connectivity } from './connectivity.js';
import { marksFromValues, pageSizeFromValues, windowFromValues, type MarksPreviewer } from './preview.js';

/** Who is making the change. There is no sign-in yet, so this is 'system'; Microsoft sign-in will replace this one function. */
/** Who is doing this, for the audit trails: the signed-in user's e-mail address, or 'system' where nobody is signed in (tests, the stub server). */
export function userOf(req: FastifyRequest): string { return req.user?.email || req.user?.name || 'system'; }

async function payload(store: SettingsStore) {
  const [values, sizes, batchCode] = await Promise.all([store.read(), store.envelopeSizes(), store.batchCode()]);
  return {
    groups: GROUPS,
    // A secret (the password) is never sent: its value is empty and `isSet` says whether one is saved.
    settings: SETTINGS.map((s) => ({ ...s, value: s.type === 'secret' ? '' : values[s.key], isSet: s.type === 'secret' ? values[s.key] !== '' : undefined, options: s.type === 'select' ? sizes : undefined })),
    batchCode,
  };
}

/**
 * The saved values with the values on screen laid over them (checked the way a save would check them). `typed` holds a password the user has typed
 * but not saved, in the clear, for the one request that tests with it.
 */
async function overlayValues(store: SettingsStore, input: unknown): Promise<{ values: Record<string, SettingValue>; typed: Record<string, string>; errors: Record<string, string> }> {
  const values = await store.read();
  const typed: Record<string, string> = {}, errors: Record<string, string> = {};
  for (const [key, raw] of Object.entries((input ?? {}) as Record<string, unknown>)) {
    const def = BY_KEY.get(key);
    if (!def) { errors[key] = 'Unknown setting'; continue; }
    const v = validate(def, raw);
    if ('error' in v) errors[key] = v.error;
    else if (def.type === 'secret') typed[key] = v.value as string;
    else values[key] = v.value;
  }
  return { values, typed, errors };
}

export function settingsRoutes(app: FastifyInstance, store: SettingsStore, preview: MarksPreviewer, connectivity: Connectivity = realConnectivity): void {
  app.get('/api/settings', async () => payload(store));

  app.put('/api/settings', async (req, reply) => {
    const body = req.body as { values?: Record<string, unknown> } | null;
    if (!body || typeof body.values !== 'object' || body.values === null) return reply.code(400).send({ error: 'Expected { "values": { ... } }' });
    const current = await store.read();
    const sizes = await store.envelopeSizes();
    const errors: Record<string, string> = {};
    const changes: Change[] = [];
    for (const [key, raw] of Object.entries(body.values)) {
      const def = BY_KEY.get(key);
      if (!def) { errors[key] = 'Unknown setting'; continue; }
      const v = validate(def, raw, def.type === 'select' ? sizes : undefined);
      if ('error' in v) { errors[key] = v.error; continue; }
      if (def.type === 'secret' ? true : v.value !== current[key]) changes.push({ key, oldValue: current[key] as SettingValue, newValue: v.value });
    }
    if (Object.keys(errors).length) return reply.code(422).send({ errors });
    try { await store.update(changes, userOf(req)); }
    catch (e) { if (e instanceof SecretKeyMissing) return reply.code(422).send({ errors: Object.fromEntries(changes.filter((c) => BY_KEY.get(c.key)?.type === 'secret').map((c) => [c.key, e.message])) }); throw e; }
    return { changed: changes.length, ...(await payload(store)) };
  });

  /**
   * A PNG of the page with the control marks and the envelope window where the settings put them. The values in the body (the ones on the
   * screen, saved or not) replace the saved ones, so a position can be checked before it is saved. page: 'window' (default) or 'mrdf'.
   */
  app.post('/api/settings/marks-preview', async (req, reply) => {
    const body = (req.body ?? {}) as { values?: Record<string, unknown>; page?: unknown };
    const page = body.page ?? 'window';
    if (page !== 'window' && page !== 'mrdf') return reply.code(422).send({ errors: { page: 'page must be window or mrdf' } });
    if (body.values !== undefined && (typeof body.values !== 'object' || body.values === null)) return reply.code(400).send({ error: 'Expected { "values": { ... } }' });
    const { values, errors } = await overlayValues(store, body.values);
    if (Object.keys(errors).length) return reply.code(422).send({ errors });
    let png: Uint8Array;
    try { png = await preview(page, marksFromValues(values), windowFromValues(values), pageSizeFromValues(values)); }
    catch (e) { console.error(e); return reply.code(503).send({ error: `The preview could not be drawn: ${(e as Error).message}` }); }
    return reply.header('Content-Type', 'image/png').header('Cache-Control', 'no-store').send(Buffer.from(png));
  });

  /** The password to test with: the one typed on screen, else the saved one. Null when there is none; throws SecretKeyMissing when one is saved but cannot be read. */
  const passwordFor = async (key: string, typed: Record<string, string>): Promise<string | null> => typed[key] ?? store.secret(key);
  const body422 = (reply: import('fastify').FastifyReply, errors: Record<string, string>) => reply.code(422).send({ errors });

  /** Sends a test e-mail to the alert recipients through the mail server on screen. The result is 200 with ok true or false: a refused login is an answer, not an error. */
  app.post('/api/settings/test-email', async (req, reply) => {
    const { values, typed, errors } = await overlayValues(store, (req.body as { values?: unknown } | null)?.values);
    if (Object.keys(errors).length) return body422(reply, errors);
    const to = testEmailRecipients(values);
    if (!to.length) return { ok: false, message: 'There is nobody to send it to. Enter the Alert e-mail recipients on the General tab (the system administrator) and save.' };
    let password: string | null;
    try { password = await passwordFor('smtpPassword', typed); }
    catch (e) { if (e instanceof SecretKeyMissing) return { ok: false, message: e.message }; throw e; }
    const smtp = smtpFromValues(values, password);
    if ('error' in smtp) return { ok: false, message: smtp.error };
    return connectivity.sendTestEmail(smtp.smtp, to);
  });

  /** Signs in to H-POD with the details on screen (POST /authenticate), which tests the address, the network and the credentials. The result is 200 with ok true or false. */
  app.post('/api/settings/test-hpod', async (req, reply) => {
    const { values, typed, errors } = await overlayValues(store, (req.body as { values?: unknown } | null)?.values);
    if (Object.keys(errors).length) return body422(reply, errors);
    let password: string | null;
    try { password = await passwordFor('hpodPassword', typed); }
    catch (e) { if (e instanceof SecretKeyMissing) return { ok: false, message: e.message }; throw e; }
    const { config, missing } = hpodConfigFromValues(values, password);
    return connectivity.testHpod(config, missing);
  });

  /** Removes a saved password (the only way to clear one: an empty value in PUT is refused). */
  app.delete('/api/settings/:key/secret', async (req, reply) => {
    const key = (req.params as { key: string }).key;
    if (BY_KEY.get(key)?.type !== 'secret') return reply.code(404).send({ error: 'Not a secret setting' });
    await store.clearSecret(key, userOf(req));
    return payload(store);
  });

  app.get('/api/settings/audit', async (req) => {
    const n = Number((req.query as { limit?: string }).limit ?? 50);
    return { rows: await store.audit(Number.isInteger(n) && n > 0 ? Math.min(n, 500) : 50) };
  });

  app.put('/api/settings/batch-code', async (req, reply) => {
    const next = (req.body as { next?: unknown } | null)?.next;
    if (typeof next !== 'number' || !Number.isSafeInteger(next) || next < 1) return reply.code(422).send({ errors: { next: 'Next batch code must be a whole number of 1 or more' } });
    const info = await store.batchCode();
    if (info.highestUsed !== null && next <= info.highestUsed) {
      return reply.code(422).send({ errors: { next: `Batch code ${info.highestUsed} has already been used, so the next one must be higher than that` } });
    }
    await store.setNextBatchCode(next, userOf(req));
    return store.batchCode();
  });
}
