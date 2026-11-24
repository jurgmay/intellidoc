import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import type { SessionUser } from './session.js';

export interface EntraConfig {
  tenantId: string; clientId: string; clientSecret: string;
  /** Where Entra sends the browser back to: <public address>/api/auth/callback. It must be listed in the app registration. */
  redirectUri: string;
  /** Normally https://login.microsoftonline.com; only a test changes it. */
  authority?: string;
}
interface Discovery { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string; end_session_endpoint?: string }
export class SignInError extends Error {}

/** Microsoft Entra ID sign-in by OpenID Connect: authorisation code with PKCE, the ID token checked against Entra's published keys. */
export class EntraClient {
  private disc?: Discovery; private jwks?: { keys: JSONWebKeySet; at: number };
  constructor(private readonly cfg: EntraConfig, private readonly fetchFn: typeof fetch = fetch, private readonly now: () => number = Date.now) {}

  private async discovery(): Promise<Discovery> {
    if (this.disc) return this.disc;
    const base = this.cfg.authority ?? 'https://login.microsoftonline.com';
    const res = await this.fetchFn(`${base}/${this.cfg.tenantId}/v2.0/.well-known/openid-configuration`);
    if (!res.ok) throw new SignInError(`Could not read Microsoft's sign-in settings (${res.status}).`);
    return (this.disc = (await res.json()) as Discovery);
  }

  private async keys(refresh: boolean): Promise<JSONWebKeySet> {
    if (!refresh && this.jwks && this.now() - this.jwks.at < 3_600_000) return this.jwks.keys;
    const res = await this.fetchFn((await this.discovery()).jwks_uri);
    if (!res.ok) throw new SignInError(`Could not read Microsoft's signing keys (${res.status}).`);
    this.jwks = { keys: (await res.json()) as JSONWebKeySet, at: this.now() };
    return this.jwks.keys;
  }

  async authorizeUrl(p: { state: string; nonce: string; challenge: string }): Promise<string> {
    const q = new URLSearchParams({ client_id: this.cfg.clientId, response_type: 'code', redirect_uri: this.cfg.redirectUri, response_mode: 'query', scope: 'openid profile email',
      state: p.state, nonce: p.nonce, code_challenge: p.challenge, code_challenge_method: 'S256' });
    return `${(await this.discovery()).authorization_endpoint}?${q.toString()}`;
  }

  /** Swaps the code for tokens and returns who signed in. Throws SignInError with a message fit to show. */
  async exchange(code: string, verifier: string, nonce: string): Promise<SessionUser> {
    const d = await this.discovery();
    const res = await this.fetchFn(d.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, grant_type: 'authorization_code', code, redirect_uri: this.cfg.redirectUri, code_verifier: verifier }).toString() });
    const tokens = (await res.json().catch(() => ({}))) as { id_token?: string; error_description?: string };
    if (!res.ok || !tokens.id_token) throw new SignInError(`Microsoft did not accept the sign-in${tokens.error_description ? `: ${tokens.error_description.split('\r')[0]}` : '.'}`);
    const opts = { issuer: d.issuer, audience: this.cfg.clientId, clockTolerance: 60 };
    let payload;
    try { payload = (await jwtVerify(tokens.id_token, createLocalJWKSet(await this.keys(false)), opts)).payload; }
    catch (e) {
      if ((e as { code?: string }).code !== 'ERR_JWKS_NO_MATCHING_KEY') throw new SignInError('The sign-in could not be verified.');
      try { payload = (await jwtVerify(tokens.id_token, createLocalJWKSet(await this.keys(true)), opts)).payload; } catch { throw new SignInError('The sign-in could not be verified.'); }
    }
    if (payload['nonce'] !== nonce) throw new SignInError('The sign-in does not match the one that was started. Try again.');
    if (payload['tid'] !== this.cfg.tenantId) throw new SignInError('That account is not in this organisation.');
    const email = String(payload['preferred_username'] ?? payload['email'] ?? payload['upn'] ?? '');
    return { id: String(payload['oid'] ?? payload.sub ?? ''), name: String(payload['name'] ?? email), email,
      roles: Array.isArray(payload['roles']) ? payload['roles'].filter((r): r is string => typeof r === 'string') : [] };
  }

  async logoutUrl(returnTo: string): Promise<string> {
    const d = await this.discovery();
    return `${d.end_session_endpoint ?? `${this.cfg.authority ?? 'https://login.microsoftonline.com'}/${this.cfg.tenantId}/oauth2/v2.0/logout`}?${new URLSearchParams({ post_logout_redirect_uri: returnTo }).toString()}`;
  }
}
