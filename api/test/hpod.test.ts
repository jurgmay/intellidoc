import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemoryActivityStore, MemoryInboxReader } from '../src/activity/memoryStore.js';
import { MemoryReportStore } from '../src/reports/memoryStore.js';
import { MemoryReferenceStore } from '../src/reference/memoryStore.js';
import { MemoryRecipientStore } from '../src/recipients/memoryStore.js';
import { MemoryCustomerStore } from '../src/customers/memoryStore.js';
import { MemoryRepriceStore } from '../src/reprice/memoryStore.js';
import { MemoryPostalStore } from '../src/postal/memoryStore.js';
import { MemoryCostingStore } from '../src/costing/memoryStore.js';
import { MemorySettingsStore } from '../src/settings/store.js';
import { BY_ID, GROUPS, OPERATIONS } from '../src/hpod/operations.js';
import { buildRequest, hpodConfigFromValues, HpodSessions, testHpodSignIn } from '../src/hpod/service.js';

const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
const NOW = Date.parse('2026-11-23T10:00:00Z');
const jwt = (exp = Math.floor(NOW / 1000) + 3600): string => `${b64({ alg: 'RS256' })}.${b64({ sub: 'u1', exp })}.sig`;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

interface Call { method: string; path: string; query: string; auth?: string; body: any; headers: Record<string, string> }
/** A fake H-POD. `answers` maps "METHOD /path" to a response (or a function of the call); /authenticate gives a token unless told otherwise. */
function fakeHpod(answers: Record<string, Response | ((c: Call) => Response)> = {}): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (url: URL | string, init: RequestInit = {}) => {
    const u = new URL(String(url)), headers = init.headers as Record<string, string>;
    const c: Call = { method: String(init.method), path: u.pathname.replace(/^\/v3/, ''), query: u.search, auth: headers['Authorization'], headers, body: typeof init.body === 'string' ? JSON.parse(init.body) : init.body };
    calls.push(c);
    const a = answers[`${c.method} ${c.path}`] ?? (c.path === '/authenticate' ? json({ token: jwt() }) : json({ ok: true }));
    return typeof a === 'function' ? a(c) : a.clone();
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

const filled = { hpodEndpoint: 'https://api-uk.h-pod.co.uk', hpodInstance: 'uk', hpodAccountCode: 'latcham', hpodUsername: 'jo@latcham.example' };
async function settingsWith(values: Record<string, string> = filled, password: string | null = 'hunter2'): Promise<MemorySettingsStore> {
  const store = new MemorySettingsStore();
  const changes = Object.entries({ ...values, ...(password ? { hpodPassword: password } : {}) }).map(([key, newValue]) => ({ key, oldValue: '', newValue }));
  await store.update(changes, 'test');
  return store;
}

describe('the operation catalogue', () => {
  it('has every operation of the H-POD API v3 once', () => {
    expect(OPERATIONS.map((o) => `${o.method} ${o.path}`).sort()).toEqual([
      'GET /authenticate/keys', 'GET /authenticate/keys/{instance}', 'GET /authenticate/me', 'GET /job/status/{jobGuid}', 'GET /oidc/.well-known/openid-configuration', 'GET /oidc/authorize',
      'GET /oidc/userinfo', 'GET /pack/{packGuid}', 'GET /print/configuration',
      'POST /authenticate', 'POST /authenticate/authcode', 'POST /authenticate/focus/{accountGuid}', 'POST /authenticate/refresh', 'POST /blob', 'POST /framework/submit', 'POST /oidc/login',
      'POST /oidc/login-direct', 'POST /oidc/token', 'POST /oidc/userinfo', 'POST /pack/batch', 'POST /print/commit', 'POST /print/docpart', 'POST /print/init',
    ].sort());
    expect(new Set(OPERATIONS.map((o) => o.id)).size).toBe(OPERATIONS.length);
    expect(OPERATIONS.every((o) => GROUPS.includes(o.group))).toBe(true);
  });
  it('declares every path parameter, and asks for a confirmation on the calls that change live data', () => {
    for (const o of OPERATIONS) {
      const inPath = [...o.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      expect((o.pathParams ?? []).map((p) => p.name), o.id).toEqual(inPath);
    }
    expect(OPERATIONS.filter((o) => o.live).map((o) => o.id).sort()).toEqual(['frameworkSubmit', 'packBatch', 'printCommit']);
  });
});

describe('hpodConfigFromValues', () => {
  it('lists the labels of what is empty, with the password coming separately', () => {
    expect(hpodConfigFromValues({ hpodEndpoint: ' https://x.example ', hpodInstance: '', hpodAccountCode: 'a', hpodUsername: '' }, null)).toEqual({
      config: { endpoint: 'https://x.example', instance: '', accountLogin: 'a', emailAddress: '', password: '' }, missing: ['Instance', 'Username', 'Password'] });
    expect(hpodConfigFromValues({ ...filled }, 'pw').missing).toEqual([]);
  });
});

describe('testHpodSignIn (the Settings > Connectivity button)', () => {
  const full = { endpoint: 'https://api-uk.h-pod.co.uk', instance: 'uk', accountLogin: 'latcham', emailAddress: 'jo@latcham.example', password: 'hunter2' };
  it('signs in with POST /authenticate and says who and until when', async () => {
    const h = fakeHpod();
    const r = await testHpodSignIn(full, [], { fetch: h.fetch, now: () => NOW });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({ method: 'POST', path: '/authenticate', body: { instance: 'uk', accountLogin: 'latcham', emailAddress: 'jo@latcham.example', password: 'hunter2' } });
    expect(r.ok).toBe(true);
    expect(r.message).toBe('Signed in to H-POD as jo@latcham.example (account latcham, instance uk) in 0 ms. The token is valid until 2026-11-23 11:00 UTC.');
  });
  it('says the sign-in details were refused, that H-POD is throttling, and that it cannot be reached', async () => {
    const refused = await testHpodSignIn(full, [], { fetch: fakeHpod({ 'POST /authenticate': json({ message: 'Invalid login' }, 401) }).fetch });
    expect(refused).toEqual({ ok: false, message: expect.stringContaining('refused the sign-in details (HTTP 401)') });
    expect(refused.message).not.toContain('hunter2');
    const slow = await testHpodSignIn(full, [], { fetch: fakeHpod({ 'POST /authenticate': json({}, 429, { 'retry-after': '30' }) }).fetch });
    expect(slow.message).toContain('try again in 30 seconds');
    const down = await testHpodSignIn(full, [], { fetch: (async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }); }) as unknown as typeof fetch });
    expect(down).toEqual({ ok: false, message: 'Could not reach https://api-uk.h-pod.co.uk: ENOTFOUND' });
  });
  it('lists what is missing without calling H-POD', async () => {
    const h = fakeHpod();
    expect(await testHpodSignIn({ ...full, instance: '', password: '' }, ['Instance', 'Password'], { fetch: h.fetch })).toEqual({ ok: false, message: 'Enter the Instance, Password first.' });
    expect(h.calls).toHaveLength(0);
  });
});

describe('buildRequest', () => {
  const config = { endpoint: 'https://x.example', instance: 'uk', accountLogin: 'a', emailAddress: 'e', password: 'p' };
  it('fills path parameters (encoded, and the instance from Settings when left empty) and drops empty query values', () => {
    expect(buildRequest(BY_ID.get('jobStatus')!, { operation: 'jobStatus', path: { jobGuid: 'a b/c' } }, config)).toMatchObject({ method: 'GET', path: '/job/status/a%20b%2Fc', auth: 'bearer' });
    expect(buildRequest(BY_ID.get('authenticateKeysInstance')!, { operation: 'x', path: {} }, config).path).toBe('/authenticate/keys/uk');
    expect(buildRequest(BY_ID.get('oidcAuthorize')!, { operation: 'x', query: { client_id: 'c', redirect_uri: 'https://cb', response_type: 'code', scope: ' ' } }, config).query).toEqual({ client_id: 'c', redirect_uri: 'https://cb', response_type: 'code' });
  });
  it('names the required parameters that are missing', () => {
    expect(() => buildRequest(BY_ID.get('packGet')!, { operation: 'packGet' }, config)).toThrow('Pack GUID is required.');
    expect(() => buildRequest(BY_ID.get('oidcAuthorize')!, { operation: 'x', query: { client_id: 'c' } }, config)).toThrow('redirect_uri is required. response_type is required.');
  });
  it('sends json bodies as json, form bodies as strings without the empty ones, and a token override only to calls that use a token', () => {
    expect(buildRequest(BY_ID.get('printInit')!, { operation: 'x', body: { name: 'n' } }, config).json).toEqual({ name: 'n' });
    expect(buildRequest(BY_ID.get('oidcToken')!, { operation: 'x', body: { grant_type: 'authorization_code', code: '', expires: 5, n: null } }, config).form).toEqual({ grant_type: 'authorization_code', expires: '5' });
    expect(buildRequest(BY_ID.get('oidcUserinfoGet')!, { operation: 'x', bearerOverride: ' tok ' }, config).bearer).toBe('tok');
    const open = buildRequest(BY_ID.get('oidcDiscovery')!, { operation: 'x', bearerOverride: 'tok' }, config);
    expect(open.auth).toBe('none');
    expect(open.bearer).toBeUndefined();
  });
});

describe('HpodSessions', () => {
  it('reports what is missing from Settings, and signs nothing in', async () => {
    const h = fakeHpod();
    const s = new HpodSessions(await settingsWith({ hpodEndpoint: 'https://api-uk.h-pod.co.uk' }, null), { fetch: h.fetch, now: () => NOW });
    expect(await s.status()).toMatchObject({ configured: false, missing: ['Instance', 'Account code', 'Username', 'Password'], signedIn: false });
    await expect(s.signIn()).rejects.toMatchObject({ kind: 'config', message: 'Enter the Instance, Account code, Username, Password on Settings > Connectivity first.' });
    expect(h.calls).toHaveLength(0);
  });

  it('signs in with the saved details, holds the token on the server, and shows its status without the token or password', async () => {
    const h = fakeHpod();
    const s = new HpodSessions(await settingsWith(), { fetch: h.fetch, now: () => NOW });
    const out = await s.signIn();
    expect(h.calls[0]!.body).toEqual({ instance: 'uk', accountLogin: 'latcham', emailAddress: 'jo@latcham.example', password: 'hunter2' });
    expect(out.status).toMatchObject({ configured: true, signedIn: true, username: 'jo@latcham.example', expiresAt: '2026-11-23T11:00:00.000Z' });
    expect(JSON.stringify(out)).not.toContain('hunter2');
    expect(JSON.stringify(out)).not.toContain(jwt());
    expect((await s.signOut()).signedIn).toBe(false);
  });

  it('signs in on the first call that needs a token, and uses it for the next', async () => {
    const h = fakeHpod({ 'GET /job/status/j1': json({ guid: 'j1', completed: false, packs: [] }) });
    const s = new HpodSessions(await settingsWith(), { fetch: h.fetch, now: () => NOW });
    const out = await s.call({ operation: 'jobStatus', path: { jobGuid: 'j1' } });
    await s.call({ operation: 'jobStatus', path: { jobGuid: 'j1' } });
    expect(h.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /authenticate', 'GET /job/status/j1', 'GET /job/status/j1']);
    expect(h.calls[1]!.auth).toBe(`Bearer ${jwt()}`);
    expect(out.result.body).toEqual({ guid: 'j1', completed: false, packs: [] });
    expect(out.status.signedIn).toBe(true);
  });

  it('starts a new session when the sign-in details change', async () => {
    const h = fakeHpod();
    const store = await settingsWith();
    const s = new HpodSessions(store, { fetch: h.fetch, now: () => NOW });
    await s.signIn();
    expect((await s.status()).signedIn).toBe(true);
    await store.update([{ key: 'hpodInstance', oldValue: 'uk', newValue: 'eu' }], 'test');
    expect((await s.status()).signedIn).toBe(false);
    await s.signIn();
    expect(h.calls.at(-1)!.body.instance).toBe('eu');
  });

  it('runs "Acquire a token" with the settings, and takes the token a refresh sends back', async () => {
    const fresh = jwt(Math.floor(NOW / 1000) + 7200);
    const h = fakeHpod({ 'POST /authenticate/refresh': json({ token: fresh }) });
    const s = new HpodSessions(await settingsWith(), { fetch: h.fetch, now: () => NOW });
    const a = await s.call({ operation: 'authenticate' });
    expect(a.result.request.body).toMatchObject({ password: '********' });
    expect(a.status.expiresAt).toBe('2026-11-23T11:00:00.000Z');
    expect(a.result.body).toEqual({ token: '********' });
    const r = await s.call({ operation: 'authenticateRefresh' });
    expect(r.status.expiresAt).toBe('2026-11-23T12:00:00.000Z');
  });

  it('will not run a call that changes live data without a confirmation, and says what it would do', async () => {
    const h = fakeHpod();
    const s = new HpodSessions(await settingsWith(), { fetch: h.fetch, now: () => NOW });
    await expect(s.call({ operation: 'printCommit', body: { jobGUID: 'j' } })).rejects.toMatchObject({ fieldErrors: { confirm: expect.stringContaining('commits the job to H-POD') } });
    await expect(s.call({ operation: 'packBatch', body: { packs: [] }, confirm: false })).rejects.toBeTruthy();
    expect(h.calls).toHaveLength(0);
    await s.call({ operation: 'printCommit', body: { jobGUID: 'j' }, confirm: true });
    expect(h.calls.at(-1)).toMatchObject({ method: 'POST', path: '/print/commit', body: { jobGUID: 'j' } });
  });

  it('refuses an operation it does not know', async () => {
    const s = new HpodSessions(await settingsWith(), { fetch: fakeHpod().fetch });
    await expect(s.call({ operation: 'nope' })).rejects.toThrow('There is no H-POD operation called "nope".');
  });

  it('submits a document: start, parts, commit, with a confirmation', async () => {
    const h = fakeHpod({ 'POST /print/init': json({ jobGuid: 'job-9' }), 'POST /print/commit': json({ addressValidationResult: 'Valid' }) });
    const s = new HpodSessions(await settingsWith(), { fetch: h.fetch, now: () => NOW });
    const req = { options: { name: 'n', clientId: 'c', paper: { guid: 'p' }, envelope: { guid: 'e' }, ink: { guid: 'i' }, duplex: { guid: 'd' }, packMode: { guid: 'm' }, delivery: { guid: 'v' } },
      fileName: 'a.pdf', data: Buffer.from('%PDF-1.4 hello').toString('base64'), commit: { extractAddress: true } };
    await expect(s.submit(req)).rejects.toMatchObject({ fieldErrors: { confirm: expect.any(String) } });
    expect(h.calls).toHaveLength(0);
    const out = await s.submit({ ...req, confirm: true });
    expect(out).toMatchObject({ ok: true, jobGuid: 'job-9' });
    expect(h.calls.map((c) => c.path)).toEqual(['/authenticate', '/print/init', '/print/docpart', '/print/commit']);
    expect(Buffer.from(h.calls[2]!.body.data, 'base64').toString()).toBe('%PDF-1.4 hello');
  });
});

describe('/api/hpod routes', () => {
  let app: FastifyInstance; let h: ReturnType<typeof fakeHpod>; let store: MemorySettingsStore;
  const make = async (): Promise<FastifyInstance> => buildApp({
    settings: store, hpod: new HpodSessions(store, { fetch: h.fetch, now: () => NOW }),
    customers: new MemoryCustomerStore(), costing: new MemoryCostingStore(), postal: new MemoryPostalStore(), reprice: new MemoryRepriceStore(), recipients: new MemoryRecipientStore(), reports: new MemoryReportStore(), reference: new MemoryReferenceStore(),
  });
  beforeEach(async () => { h = fakeHpod(); store = await settingsWith(); app = await make(); });

  it('lists the operations for the page', async () => {
    const r = (await app.inject({ url: '/api/hpod/operations' })).json();
    expect(r.groups).toEqual([...GROUPS]);
    expect(r.operations).toHaveLength(OPERATIONS.length);
  });

  it('signs in and out, and reports the session without any secret', async () => {
    expect((await app.inject({ url: '/api/hpod/session' })).json()).toMatchObject({ configured: true, signedIn: false });
    const r = await app.inject({ method: 'POST', url: '/api/hpod/session' });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toMatchObject({ signedIn: true });
    expect(r.body).not.toContain('hunter2');
    expect(r.body).not.toContain(jwt());
    expect((await app.inject({ method: 'DELETE', url: '/api/hpod/session' })).json()).toMatchObject({ signedIn: false });
  });

  it('runs a call and returns what H-POD said, errors included', async () => {
    h = fakeHpod({ 'GET /pack/p1': json({ title: 'Not found' }, 404, { 'x-rate-limit-remaining': '29' }) });
    app = await make();
    const r = await app.inject({ method: 'POST', url: '/api/hpod/call', payload: { operation: 'packGet', path: { packGuid: 'p1' } } });
    expect(r.statusCode).toBe(200);
    expect(r.json().result).toMatchObject({ status: 404, ok: false, body: { title: 'Not found' }, headers: { 'x-rate-limit-remaining': '29' } });
    expect(r.json().result.request.headers['Authorization']).not.toContain(jwt());
  });

  it('answers 422 for a missing parameter or confirmation, 404 for an unknown operation, 400 for no operation', async () => {
    const call = (payload: unknown) => app.inject({ method: 'POST', url: '/api/hpod/call', payload: payload as object });
    expect((await call({ operation: 'packGet' })).statusCode).toBe(422);
    const live = await call({ operation: 'packBatch', body: { packs: [] } });
    expect(live.statusCode).toBe(422);
    expect(live.json().errors.confirm).toContain('changes the status of live packs');
    expect((await call({ operation: 'nope' })).statusCode).toBe(404);
    expect((await call({})).statusCode).toBe(400);
  });

  it('maps H-POD trouble to a message: settings missing 422, refused sign-in 502, throttled 429', async () => {
    store = await settingsWith(filled, null); app = await make();
    const none = await app.inject({ method: 'POST', url: '/api/hpod/session' });
    expect(none.statusCode).toBe(422);
    expect(none.json()).toEqual({ error: 'Enter the Password on Settings > Connectivity first.', kind: 'config' });
    store = await settingsWith(); h = fakeHpod({ 'POST /authenticate': json({ message: 'Invalid login' }, 401) }); app = await make();
    const refused = await app.inject({ method: 'POST', url: '/api/hpod/session' });
    expect(refused.statusCode).toBe(502);
    expect(refused.json().kind).toBe('auth');
    h = fakeHpod({ 'POST /authenticate': json({}, 429, { 'retry-after': '20' }) }); app = await make();
    const slow = await app.inject({ method: 'POST', url: '/api/hpod/session' });
    expect(slow.statusCode).toBe(429);
    expect(slow.json().error).toContain('try again in 20 seconds');
  });

  it('submits a file through /api/hpod/submit and returns the steps', async () => {
    h = fakeHpod({ 'POST /print/init': json({ jobGuid: 'job-1' }) }); app = await make();
    const payload = { options: { name: 'n', clientId: 'c', paper: { guid: 'p' }, envelope: { guid: 'e' }, ink: { guid: 'i' }, duplex: { guid: 'd' }, packMode: { guid: 'm' }, delivery: { guid: 'v' } }, fileName: 'a.pdf', data: Buffer.from('x').toString('base64'), commit: {} };
    expect((await app.inject({ method: 'POST', url: '/api/hpod/submit', payload })).statusCode).toBe(422);
    const r = await app.inject({ method: 'POST', url: '/api/hpod/submit', payload: { ...payload, confirm: true } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, jobGuid: 'job-1' });
    expect(r.json().steps.map((s: { step: string }) => s.step)).toEqual(['init', 'docpart', 'commit']);
    expect((await app.inject({ method: 'POST', url: '/api/hpod/submit', payload: { fileName: 'a.pdf' } })).statusCode).toBe(400);
  });
});
