/** Where the browser goes: one place, so tests can watch it. */
export const nav = { to: (url: string): void => { window.location.assign(url); } };

/** The session has ended (or never began): sign in again, then come back to this page. */
export function signInAgain(): void {
  nav.to(`/api/auth/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`);
}
