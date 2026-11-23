/**
 * The H-POD module's server side: holds the signed-in H-POD session (one token, in memory, never sent to a browser) and runs the operations of
 * operations.ts against H-POD with the sign-in details from Settings > Connectivity. Changing those settings starts a new session.
 */
import { HpodApi, HpodError, type HpodConfig, type HpodRequest, type HpodResult } from '../../../ingest/src/hpod/client.js';
import { submitDocument, type SubmitInput, type SubmitOutcome } from '../../../ingest/src/hpod/submit.js';
import { ValidationError, NotFoundError } from '../errors.js';
import type { SettingValue } from '../settings/catalogue.js';
import type { SettingsStore } from '../settings/store.js';
import { BY_ID, type OperationDef } from './operations.js';

export interface TestResult { ok: boolean; message: string }

export interface SessionStatus {
  /** All the H-POD settings are filled in. */
  configured: boolean;
  /** The labels of the settings still to fill in. */
  missing: string[];
  endpoint: string; instance: string; accountLogin: string; username: string;
  signedIn: boolean; expiresAt: string | null; claims: Record<string, unknown> | null;
}

export interface CallInput {
  operation: string;
  path?: Record<string, string>; query?: Record<string, string>; body?: unknown;
  idempotencyKey?: string; bearerOverride?: string; confirm?: boolean;
}
export interface SubmitRequest {
  options: SubmitInput['options']; fileName: string; /** base-64 */ data: string; commit: SubmitInput['commit']; confirm?: boolean;
}

export interface HpodService {
  status(): Promise<SessionStatus>;
  signIn(): Promise<{ result: HpodResult; status: SessionStatus }>;
  signOut(): Promise<SessionStatus>;
  call(input: CallInput): Promise<{ result: HpodResult; status: SessionStatus }>;
  submit(input: SubmitRequest): Promise<SubmitOutcome>;
}

const FIELDS: Array<[keyof HpodConfig, string, string]> = [['endpoint', 'hpodEndpoint', 'Endpoint'], ['instance', 'hpodInstance', 'Instance'], ['accountLogin', 'hpodAccountCode', 'Account code'], ['emailAddress', 'hpodUsername', 'Username'], ['password', 'hpodPassword', 'Password']];

/** The sign-in details from the settings (the password separately, as it is stored encrypted), and the labels of any that are empty. */
export function hpodConfigFromValues(values: Record<string, SettingValue>, password: string | null): { config: HpodConfig; missing: string[] } {
  const config = { endpoint: '', instance: '', accountLogin: '', emailAddress: '', password: '' } as HpodConfig;
  const missing: string[] = [];
  for (const [field, key, label] of FIELDS) {
    const v = field === 'password' ? password ?? '' : String(values[key] ?? '').trim();
    config[field] = v;
    if (!v) missing.push(label);
  }
  return { config, missing };
}

const stamp = (iso: string): string => `${iso.slice(0, 16).replace('T', ' ')} UTC`;

/** The Settings > Connectivity test: signs in to H-POD with the details given (on screen, saved or not) using POST /authenticate. Never throws. */
export async function testHpodSignIn(config: HpodConfig, missing: string[], deps: { fetch?: typeof fetch; now?: () => number } = {}): Promise<TestResult> {
  if (missing.length) return { ok: false, message: `Enter the ${missing.join(', ')} first.` };
  try {
    const s = await new HpodApi(config, deps).signIn();
    return { ok: true, message: `Signed in to H-POD as ${config.emailAddress} (account ${config.accountLogin}, instance ${config.instance}) in ${s.result.durationMs} ms.${s.expiresAt ? ` The token is valid until ${stamp(s.expiresAt)}.` : ''}` };
  } catch (e) {
    if (e instanceof HpodError) return { ok: false, message: e.message };
    throw e;
  }
}

const sameConfig = (a: HpodConfig, b: HpodConfig): boolean => FIELDS.every(([f]) => a[f] === b[f]);

export class HpodSessions implements HpodService {
  private api: HpodApi | null = null;
  constructor(private readonly settings: SettingsStore, private readonly deps: { fetch?: typeof fetch; now?: () => number } = {}) {}

  /** The session for the settings as they are now. A new one when any of the sign-in details changed. */
  private async current(): Promise<{ api: HpodApi | null; config: HpodConfig; missing: string[] }> {
    const values = await this.settings.read();
    const { config, missing } = hpodConfigFromValues(values, await this.settings.secret('hpodPassword'));
    if (missing.length) { this.api = null; return { api: null, config, missing }; }
    if (!this.api || !sameConfig(this.api.config, config)) this.api = new HpodApi(config, this.deps);
    return { api: this.api, config, missing };
  }

  private statusOf(c: { api: HpodApi | null; config: HpodConfig; missing: string[] }): SessionStatus {
    const s = c.api?.session() ?? null;
    return { configured: c.missing.length === 0, missing: c.missing, endpoint: c.config.endpoint, instance: c.config.instance, accountLogin: c.config.accountLogin, username: c.config.emailAddress,
      signedIn: s !== null, expiresAt: s?.expiresAt ?? null, claims: s?.claims ?? null };
  }

  async status(): Promise<SessionStatus> { return this.statusOf(await this.current()); }

  private async need(): Promise<{ api: HpodApi; c: Awaited<ReturnType<HpodSessions['current']>> }> {
    const c = await this.current();
    if (!c.api) throw new HpodError(`Enter the ${c.missing.join(', ')} on Settings > Connectivity first.`, 'config');
    return { api: c.api, c };
  }

  async signIn(): Promise<{ result: HpodResult; status: SessionStatus }> {
    const { api, c } = await this.need();
    const s = await api.signIn();
    return { result: forBrowser(s.result), status: this.statusOf(c) };
  }

  async signOut(): Promise<SessionStatus> {
    const c = await this.current();
    c.api?.signOut();
    return this.statusOf(c);
  }

  async call(input: CallInput): Promise<{ result: HpodResult; status: SessionStatus }> {
    const op = BY_ID.get(input.operation);
    if (!op) throw new NotFoundError(`There is no H-POD operation called "${input.operation}".`);
    if (op.live && input.confirm !== true) throw new ValidationError({ confirm: `${op.live} Confirm it to go ahead.` });
    const { api, c } = await this.need();
    if (op.auth === 'settings') {
      const s = await api.signIn();
      return { result: forBrowser(s.result), status: this.statusOf(c) };
    }
    const req = buildRequest(op, input, c.config);
    const result = await api.send(req);
    if (op.id === 'authenticateRefresh' && result.ok) {
      const token = (result.body as { token?: unknown } | null)?.token;
      if (typeof token === 'string' && token) api.adoptToken(token);
    }
    return { result: forBrowser(result), status: this.statusOf(c) };
  }

  async submit(input: SubmitRequest): Promise<SubmitOutcome> {
    if (input.confirm !== true) throw new ValidationError({ confirm: 'Submitting sends a job to H-POD, where it can be printed and posted. Confirm it to go ahead.' });
    const { api } = await this.need();
    const data = Buffer.from(input.data, 'base64');
    return submitDocument(api, { options: input.options, file: { name: input.fileName, data }, commit: input.commit });
  }
}

/** The request for an operation from what the page sent, checked against the operation's definition. */
const SECRET_BODY_KEY = /pass(word)?|secret|verifier|^token$|^idptoken$|^code$|refresh_token|access_token|id_token/i;
function maskSecrets(v: unknown, key = ''): unknown {
  if (typeof v === 'string') return SECRET_BODY_KEY.test(key) && v ? '********' : v;
  if (Array.isArray(v)) return v.map((x) => maskSecrets(x, key));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, maskSecrets(x, k)]));
  return v;
}
/** What H-POD said, with any token it handed out hidden: the browser never sees a token (the server holds it). */
function forBrowser(r: HpodResult): HpodResult {
  return typeof r.body === 'object' && r.body !== null ? { ...r, body: maskSecrets(r.body) } : r;
}

export function buildRequest(op: OperationDef, input: CallInput, config: HpodConfig): HpodRequest {
  const errors: Record<string, string> = {};
  let path = op.path;
  for (const p of op.pathParams ?? []) {
    const v = (input.path?.[p.name] ?? '').trim() || (p.fromSettings ? config[p.fromSettings] : '');
    if (!v) errors[p.name] = `${p.label} is required.`;
    path = path.replace(`{${p.name}}`, encodeURIComponent(v));
  }
  const query: Record<string, string> = {};
  for (const q of op.query ?? []) {
    const v = (input.query?.[q.name] ?? '').trim();
    if (!v && q.required) errors[q.name] = `${q.label} is required.`;
    if (v) query[q.name] = v;
  }
  if (Object.keys(errors).length) throw new ValidationError(errors);
  const req: HpodRequest = { method: op.method, path, auth: op.auth === 'none' ? 'none' : 'bearer', idempotencyKey: input.idempotencyKey?.trim() || undefined };
  if (Object.keys(query).length) req.query = query;
  if (input.bearerOverride?.trim() && op.auth === 'bearer') req.bearer = input.bearerOverride.trim();
  if (op.body?.kind === 'json' && input.body !== undefined && input.body !== null) req.json = input.body;
  if (op.body?.kind === 'form') {
    const form: Record<string, string> = {};
    for (const [k, v] of Object.entries((input.body ?? {}) as Record<string, unknown>)) if (v !== null && v !== undefined && String(v) !== '') form[k] = String(v);
    req.form = form;
  }
  return req;
}
