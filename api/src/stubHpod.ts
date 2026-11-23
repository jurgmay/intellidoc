/** A small pretend H-POD for the stub server (so the H-POD page can be tried, and demoed to a screen, with no account and no network). It answers like the real API v3 but keeps nothing but the jobs it was sent. */
const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64url');
const G = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const guid = (): string => globalThis.crypto.randomUUID();
const j = (body: unknown, status = 200, headers: Record<string, string> = {}): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const CONFIGURATION = {
  papers: [{ guid: G(1), name: '80gsm white', isDefault: true }, { guid: G(2), name: '100gsm white', isDefault: false }],
  envelopes: [{ guid: G(11), name: 'C5 window', isDefault: true }, { guid: G(12), name: 'C4 window', isDefault: false }],
  inks: [{ guid: G(21), name: 'Black', isDefault: true }, { guid: G(22), name: 'Colour', isDefault: false }],
  duplexes: [{ guid: G(31), name: 'Double sided', isDefault: true }, { guid: G(32), name: 'Single sided', isDefault: false }],
  packModes: [{ guid: G(41), name: 'One letter per pack', isDefault: true }],
  deliveries: [{ guid: G(51), name: '2nd class', isDefault: true }, { guid: G(52), name: '1st class', isDefault: false }],
  inserts: [], stationery: [],
};

export function fakeHpodFetch(now: () => number = Date.now): typeof fetch {
  const jobs = new Map<string, { name: string; parts: number; committed: boolean }>();
  return (async (url: URL | string, init: RequestInit = {}) => {
    const u = new URL(String(url));
    const path = u.pathname.replace(/^\/v3/, '');
    const method = String(init.method ?? 'GET');
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = typeof init.body === 'string' && init.body.startsWith('{') ? (JSON.parse(init.body) as Record<string, any>) : {};
    const rate = { 'x-rate-limit-limit': '30', 'x-rate-limit-remaining': '29' };
    if (method === 'POST' && path === '/authenticate') {
      if (!body['password']) return j({ title: 'Invalid login', status: 401 }, 401);
      return j({ token: `${b64({ alg: 'RS256' })}.${b64({ sub: 'demo-user', email: body['emailAddress'], account: body['accountLogin'], exp: Math.floor(now() / 1000) + 3600 })}.demo` }, 200, rate);
    }
    if (path === '/authenticate/keys' || path.startsWith('/authenticate/keys/')) return j({ keys: [{ kty: 'RSA', use: 'sig', kid: 'demo', alg: 'RS256' }] });
    if (path === '/oidc/.well-known/openid-configuration') return j({ issuer: `${u.origin}/v3/oidc`, authorization_endpoint: `${u.origin}/v3/oidc/authorize`, token_endpoint: `${u.origin}/v3/oidc/token` });
    if (!headers['Authorization']) return j({ title: 'Unauthorized', status: 401 }, 401);
    if (path === '/authenticate/me') return j({ userGuid: G(900), emailAddress: 'demo@latcham.example', accountName: 'Latcham demo' }, 200, rate);
    if (path === '/authenticate/refresh') return j({ token: `${b64({ alg: 'RS256' })}.${b64({ sub: 'demo-user', exp: Math.floor(now() / 1000) + 7200 })}.demo` }, 200, rate);
    if (path.startsWith('/authenticate/focus/')) return j({ ok: true }, 200, rate);
    if (path === '/print/configuration') return j(CONFIGURATION, 200, rate);
    if (path === '/print/init') { const id = guid(); jobs.set(id, { name: String(body['name'] ?? ''), parts: 0, committed: false }); return j({ jobGuid: id }, 200, rate); }
    if (path === '/print/docpart') {
      const job = jobs.get(String(body['jobGUID']));
      if (!job) return j({ title: 'Unknown job', status: 404 }, 404);
      job.parts += 1; return j({ ok: true }, 200, rate);
    }
    if (path === '/print/commit') {
      const job = jobs.get(String(body['jobGUID']));
      if (!job) return j({ title: 'Unknown job', status: 404 }, 404);
      job.committed = true; return j({ addressValidationResult: 'Valid', jobGuid: String(body['jobGUID']) }, 200, rate);
    }
    if (path.startsWith('/job/status/')) {
      const id = path.split('/').pop()!, job = jobs.get(id);
      if (!job) return j({ title: 'Not found', status: 404 }, 404, rate);
      return j({ guid: id, name: job.name, completed: job.committed, packs: job.committed ? [{ guid: G(700), status: 'queued' }] : [] }, 200, rate);
    }
    if (path.startsWith('/pack/') && method === 'GET') return j({ guid: path.split('/').pop(), status: 'queued', versions: [], statusChanges: [] }, 200, rate);
    if (path === '/pack/batch') return j({ updated: Array.isArray(body['packs']) ? body['packs'].length : 0 }, 200, rate);
    if (path === '/blob') return j({ blobGuid: guid() }, 200, rate);
    if (path === '/framework/submit') return j({ jobGuid: guid() }, 200, rate);
    return j({ title: 'Not found', status: 404 }, 404);
  }) as unknown as typeof fetch;
}
