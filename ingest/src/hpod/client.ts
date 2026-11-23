/**
 * A client for the H-POD API (v3, https://api-uk.h-pod.co.uk/v3/docs/). It signs in with POST /authenticate, keeps the bearer token until it is about to
 * expire, signs in again once when H-POD answers 401, and gives back every answer (including errors) as a result to show, never as an exception.
 * Only network failures and a refused sign-in throw (HpodError), because there is nothing to show but the reason.
 *
 * It uses `fetch` only, so a fake one can stand in for tests. Nothing here logs: the password and the token never leave the request.
 */
import { randomUUID } from 'node:crypto';

export interface HpodConfig { endpoint: string; instance: string; accountLogin: string; emailAddress: string; password: string }
export type HpodMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface HpodRequest {
  method: HpodMethod;
  /** After the base address, starting with "/", path parameters already filled in. */
  path: string;
  query?: Record<string, string>;
  json?: unknown;
  /** Sent as multipart/form-data. */
  form?: Record<string, string>;
  auth: 'bearer' | 'none';
  /** Use this token instead of the one this client signed in with. */
  bearer?: string;
  /** For POST, PUT, PATCH and DELETE. One is generated when none is given. */
  idempotencyKey?: string;
}

export interface HpodResult {
  status: number; statusText: string; ok: boolean; durationMs: number;
  headers: Record<string, string>;
  bodyKind: 'json' | 'text' | 'empty';
  body: unknown;
  /** The call as it was sent, with secrets masked and long values shortened. */
  request: { method: string; url: string; headers: Record<string, string>; body?: unknown };
  idempotencyKey?: string;
}

export class HpodError extends Error {
  constructor(message: string, readonly kind: 'network' | 'timeout' | 'auth' | 'throttled' | 'config', readonly retryAfterSeconds?: number) { super(message); }
}

export interface SessionInfo {
  /** ISO time the token stops working, when the token says. */
  expiresAt: string | null;
  claims: Record<string, unknown>;
}

/** The base address: "https://api-uk.h-pod.co.uk" becomes ".../v3"; an address that already has a path is used as it is. No trailing slash. */
export function baseUrl(endpoint: string): string {
  const u = new URL(endpoint.trim());
  const path = u.pathname.replace(/\/+$/, '');
  return `${u.origin}${path === '' ? '/v3' : path}`;
}

/** What is inside a JWT, without checking its signature (only used to show the expiry). Null when it is not a JWT. */
export function jwtClaims(token: string): Record<string, unknown> | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const v = JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch { return null; }
}

const SECRET_KEY = /pass(word)?|secret|verifier|^token$|^idptoken$|^code$|refresh_token|access_token|id_token/i;
/** A copy to show: values of secret-looking keys hidden, long strings (a base-64 file, say) shortened. */
export function maskForDisplay(v: unknown, key = ''): unknown {
  if (typeof v === 'string') {
    if (SECRET_KEY.test(key) && v) return '********';
    return v.length > 200 ? `<${v.length} characters>` : v;
  }
  if (Array.isArray(v)) return v.map((x) => maskForDisplay(x, key));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, maskForDisplay(x, k)]));
  return v;
}

const shortToken = (t: string): string => (t.length > 16 ? `${t.slice(0, 10)}...${t.slice(-4)}` : '********');
const MAX_BODY = 2_000_000;
const SKIP_HEADERS = new Set(['set-cookie', 'set-cookie2']);

export interface HpodDeps { fetch?: typeof fetch; now?: () => number; timeoutMs?: number }

export class HpodApi {
  private token: { value: string; expiresAt: number | null; claims: Record<string, unknown> } | null = null;
  private readonly fetchFn: typeof fetch; private readonly now: () => number; private readonly timeoutMs: number;

  constructor(readonly config: HpodConfig, deps: HpodDeps = {}) {
    this.fetchFn = deps.fetch ?? fetch; this.now = deps.now ?? Date.now; this.timeoutMs = deps.timeoutMs ?? 30_000;
  }

  /** The signed-in session, or null when there is none or it has run out. */
  session(): SessionInfo | null {
    if (!this.token || (this.token.expiresAt !== null && this.now() >= this.token.expiresAt)) return null;
    return { expiresAt: this.token.expiresAt === null ? null : new Date(this.token.expiresAt).toISOString(), claims: this.token.claims };
  }
  signOut(): void { this.token = null; }
  /** Use a token H-POD handed back (after a refresh, say). */
  adoptToken(value: string): void { this.setToken(value); }

  private setToken(value: string): SessionInfo {
    const claims = jwtClaims(value) ?? {};
    const exp = typeof claims['exp'] === 'number' ? claims['exp'] * 1000 : null;
    this.token = { value, expiresAt: exp, claims };
    return this.session() ?? { expiresAt: exp === null ? null : new Date(exp).toISOString(), claims };
  }

  /** POST /authenticate with the configured sign-in details. Throws HpodError (kind auth, throttled, network...) with a message to show. */
  async signIn(): Promise<SessionInfo & { result: HpodResult }> {
    const missing = (['endpoint', 'instance', 'accountLogin', 'emailAddress', 'password'] as const).filter((k) => !this.config[k].trim());
    if (missing.length) throw new HpodError(`Enter the ${missing.map((k) => LABEL[k]).join(', ')} first.`, 'config');
    const { instance, accountLogin, emailAddress, password } = this.config;
    const result = await this.raw({ method: 'POST', path: '/authenticate', auth: 'none', json: { instance, accountLogin, emailAddress, password } });
    if (result.status === 429) throw throttled('sign-in', result);
    if (result.status === 401 || result.status === 403) throw new HpodError(`H-POD refused the sign-in details (HTTP ${result.status}). Check the instance, account code, username and password.${detail(result)}`, 'auth');
    if (!result.ok) throw new HpodError(`H-POD could not sign in (HTTP ${result.status}).${detail(result)}`, 'auth');
    const token = (result.body as { token?: unknown } | null)?.token;
    if (typeof token !== 'string' || !token) throw new HpodError('H-POD answered the sign-in but sent no token back.', 'auth');
    return { ...this.setToken(token), result };
  }

  /** Makes a call. Signs in first when the call needs a token and there is none, and once more if H-POD answers 401 to a token it was holding. */
  async send(req: HpodRequest): Promise<HpodResult> {
    if (req.auth === 'none' || req.bearer) return this.raw(req);
    const hadToken = this.session() !== null;
    if (!hadToken) await this.signIn();
    const res = await this.raw(req);
    if (res.status === 401 && hadToken) { await this.signIn(); return this.raw(req); }
    return res;
  }

  private async raw(req: HpodRequest): Promise<HpodResult> {
    const url = new URL(`${baseUrl(this.config.endpoint)}${req.path}`);
    for (const [k, v] of Object.entries(req.query ?? {})) if (v !== '') url.searchParams.set(k, v);
    const headers: Record<string, string> = { Accept: 'application/json', 'User-Agent': 'IntelliDoc' };
    let body: string | FormData | undefined;
    if (req.form) { const f = new FormData(); for (const [k, v] of Object.entries(req.form)) f.append(k, v); body = f; }
    else if (req.json !== undefined) { body = JSON.stringify(req.json); headers['Content-Type'] = 'application/json'; }
    const bearer = req.auth === 'bearer' ? req.bearer ?? this.token?.value : undefined;
    if (bearer) headers['Authorization'] = `Bearer ${bearer}`;
    let idempotencyKey: string | undefined;
    if (req.method !== 'GET') { idempotencyKey = req.idempotencyKey?.trim() || randomUUID(); headers['Idempotency-Key'] = idempotencyKey; }

    const shown: HpodResult['request'] = {
      method: req.method, url: url.toString(),
      headers: { ...headers, ...(bearer ? { Authorization: `Bearer ${shortToken(bearer)}` } : {}) },
      body: req.form ? maskForDisplay(req.form) : req.json !== undefined ? maskForDisplay(req.json) : undefined,
    };
    const started = this.now();
    let res: Response;
    try {
      res = await this.fetchFn(url, { method: req.method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (e) {
      const err = e as Error & { cause?: { code?: string; message?: string } };
      if (err.name === 'TimeoutError' || err.name === 'AbortError') throw new HpodError(`${url.origin} did not answer within ${Math.round(this.timeoutMs / 1000)} seconds.`, 'timeout');
      throw new HpodError(`Could not reach ${url.origin}: ${err.cause?.code ?? err.cause?.message ?? err.message}`, 'network');
    }
    const text = (await res.text()).slice(0, MAX_BODY);
    const outHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => { if (!SKIP_HEADERS.has(k)) outHeaders[k] = v; });
    let parsed: unknown = text, kind: HpodResult['bodyKind'] = text ? 'text' : 'empty';
    if (text && (/json/i.test(res.headers.get('content-type') ?? '') || /^\s*[{[]/.test(text))) {
      try { parsed = JSON.parse(text); kind = 'json'; } catch { /* keep the text */ }
    }
    return { status: res.status, statusText: res.statusText, ok: res.ok, durationMs: Math.max(0, this.now() - started), headers: outHeaders, bodyKind: kind, body: kind === 'empty' ? null : parsed, request: shown, idempotencyKey };
  }
}

const LABEL = { endpoint: 'Endpoint', instance: 'Instance', accountLogin: 'Account code', emailAddress: 'Username', password: 'Password' } as const;

function detail(r: HpodResult): string {
  const b = r.body as { message?: unknown; error?: unknown; title?: unknown; detail?: unknown } | string | null;
  const text = typeof b === 'string' ? b : b && typeof b === 'object' ? [b.title, b.message, b.error, b.detail].find((x) => typeof x === 'string') : '';
  return text ? ` H-POD said: ${String(text).slice(0, 200)}` : '';
}

/** A 429: H-POD's throttle (sign-in is limited to 5 a minute). The wait comes from the Retry-After header when there is one. */
export function throttled(what: string, r: HpodResult): HpodError {
  const wait = Number(r.headers['retry-after']);
  const secs = Number.isFinite(wait) && wait > 0 ? Math.ceil(wait) : undefined;
  return new HpodError(`H-POD is throttling ${what} (HTTP 429)${secs ? `: try again in ${secs} seconds` : ': wait a minute and try again'}.`, 'throttled', secs);
}
