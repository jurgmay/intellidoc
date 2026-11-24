import { createHmac, timingSafeEqual } from 'node:crypto';

/** Who is signed in. Kept in the session cookie, so it holds nothing secret. */
export interface SessionUser { id: string; name: string; email: string; roles: string[] }

declare module 'fastify' { interface FastifyRequest { user?: SessionUser } }

/** Signs a JSON value so it can be kept in a cookie and not be changed by the browser. */
export function seal(payload: object, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

/** The value inside a sealed cookie, or null when it is missing, forged or past its `exp` (milliseconds). */
export function unseal<T extends { exp: number }>(value: string | undefined, secret: string, now: number): T | null {
  if (!value) return null;
  const dot = value.lastIndexOf('.');
  if (dot < 1) return null;
  const body = value.slice(0, dot);
  const want = createHmac('sha256', secret).update(body).digest();
  const got = Buffer.from(value.slice(dot + 1), 'base64url');
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
    return typeof data.exp === 'number' && data.exp > now ? data : null;
  } catch { return null; }
}

export function cookieOf(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

export function setCookie(name: string, value: string, o: { maxAgeSeconds: number; secure: boolean }): string {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${o.maxAgeSeconds}${o.secure ? '; Secure' : ''}`;
}
export const clearCookie = (name: string, secure: boolean): string => setCookie(name, '', { maxAgeSeconds: 0, secure });
