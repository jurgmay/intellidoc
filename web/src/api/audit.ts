import { signInAgain } from './signIn';

/** Makes the mailpiece audit report (a PDF) for the mailpieces that were ticked, and returns it. */
export async function createAuditReport(body: { accountId: number; mailpieceIds: number[]; criteria: string; thumbnails: boolean }): Promise<Blob> {
  const res = await fetch('/api/reports/audit.pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (res.status === 401) { signInAgain(); throw new Error('Your sign-in has ended. Signing in again…'); }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const data = JSON.parse(await res.text()) as { error?: string; errors?: Record<string, string> };
      message = data.error ?? (data.errors ? Object.values(data.errors).join(' ') : message);
    } catch { /* not JSON: keep the generic message */ }
    throw new Error(message);
  }
  return res.blob();
}
