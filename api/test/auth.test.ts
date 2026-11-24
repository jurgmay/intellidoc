import { generateKeyPair, exportJWK, SignJWT, type JWK } from 'jose';
import type { FastifyInstance } from 'fastify';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { needsAdmin } from '../src/auth/access.js';
import { authFromEnv } from '../src/auth/config.js';
import { EntraClient } from '../src/auth/oidc.js';
import { safeReturn } from '../src/auth/routes.js';
import { seal, unseal } from '../src/auth/session.js';
import { MemoryAuditStore } from '../src/audit/memoryStore.js';
import { MemoryReportStore } from '../src/reports/memoryStore.js';
import { MemoryReferenceStore } from '../src/reference/memoryStore.js';
import { MemoryCustomerStore } from '../src/customers/memoryStore.js';
import { MemoryRepriceStore } from '../src/reprice/memoryStore.js';
import { MemoryPostalStore } from '../src/postal/memoryStore.js';
import { MemoryCostingStore } from '../src/costing/memoryStore.js';
import { MemoryRecipientStore } from '../src/recipients/memoryStore.js';
import { MemorySettingsStore } from '../src/settings/store.js';

const TENANT = '11111111-1111-4111-8111-111111111111', CLIENT = '22222222-2222-4222-8222-222222222222', PUBLIC = 'https://idoc.example.com';
const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;
const SECRET = 'a-test-secret-that-is-at-least-32-characters-long';
let privateKey: CryptoKey, jwk: JWK;
let claims: Record<string, unknown>;
let tokenOk = true;

async function idToken(over: Record<string, unknown> = {}, key: CryptoKey = privateKey): Promise<string> {
  const c = { iss: ISSUER, aud: CLIENT, tid: TENANT, nonce: 'n', oid: 'oid-1', name: 'Jo Staff', preferred_username: 'jo@latcham.co.uk', roles: ['User'], ...claims, ...over };
  return new SignJWT(c).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuedAt().setExpirationTime('5m').sign(key);
}
/** Stands in for Entra: discovery, keys and the token endpoint. Whatever nonce the app sent is echoed into the token. */
const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
  const u = String(url);
  const json = (b: unknown, status = 200): Response => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
  if (u.endsWith('/.well-known/openid-configuration')) return json({ issuer: ISSUER, authorization_endpoint: 'https://login.example/authorize', token_endpoint: 'https://login.example/token', jwks_uri: 'https://login.example/keys', end_session_endpoint: 'https://login.example/logout' });
  if (u === 'https://login.example/keys') return json({ keys: [{ ...jwk, kid: 'k1', alg: 'RS256', use: 'sig' }] });
  if (u === 'https://login.example/token') {
    if (!tokenOk) return json({ error: 'invalid_grant', error_description: 'AADSTS70008: code expired\r\nTrace' }, 400);
    const form = new URLSearchParams(String(init?.body));
    expect(form.get('code_verifier')).toBeTruthy();
    expect(form.get('client_secret')).toBe('shh');
    return json({ id_token: await idToken({ nonce: claims['nonce'] ?? form.get('code')!.replace('code-for-', '') }) });
  }
  return json({}, 404);
}) as typeof fetch;

const entra = (): EntraClient => new EntraClient({ tenantId: TENANT, clientId: CLIENT, clientSecret: 'shh', redirectUri: `${PUBLIC}/api/auth/callback` }, fakeFetch);
async function build(auth: Parameters<typeof buildApp>[0]['auth']): Promise<FastifyInstance> {
  return buildApp({ auth, settings: new MemorySettingsStore(), customers: new MemoryCustomerStore(), costing: new MemoryCostingStore(), postal: new MemoryPostalStore(), reprice: new MemoryRepriceStore(), recipients: new MemoryRecipientStore(),
    reports: new MemoryReportStore(), reference: new MemoryReferenceStore(), audit: new MemoryAuditStore() });
}
const setCookies = (res: { headers: Record<string, unknown> }): string => ([] as string[]).concat((res.headers['set-cookie'] as string[] | string | undefined) ?? []).join(' | ');
const cookieHeader = (res: { headers: Record<string, unknown> }): string => ([] as string[]).concat(res.headers['set-cookie'] as string[] ?? []).map((c) => c.split(';')[0]).join('; ');

/** Signs in through the whole flow and returns the cookie header for the new session. */
async function signIn(app: FastifyInstance, returnTo?: string): Promise<{ cookie: string; location: string }> {
  const login = await app.inject({ method: 'GET', url: `/api/auth/login${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}` });
  const auth = new URL(login.headers.location as string);
  const state = auth.searchParams.get('state')!;
  const cb = await app.inject({ method: 'GET', url: `/api/auth/callback?code=code-for-${auth.searchParams.get('nonce')}&state=${state}`, headers: { cookie: cookieHeader(login) } });
  return { cookie: cookieHeader(cb), location: String(cb.headers.location) };
}

beforeAll(async () => { const kp = await generateKeyPair('RS256'); privateKey = kp.privateKey as CryptoKey; jwk = await exportJWK(kp.publicKey); });

describe('sign-in flow', () => {
  it('sends the browser to Entra with PKCE, state and nonce', async () => {
    const app = await build({ entra: entra(), secret: SECRET, publicUrl: PUBLIC });
    const r = await app.inject({ method: 'GET', url: '/api/auth/login?returnTo=/jobs' });
    expect(r.statusCode).toBe(302);
    const u = new URL(r.headers.location as string);
    expect(u.origin + u.pathname).toBe('https://login.example/authorize');
    expect(u.searchParams.get('client_id')).toBe(CLIENT);
    expect(u.searchParams.get('redirect_uri')).toBe(`${PUBLIC}/api/auth/callback`);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    for (const k of ['state', 'nonce', 'code_challenge']) expect(u.searchParams.get(k)).toBeTruthy();
    const c = setCookies(r);
    expect(c).toMatch(/^idoc_login=/); expect(c).toMatch(/HttpOnly/); expect(c).toMatch(/SameSite=Lax/); expect(c).toMatch(/Secure/);
  });

  it('signs in, sets a session cookie and returns to the page asked for', async () => {
    claims = {};
    const app = await build({ entra: entra(), secret: SECRET, publicUrl: PUBLIC });
    expect((await app.inject({ method: 'GET', url: '/api/customers' })).statusCode).toBe(401);
    const { cookie, location } = await signIn(app, '/jobs?x=1');
    expect(location).toBe('/jobs?x=1');
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.json()).toMatchObject({ name: 'Jo Staff', email: 'jo@latcham.co.uk', roles: ['User'], isAdmin: false, hasAccess: true, signedInByDevelopmentBypass: false });
    expect((await app.inject({ method: 'GET', url: '/api/customers', headers: { cookie } })).statusCode).toBe(200);
  });

  it('refuses a callback with the wrong state, no login cookie, or an Entra error', async () => {
    claims = {};
    const app = await build({ entra: entra(), secret: SECRET, publicUrl: PUBLIC });
    const login = await app.inject({ method: 'GET', url: '/api/auth/login' });
    const nonce = new URL(login.headers.location as string).searchParams.get('nonce');
    const bad = await app.inject({ method: 'GET', url: `/api/auth/callback?code=code-for-${nonce}&state=wrong`, headers: { cookie: cookieHeader(login) } });
    expect(bad.statusCode).toBe(403); expect(bad.body).toMatch(/Sign-in failed/); expect(setCookies(bad)).not.toMatch(/idoc_session=[^;]/);
    expect((await app.inject({ method: 'GET', url: '/api/auth/callback?code=x&state=y' })).statusCode).toBe(403);
    const denied = await app.inject({ method: 'GET', url: '/api/auth/callback?error=access_denied&error_description=AADSTS65004%3A%20declined%0D%0ATrace' });
    expect(denied.statusCode).toBe(403); expect(denied.body).toMatch(/AADSTS65004: declined/); expect(denied.body).not.toMatch(/Trace/);
  });

  it('refuses tokens with the wrong nonce, tenant, audience, signature, or when Entra rejects the code', async () => {
    const app = await build({ entra: entra(), secret: SECRET, publicUrl: PUBLIC });
    const other = (await generateKeyPair('RS256')).privateKey as CryptoKey;
    const cases: [string, Record<string, unknown>, RegExp][] = [
      ['nonce', { nonce: 'someone-elses' }, /does not match/], ['tenant', { tid: '33333333-3333-4333-8333-333333333333' }, /not in this organisation/],
      ['audience', { aud: 'another-app' }, /could not be verified/], ['issuer', { iss: 'https://evil.example/v2.0' }, /could not be verified/],
    ];
    for (const [, c, msg] of cases) {
      claims = c;
      const login = await app.inject({ method: 'GET', url: '/api/auth/login' });
      const u = new URL(login.headers.location as string);
      const r = await app.inject({ method: 'GET', url: `/api/auth/callback?code=code-for-${u.searchParams.get('nonce')}&state=${u.searchParams.get('state')}`, headers: { cookie: cookieHeader(login) } });
      expect(r.statusCode).toBe(403); expect(r.body).toMatch(msg);
    }
    // a token signed by a key Entra never published
    const e = new EntraClient({ tenantId: TENANT, clientId: CLIENT, clientSecret: 'shh', redirectUri: 'x' }, (async (u: string | URL | Request, i?: RequestInit) => String(u) === 'https://login.example/token'
      ? new Response(JSON.stringify({ id_token: await idToken({ nonce: 'n' }, other) }), { status: 200 }) : fakeFetch(u, i)) as typeof fetch);
    claims = {};
    await expect(e.exchange('c', 'v', 'n')).rejects.toThrow(/could not be verified/);
    tokenOk = false; claims = {};
    const login = await app.inject({ method: 'GET', url: '/api/auth/login' });
    const u = new URL(login.headers.location as string);
    const r = await app.inject({ method: 'GET', url: `/api/auth/callback?code=c&state=${u.searchParams.get('state')}`, headers: { cookie: cookieHeader(login) } });
    tokenOk = true;
    expect(r.statusCode).toBe(403); expect(r.body).toMatch(/code expired/); expect(r.body).not.toMatch(/Trace/);
  });

  it('logs out by POST and gives the Entra sign-out address', async () => {
    claims = {};
    const app = await build({ entra: entra(), secret: SECRET, publicUrl: PUBLIC });
    const { cookie } = await signIn(app);
    expect((await app.inject({ method: 'GET', url: '/api/auth/logout', headers: { cookie } })).statusCode).toBe(404);
    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect(out.json().redirect).toBe(`https://login.example/logout?post_logout_redirect_uri=${encodeURIComponent(`${PUBLIC}/signed-out`)}`);
    expect(setCookies(out)).toMatch(/idoc_session=; .*Max-Age=0/);
  });
});

describe('who may do what', () => {
  it('lets health and the auth routes through, and asks everything else to sign in', async () => {
    const app = await build({ entra: entra(), secret: SECRET, publicUrl: PUBLIC });
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/auth/me' })).statusCode).toBe(401);
    for (const [method, url] of [['GET', '/api/customers'], ['GET', '/api/settings'], ['POST', '/api/reports/audit.pdf']] as const) {
      const r = await app.inject({ method, url, payload: method === 'POST' ? {} : undefined });
      expect(r.statusCode, url).toBe(401);
    }
  });

  it('turns away a signed-in person with no role, and a plain User from admin-only pages', async () => {
    const app = await build({ entra: entra(), secret: SECRET, publicUrl: PUBLIC });
    claims = { roles: [] };
    const none = await signIn(app);
    const r = await app.inject({ method: 'GET', url: '/api/customers', headers: { cookie: none.cookie } });
    expect(r.statusCode).toBe(403); expect(r.json().error).toMatch(/not been given access/);
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: none.cookie } })).json()).toMatchObject({ hasAccess: false });

    claims = { roles: ['User'] };
    const user = await signIn(app);
    for (const url of ['/api/settings', '/api/reference', '/api/reports/margin', '/api/reports/margin.pdf']) {
      const x = await app.inject({ method: 'GET', url, headers: { cookie: user.cookie } });
      expect(x.statusCode, url).toBe(403); expect(x.json().error).toMatch(/administrator/);
    }
    claims = { roles: ['Admin'] };
    const admin = await signIn(app);
    expect((await app.inject({ method: 'GET', url: '/api/settings', headers: { cookie: admin.cookie } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: admin.cookie } })).json()).toMatchObject({ isAdmin: true, hasAccess: true });
    claims = {};
  });

  it('refuses a write that comes from another site, and a forged or expired cookie', async () => {
    claims = {};
    let t = Date.now();
    const app = await build({ entra: entra(), secret: SECRET, publicUrl: PUBLIC, now: () => t });
    const { cookie } = await signIn(app);
    const evil = await app.inject({ method: 'POST', url: '/api/reports/audit.pdf', headers: { cookie, origin: 'https://evil.example' }, payload: {} });
    expect(evil.statusCode).toBe(403); expect(evil.json().error).toMatch(/another site/);
    const own = await app.inject({ method: 'POST', url: '/api/reports/audit.pdf', headers: { cookie, origin: PUBLIC }, payload: {} });
    expect(own.statusCode).not.toBe(403);
    const forged = cookie.replace(/idoc_session=([^.]+)\.[^;]+/, 'idoc_session=$1.AAAA');
    expect((await app.inject({ method: 'GET', url: '/api/customers', headers: { cookie: forged } })).statusCode).toBe(401);
    t += 9 * 3_600_000;   // past the 8 hours
    expect((await app.inject({ method: 'GET', url: '/api/customers', headers: { cookie } })).statusCode).toBe(401);
  });

  it('in development the bypass user is everyone and signing in goes nowhere', async () => {
    const app = await build(authFromEnv({ AUTH_MODE: 'off' }));
    const me = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(me.json()).toMatchObject({ email: 'dev@localhost', isAdmin: true, signedInByDevelopmentBypass: true });
    expect((await app.inject({ method: 'GET', url: '/api/settings' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/auth/login' })).headers.location).toBe('/');
  });
});

describe('pieces', () => {
  it('only returns to a page inside this site', () => {
    expect(safeReturn('/jobs?a=1')).toBe('/jobs?a=1');
    for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', '/api/settings', 'jobs', undefined, 5, '/' + 'a'.repeat(600)]) expect(safeReturn(bad), String(bad)).toBe('/');
  });
  it('signs and checks cookies', () => {
    const v = seal({ a: 1, exp: 2000 }, SECRET);
    expect(unseal(v, SECRET, 1000)).toEqual({ a: 1, exp: 2000 });
    expect(unseal(v, SECRET, 3000)).toBeNull();
    expect(unseal(v, 'another-secret-that-is-also-32-characters-x', 1000)).toBeNull();
    expect(unseal(v.replace(/^./, (c) => (c === 'a' ? 'b' : 'a')), SECRET, 1000)).toBeNull();
    expect(unseal(undefined, SECRET, 1000)).toBeNull(); expect(unseal('nonsense', SECRET, 1000)).toBeNull();
  });
  it('knows which routes are for administrators', () => {
    expect(needsAdmin('GET', '/api/settings')).toBe(true);
    expect(needsAdmin('GET', '/api/settings/pdf')).toBe(true);
    expect(needsAdmin('GET', '/api/reports/margin.pdf')).toBe(true);
    expect(needsAdmin('GET', '/api/reports/usage')).toBe(false);
    expect(needsAdmin('GET', '/api/settingsX')).toBe(false);
    expect(needsAdmin('GET', '/api/costing')).toBe(false);
    expect(needsAdmin('PUT', '/api/costing')).toBe(true);
    expect(needsAdmin('GET', '/api/jobs')).toBe(false);
  });
  it('refuses to start without sign-in settings, unless explicitly off in development', () => {
    expect(() => authFromEnv({})).toThrow(/ENTRA_TENANT_ID.*SESSION_SECRET/);
    const full = { ENTRA_TENANT_ID: TENANT, ENTRA_CLIENT_ID: CLIENT, ENTRA_CLIENT_SECRET: 's', AUTH_PUBLIC_URL: PUBLIC, SESSION_SECRET: SECRET };
    expect(authFromEnv(full).entra).toBeDefined();
    expect(() => authFromEnv({ ...full, SESSION_SECRET: 'short' })).toThrow(/32 characters/);
    expect(() => authFromEnv({ ...full, AUTH_PUBLIC_URL: 'http://idoc.example.com' })).toThrow(/https/);
    expect(authFromEnv({ ...full, AUTH_PUBLIC_URL: 'http://localhost:5173/' }).publicUrl).toBe('http://localhost:5173');
    expect(() => authFromEnv({ AUTH_MODE: 'off', NODE_ENV: 'production' })).toThrow(/only allowed in development/);
    expect(() => authFromEnv({ AUTH_MODE: 'off', API_HOST: '0.0.0.0' })).toThrow(/only allowed in development/);
  });
});
