import type { FastifyInstance, FastifyRequest } from 'fastify';
import { BY_KEY, GROUPS, SETTINGS, validate, type SettingValue } from './catalogue.js';
import type { Change, SettingsStore } from './store.js';

/** Who is making the change. There is no sign-in yet, so this is 'system'; Microsoft sign-in will replace this one function. */
export function userOf(_req: FastifyRequest): string { return 'system'; }

async function payload(store: SettingsStore) {
  const [values, sizes, batchCode] = await Promise.all([store.read(), store.envelopeSizes(), store.batchCode()]);
  return {
    groups: GROUPS,
    settings: SETTINGS.map((s) => ({ ...s, value: values[s.key], options: s.type === 'select' ? sizes : undefined })),
    batchCode,
  };
}

export function settingsRoutes(app: FastifyInstance, store: SettingsStore): void {
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
      if (v.value !== current[key]) changes.push({ key, oldValue: current[key] as SettingValue, newValue: v.value });
    }
    if (Object.keys(errors).length) return reply.code(422).send({ errors });
    await store.update(changes, userOf(req));
    return { changed: changes.length, ...(await payload(store)) };
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
