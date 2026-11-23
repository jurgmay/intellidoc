import { describe, expect, it } from 'vitest';
import { baseUrl, HpodApi, HpodError, jwtClaims, maskForDisplay, type HpodConfig } from '../src/hpod/client.js';
import { submitDocument, type SubmitInput } from '../src/hpod/submit.js';

const config: HpodConfig = { endpoint: 'https://api-uk.h-pod.co.uk', instance: 'uk', accountLogin: 'latcham', emailAddress: 'jo@latcham.example', password: 'hunter2' };
const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (exp: number): string => `${b64({ alg: 'RS256' })}.${b64({ sub: 'u1', exp })}.signature-part-of-the-token`;

interface Call { url: URL; init: RequestInit; json: any }
/** A fake fetch: each handler answers one call in turn (the last one repeats). */
function fakeFetch(...answers: Array<(c: Call) => Response | Promise<Response>>): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (url: URL | string, init: RequestInit = {}) => {
    const c: Call = { url: new URL(String(url)), init, json: typeof init.body === 'string' ? JSON.parse(init.body) : undefined };
    calls.push(c);
    return answers[Math.min(calls.length - 1, answers.length - 1)]!(c);
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const header = (c: Call, name: string): string | undefined => (c.init.headers as Record<string, string>)[name];
/** The error a call is expected to throw. */
const failure = async (p: Promise<unknown>): Promise<HpodError> => { try { await p; } catch (e) { return e as HpodError; } throw new Error('expected a failure'); };
const NOW = Date.parse('2026-11-23T10:00:00Z');
const inAnHour = (): number => Math.floor(NOW / 1000) + 3600;

describe('baseUrl', () => {
  it('adds /v3 to a bare address and keeps an address that has a path', () => {
    expect(baseUrl('https://api-uk.h-pod.co.uk')).toBe('https://api-uk.h-pod.co.uk/v3');
    expect(baseUrl(' https://api-uk.h-pod.co.uk/ ')).toBe('https://api-uk.h-pod.co.uk/v3');
    expect(baseUrl('https://api-uk.h-pod.co.uk/v3/')).toBe('https://api-uk.h-pod.co.uk/v3');
    expect(baseUrl('https://example.com/h-pod/v3')).toBe('https://example.com/h-pod/v3');
  });
});

describe('jwtClaims', () => {
  it('reads the payload, and is null for something that is not a token', () => {
    expect(jwtClaims(jwt(123))).toMatchObject({ sub: 'u1', exp: 123 });
    expect(jwtClaims('nonsense')).toBeNull();
    expect(jwtClaims('a.%%%.c')).toBeNull();
  });
});

describe('maskForDisplay', () => {
  it('hides secrets and shortens long values, whatever the depth', () => {
    expect(maskForDisplay({ instance: 'uk', password: 'x', nested: [{ client_secret: 'y', data: 'A'.repeat(500) }], token: '' })).toEqual({
      instance: 'uk', password: '********', nested: [{ client_secret: '********', data: '<500 characters>' }], token: '',
    });
  });
});

describe('HpodApi.signIn', () => {
  it('posts the sign-in details to /authenticate with no token, and remembers the token until it expires', async () => {
    const { fetch, calls } = fakeFetch(() => json({ token: jwt(inAnHour()) }));
    let now = NOW;
    const api = new HpodApi(config, { fetch, now: () => now });
    expect(api.session()).toBeNull();
    const s = await api.signIn();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.toString()).toBe('https://api-uk.h-pod.co.uk/v3/authenticate');
    expect(calls[0]!.json).toEqual({ instance: 'uk', accountLogin: 'latcham', emailAddress: 'jo@latcham.example', password: 'hunter2' });
    expect(header(calls[0]!, 'Authorization')).toBeUndefined();
    expect(header(calls[0]!, 'Idempotency-Key')).toBeTruthy();
    expect(s.expiresAt).toBe(new Date(inAnHour() * 1000).toISOString());
    expect(s.claims).toMatchObject({ sub: 'u1' });
    expect(s.result.request.body).toEqual({ instance: 'uk', accountLogin: 'latcham', emailAddress: 'jo@latcham.example', password: '********' });
    expect(api.session()?.expiresAt).toBe(s.expiresAt);
    now = (inAnHour() + 1) * 1000;
    expect(api.session()).toBeNull();
  });

  it('says what is missing before it calls anything', async () => {
    const { fetch, calls } = fakeFetch(() => json({}));
    const err = await failure(new HpodApi({ ...config, instance: ' ', password: '' }, { fetch }).signIn());
    expect(err).toBeInstanceOf(HpodError);
    expect(err.message).toBe('Enter the Instance, Password first.');
    expect(err.kind).toBe('config');
    expect(calls).toHaveLength(0);
  });

  it('turns a refused sign-in, a throttle, a missing token and a dead network into messages', async () => {
    const refused = await failure(new HpodApi(config, { fetch: fakeFetch(() => json({ message: 'Invalid login' }, 401)).fetch }).signIn());
    expect(refused.kind).toBe('auth');
    expect(refused.message).toContain('refused the sign-in details (HTTP 401)');
    expect(refused.message).toContain('Invalid login');
    expect(refused.message).not.toContain('hunter2');

    const slow = await failure(new HpodApi(config, { fetch: fakeFetch(() => json({}, 429, { 'retry-after': '12' })).fetch }).signIn());
    expect(slow.kind).toBe('throttled');
    expect(slow.retryAfterSeconds).toBe(12);
    expect(slow.message).toContain('try again in 12 seconds');

    const none = await failure(new HpodApi(config, { fetch: fakeFetch(() => json({ idpToken: 'x' })).fetch }).signIn());
    expect(none.message).toContain('sent no token');

    const down = await failure(new HpodApi(config, { fetch: (async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }); }) as unknown as typeof fetch }).signIn());
    expect(down.kind).toBe('network');
    expect(down.message).toBe('Could not reach https://api-uk.h-pod.co.uk: ENOTFOUND');
  });
});

describe('HpodApi.send', () => {
  it('signs in first, sends the token, and reuses it for the next call', async () => {
    const token = jwt(inAnHour());
    const { fetch, calls } = fakeFetch(() => json({ token }), () => json({ papers: [] }), () => json({ packs: [] }));
    const api = new HpodApi(config, { fetch, now: () => NOW });
    const a = await api.send({ method: 'GET', path: '/print/configuration', auth: 'bearer' });
    await api.send({ method: 'GET', path: '/job/status/abc', auth: 'bearer' });
    expect(calls.map((c) => `${c.init.method} ${c.url.pathname}`)).toEqual(['POST /v3/authenticate', 'GET /v3/print/configuration', 'GET /v3/job/status/abc']);
    expect(header(calls[1]!, 'Authorization')).toBe(`Bearer ${token}`);
    expect(a.body).toEqual({ papers: [] });
    expect(a.request.headers['Authorization']).toMatch(/^Bearer eyJ.*\.\.\./);          // the echo never holds the whole token
    expect(a.request.headers['Authorization']).not.toContain(token);
    expect(header(calls[1]!, 'Idempotency-Key')).toBeUndefined();                           // GET
  });

  it('signs in again once when H-POD answers 401 to a token it was holding, then retries', async () => {
    const { fetch, calls } = fakeFetch(() => json({ token: jwt(inAnHour()) }), () => json({}, 401), () => json({ token: jwt(inAnHour() + 5) }), () => json({ ok: true }));
    const api = new HpodApi(config, { fetch, now: () => NOW });
    await api.signIn();
    const r = await api.send({ method: 'GET', path: '/authenticate/me', auth: 'bearer' });
    expect(r.status).toBe(200);
    expect(calls.map((c) => `${c.init.method} ${c.url.pathname}`)).toEqual(['POST /v3/authenticate', 'GET /v3/authenticate/me', 'POST /v3/authenticate', 'GET /v3/authenticate/me']);
  });

  it('gives a 401 back as a result when the token was not one it held (no second sign-in loop)', async () => {
    const { fetch, calls } = fakeFetch(() => json({ token: jwt(inAnHour()) }), () => json({ message: 'no' }, 401), () => json({ message: 'no' }, 401));
    const r = await new HpodApi(config, { fetch, now: () => NOW }).send({ method: 'GET', path: '/authenticate/me', auth: 'bearer' });
    expect(r.status).toBe(401);
    expect(calls).toHaveLength(2);
  });

  it('sends a token override as it is and never signs in; sends no token at all for auth none', async () => {
    const { fetch, calls } = fakeFetch(() => json({}));
    const api = new HpodApi(config, { fetch });
    await api.send({ method: 'GET', path: '/oidc/userinfo', auth: 'bearer', bearer: 'abc.def.ghi' });
    await api.send({ method: 'GET', path: '/oidc/.well-known/openid-configuration', auth: 'none' });
    expect(header(calls[0]!, 'Authorization')).toBe('Bearer abc.def.ghi');
    expect(header(calls[1]!, 'Authorization')).toBeUndefined();
    expect(calls).toHaveLength(2);
  });

  it('adds an Idempotency-Key to writes (the given one, or a new one) and reports H-POD replaying', async () => {
    const { fetch, calls } = fakeFetch(() => json({}, 200, { 'idempotency-replayed': 'true' }));
    const api = new HpodApi(config, { fetch });
    const given = await api.send({ method: 'POST', path: '/blob', auth: 'none', json: { data: 'QQ==' }, idempotencyKey: 'key-1' });
    const made = await api.send({ method: 'POST', path: '/blob', auth: 'none', json: {} });
    expect(header(calls[0]!, 'Idempotency-Key')).toBe('key-1');
    expect(given.idempotencyKey).toBe('key-1');
    expect(made.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(given.headers['idempotency-replayed']).toBe('true');
  });

  it('sends a form as multipart, a query string without empty values, and does not follow redirects', async () => {
    const { fetch, calls } = fakeFetch(() => new Response(null, { status: 302, headers: { location: 'https://x.example/cb?code=1', 'set-cookie': 'a=b' } }));
    const r = await new HpodApi(config, { fetch }).send({ method: 'POST', path: '/oidc/token', auth: 'none', form: { grant_type: 'authorization_code', client_secret: 's3' } });
    await new HpodApi(config, { fetch }).send({ method: 'GET', path: '/oidc/authorize', auth: 'none', query: { client_id: 'c', scope: '' } });
    expect(calls[0]!.init.body).toBeInstanceOf(FormData);
    expect((calls[0]!.init.body as FormData).get('grant_type')).toBe('authorization_code');
    expect(r.request.body).toEqual({ grant_type: 'authorization_code', client_secret: '********' });
    expect(calls[0]!.init.redirect).toBe('manual');
    expect(calls[1]!.url.search).toBe('?client_id=c');
    expect(r.status).toBe(302);
    expect(r.headers['location']).toBe('https://x.example/cb?code=1');
    expect(r.headers['set-cookie']).toBeUndefined();
    expect(r.bodyKind).toBe('empty');
  });

  it('keeps a body that is not JSON as text', async () => {
    const { fetch } = fakeFetch(() => new Response('<html>Bad gateway</html>', { status: 502, headers: { 'content-type': 'text/html' } }));
    const r = await new HpodApi(config, { fetch }).send({ method: 'GET', path: '/x', auth: 'none' });
    expect(r).toMatchObject({ status: 502, ok: false, bodyKind: 'text', body: '<html>Bad gateway</html>' });
  });
});

describe('submitDocument', () => {
  const options: SubmitInput['options'] = {
    name: 'Demo letter', clientId: 'demo-1',
    paper: { guid: 'p' }, envelope: { guid: 'e' }, ink: { guid: 'i' }, duplex: { guid: 'd' }, packMode: { guid: 'm' }, delivery: { guid: 'v' },
  };
  const file = (n: number): SubmitInput['file'] => ({ name: 'Letter.PDF', data: Buffer.alloc(n, 7) });
  const signedIn = () => json({ token: jwt(inAnHour()) });
  const okHandlers = [signedIn, () => json({ jobGuid: 'job-1' }), () => json({}), () => json({ addressValidationResult: 'Valid' })];

  it('starts, sends the file in parts with their byte offsets, then commits', async () => {
    const { fetch, calls } = fakeFetch(signedIn, () => json({ jobGuid: 'job-1' }), () => json({}), () => json({}), () => json({}), () => json({ addressValidationResult: 'Valid' }));
    const out = await submitDocument(new HpodApi(config, { fetch, now: () => NOW }), { options, file: file(700_000), commit: { extractAddress: true, exportReady: false } }, { sleep: async () => {}, chunkBytes: 300_000 });
    expect(out).toMatchObject({ ok: true, jobGuid: 'job-1' });
    expect(out.message).toBe('Submitted as job job-1 (address check: Valid).');
    expect(out.steps.map((s) => s.label)).toEqual(['Start the submission', 'Send part 1 of 3', 'Send part 2 of 3', 'Send part 3 of 3', 'Commit the submission']);
    const [, init, p1, p2, p3, commit] = calls;
    expect(init!.url.pathname).toBe('/v3/print/init');
    expect(init!.json).toEqual(options);
    expect([p1, p2, p3].map((c) => [c!.url.pathname, c!.json.partIndex, c!.json.startByteIndex, c!.json.fileIndex, c!.json.jobGUID, c!.json.fileType, c!.json.filename])).toEqual([
      ['/v3/print/docpart', 0, 0, 0, 'job-1', 'pdf', 'Letter.PDF'], ['/v3/print/docpart', 1, 300_000, 0, 'job-1', 'pdf', 'Letter.PDF'], ['/v3/print/docpart', 2, 600_000, 0, 'job-1', 'pdf', 'Letter.PDF']]);
    expect(Buffer.from(p3!.json.data, 'base64')).toHaveLength(100_000);
    expect(commit!.url.pathname).toBe('/v3/print/commit');
    expect(commit!.json).toEqual({ jobGUID: 'job-1', extractAddress: true, exportReady: false });
    expect(header(init!, 'Authorization')).toMatch(/^Bearer /);
  });

  it('merges extra print options into the start of the submission', async () => {
    const { fetch, calls } = fakeFetch(...okHandlers);
    await submitDocument(new HpodApi(config, { fetch, now: () => NOW }), { options: { ...options, extra: { languageCode: 'en', passthrough: [{ name: 'job', value: '42' }] } }, file: file(10), commit: {} }, { sleep: async () => {} });
    expect(calls[1]!.json).toMatchObject({ name: 'Demo letter', languageCode: 'en', passthrough: [{ name: 'job', value: '42' }] });
    expect(calls[1]!.json.extra).toBeUndefined();
  });

  it('stops when the start is refused, and says why', async () => {
    const { fetch, calls } = fakeFetch(signedIn, () => json({ title: 'Paper GUID not recognised' }, 422));
    const out = await submitDocument(new HpodApi(config, { fetch, now: () => NOW }), { options, file: file(10), commit: {} }, { sleep: async () => {} });
    expect(out.ok).toBe(false);
    expect(out.jobGuid).toBeNull();
    expect(out.message).toBe('Could not start the submission: Paper GUID not recognised');
    expect(out.steps).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it('does not commit when a part fails, and reports a throttle plainly', async () => {
    const { fetch, calls } = fakeFetch(signedIn, () => json({ jobGuid: 'job-1' }), () => json({}), () => json({}, 429));
    const out = await submitDocument(new HpodApi(config, { fetch, now: () => NOW }), { options, file: file(700_000), commit: {} }, { sleep: async () => {}, chunkBytes: 300_000 });
    expect(out.ok).toBe(false);
    expect(out.jobGuid).toBe('job-1');
    expect(out.message).toContain('Part 2 of 3 was not accepted: Throttled by H-POD');
    expect(calls.some((c) => c.url.pathname.endsWith('/commit'))).toBe(false);
  });

  it('reports a network failure part-way as a failed step', async () => {
    let n = 0;
    const f = (async (url: URL | string, init: RequestInit) => {
      n++;
      if (n === 1) return signedIn();
      if (n === 2) return json({ jobGuid: 'job-1' });
      throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNRESET' } });
    }) as unknown as typeof fetch;
    const out = await submitDocument(new HpodApi(config, { fetch: f, now: () => NOW }), { options, file: file(10), commit: {} }, { sleep: async () => {} });
    expect(out.ok).toBe(false);
    expect(out.steps[out.steps.length - 1]).toMatchObject({ step: 'docpart', ok: false, status: 0 });
    expect(out.message).toContain('ECONNRESET');
  });

  it('refuses an empty file without calling H-POD', async () => {
    const { fetch, calls } = fakeFetch(...okHandlers);
    const out = await submitDocument(new HpodApi(config, { fetch }), { options, file: file(0), commit: {} });
    expect(out).toMatchObject({ ok: false, message: 'The file is empty.' });
    expect(calls).toHaveLength(0);
  });
});
