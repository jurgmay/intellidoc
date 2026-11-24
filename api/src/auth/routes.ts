import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { needsAdmin, hasRole, ROLE_ADMIN, ROLE_USER } from './access.js';
import { SignInError, type EntraClient } from './oidc.js';
import { clearCookie, cookieOf, seal, setCookie, unseal, type SessionUser } from './session.js';

const SESSION = 'idoc_session', LOGIN = 'idoc_login';

export interface AuthDeps {
  /** Entra ID sign-in. Left out only in development (see devUser). */
  entra?: EntraClient;
  /** Signs the cookies; at least 32 characters. */
  secret: string;
  /** The address people use, with no trailing slash, e.g. https://intellidoc.latcham.co.uk. Decides the cookie's Secure flag and which Origin may write. */
  publicUrl: string;
  /** Development only: everyone is this user and nobody signs in. */
  devUser?: SessionUser;
  /** How long a sign-in lasts (default 8 hours). */
  sessionHours?: number;
  now?: () => number;
}

const b64 = (n: number): string => randomBytes(n).toString('base64url');
const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
/** Only a path inside this site: never another address, and never an API address. */
export const safeReturn = (v: unknown): string => (typeof v === 'string' && /^\/(?![/\\])/.test(v) && !v.startsWith('/api/') && v.length < 500 ? v : '/');

/** Signs people in with Entra ID and refuses every /api request that has no valid session or lacks the role for it. Register it before the other routes. */
export function authRoutes(app: FastifyInstance, a: AuthDeps): void {
  const now = a.now ?? Date.now;
  const secure = a.publicUrl.startsWith('https://');
  const hours = a.sessionHours ?? 8;
  const sessionOf = (req: FastifyRequest): SessionUser | null => {
    if (a.devUser) return a.devUser;
    const s = unseal<{ user: SessionUser; exp: number }>(cookieOf(req.headers.cookie, SESSION), a.secret, now());
    return s?.user ?? null;
  };
  const cookies = (reply: FastifyReply, ...c: string[]): void => { void reply.header('Set-Cookie', c); };

  app.addHook('onRequest', async (req, reply) => {
    const path = req.url.split('?')[0]!;
    if (!path.startsWith('/api/') || path === '/api/health' || path.startsWith('/api/auth/')) return;
    const user = sessionOf(req);
    if (!user) return reply.code(401).send({ error: 'Sign in to continue.' });
    // a write from another site is refused even if the browser sent the cookie
    const origin = req.headers.origin;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && origin && origin !== a.publicUrl) return reply.code(403).send({ error: 'That request came from another site.' });
    if (!hasRole(user, ROLE_USER)) return reply.code(403).send({ error: 'Your account has not been given access to IntelliDoc. Ask an administrator to assign you a role.' });
    if (needsAdmin(req.method, path) && !hasRole(user, ROLE_ADMIN)) return reply.code(403).send({ error: 'Only an administrator can do that.' });
    req.user = user;
  });

  app.get('/api/auth/me', async (req, reply) => {
    const user = sessionOf(req);
    if (!user) return reply.code(401).send({ error: 'Not signed in.' });
    return { name: user.name, email: user.email, roles: user.roles, isAdmin: hasRole(user, ROLE_ADMIN), hasAccess: hasRole(user, ROLE_USER), signedInByDevelopmentBypass: Boolean(a.devUser) };
  });

  app.get('/api/auth/login', async (req, reply) => {
    if (!a.entra) return reply.redirect('/');
    const q = req.query as Record<string, unknown>;
    const state = b64(24), nonce = b64(24), verifier = b64(48);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    cookies(reply, setCookie(LOGIN, seal({ state, nonce, verifier, returnTo: safeReturn(q['returnTo']), exp: now() + 10 * 60_000 }, a.secret), { maxAgeSeconds: 600, secure }));
    return reply.redirect(await a.entra.authorizeUrl({ state, nonce, challenge }));
  });

  const failed = (reply: FastifyReply, message: string) => {
    cookies(reply, clearCookie(LOGIN, secure));
    return reply.code(403).header('Content-Type', 'text/html; charset=utf-8')
      .send(`<!doctype html><meta charset="utf-8"><title>Sign-in failed</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto"><h1>Sign-in failed</h1><p>${esc(message)}</p><p><a href="/api/auth/login">Try again</a></p></body>`);
  };
  app.get('/api/auth/callback', async (req, reply) => {
    if (!a.entra) return reply.redirect('/');
    const q = req.query as Record<string, string | undefined>;
    if (q['error']) return failed(reply, `Microsoft said: ${q['error_description']?.split('\r')[0] ?? q['error']}`);
    const login = unseal<{ state: string; nonce: string; verifier: string; returnTo: string; exp: number }>(cookieOf(req.headers.cookie, LOGIN), a.secret, now());
    if (!login || !q['code'] || q['state'] !== login.state) return failed(reply, 'The sign-in took too long or did not start here. Try again.');
    try {
      const user = await a.entra.exchange(q['code'], login.verifier, login.nonce);
      cookies(reply, clearCookie(LOGIN, secure), setCookie(SESSION, seal({ user, exp: now() + hours * 3_600_000 }, a.secret), { maxAgeSeconds: hours * 3600, secure }));
      return reply.redirect(safeReturn(login.returnTo));
    } catch (e) {
      if (e instanceof SignInError) return failed(reply, e.message);
      console.error(e);
      return failed(reply, 'Something went wrong while signing in. See the API log.');
    }
  });

  // POST, so another site cannot sign someone out with a link
  app.post('/api/auth/logout', async (_req, reply) => {
    cookies(reply, clearCookie(SESSION, secure));
    return { redirect: a.entra ? await a.entra.logoutUrl(`${a.publicUrl}/signed-out`) : '/' };
  });
}
