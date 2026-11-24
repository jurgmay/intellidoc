import { EntraClient } from './oidc.js';
import type { AuthDeps } from './routes.js';

type Env = Record<string, string | undefined>;

/**
 * Sign-in settings from the environment. Secure by default: with nothing set the API refuses to start, rather than serving everyone.
 * AUTH_MODE=off turns sign-in off for development, and only on a loopback address and outside production.
 */
export function authFromEnv(env: Env): AuthDeps {
  const host = env['API_HOST'] ?? '127.0.0.1';
  if (env['AUTH_MODE'] === 'off') {
    if (env['NODE_ENV'] === 'production' || !['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('AUTH_MODE=off is only allowed in development, on 127.0.0.1 (not in production, and not on a network address).');
    return { secret: 'development-only-secret-not-used-for-anything-real', publicUrl: env['AUTH_PUBLIC_URL'] ?? 'http://localhost:5173',
      devUser: { id: 'dev', name: 'Development user', email: 'dev@localhost', roles: ['Admin'] } };
  }
  const missing = ['ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_CLIENT_SECRET', 'AUTH_PUBLIC_URL', 'SESSION_SECRET'].filter((k) => !env[k]);
  if (missing.length) throw new Error(`Sign-in is not configured: set ${missing.join(', ')} (see api/.env.example and docs/auth.md), or AUTH_MODE=off for development.`);
  if (env['SESSION_SECRET']!.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters (for example the output of: openssl rand -base64 48).');
  const publicUrl = env['AUTH_PUBLIC_URL']!.replace(/\/+$/, '');
  if (!/^https:\/\//.test(publicUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(publicUrl)) throw new Error('AUTH_PUBLIC_URL must be https (http is only allowed for localhost).');
  return {
    entra: new EntraClient({ tenantId: env['ENTRA_TENANT_ID']!, clientId: env['ENTRA_CLIENT_ID']!, clientSecret: env['ENTRA_CLIENT_SECRET']!, redirectUri: `${publicUrl}/api/auth/callback` }),
    secret: env['SESSION_SECRET']!, publicUrl, sessionHours: env['SESSION_HOURS'] ? Number(env['SESSION_HOURS']) : undefined,
  };
}
