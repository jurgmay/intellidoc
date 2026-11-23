/** The checks behind the test buttons on Settings > Connectivity. They use the values on screen, saved or not. */
import { SmtpMailer, type SmtpSettings } from '../../../ingest/src/mail.js';
import { parseEmails, type SettingValue } from './catalogue.js';

export interface TestResult { ok: boolean; message: string }

export interface Connectivity {
  /** Sends a test e-mail to these addresses through this server. Never throws: a failure is the result. */
  sendTestEmail(smtp: SmtpSettings, to: string[]): Promise<TestResult>;
  /** Checks that the web address answers. Never throws. */
  checkEndpoint(url: string): Promise<TestResult>;
}

/** `"Name" <address>`, or just the address when there is no name. Quotes and backslashes are dropped from the name. */
export function fromHeader(name: string, address: string): string {
  const n = name.replace(/["\\\r\n]/g, '').trim();
  return n ? `"${n}" <${address}>` : address;
}

/** The SMTP settings from the e-mail settings, or what is missing. Port 465 uses TLS from the start; any other port starts plain and upgrades (STARTTLS) when the server offers it. */
export function smtpFromValues(v: Record<string, SettingValue>, password: string | null): { smtp: SmtpSettings } | { error: string } {
  const server = String(v['smtpServer'] ?? '').trim(), address = String(v['smtpFromAddress'] ?? '').trim();
  if (!server) return { error: 'Enter the SMTP server first.' };
  if (!address) return { error: "Enter the SMTP 'from' address first." };
  const port = Number(v['smtpPort']), user = String(v['smtpUsername'] ?? '').trim();
  if (user && password === null) return { error: 'There is an SMTP username but no password. Type the password first.' };
  return { smtp: { host: server, port, secure: port === 465, user: user || undefined, pass: user ? password ?? undefined : undefined,
    from: fromHeader(String(v['smtpFromName'] ?? ''), address), replyTo: String(v['smtpReplyTo'] ?? '').trim() || undefined } };
}

/** Who the test e-mail goes to: the alert recipients (Settings > General), the addresses the system's own messages go to. */
export const testEmailRecipients = (v: Record<string, SettingValue>): string[] => parseEmails(String(v['alertRecipients'] ?? ''));

const clip = (s: string): string => (s.length > 300 ? `${s.slice(0, 300)}...` : s);

export async function sendTestEmail(smtp: SmtpSettings, to: string[], mailer: { send: SmtpMailer['send'] } = new SmtpMailer(smtp)): Promise<TestResult> {
  try {
    await mailer.send(to, 'IntelliDoc test e-mail', `This is a test e-mail from IntelliDoc.\n\nMail server: ${smtp.host}:${smtp.port}\nSent: ${new Date().toISOString()}\n\nIf you can read this, the e-mail settings work.`);
    return { ok: true, message: `Test e-mail sent to ${to.join(', ')}. Check the inbox.` };
  } catch (e) {
    const err = e as Error & { code?: string; responseCode?: number };
    return { ok: false, message: clip(`The test e-mail could not be sent${err.code ? ` (${err.code})` : ''}: ${err.message}`) };
  }
}

/**
 * Asks the web address for its home page. Any answer below 500 means the address, the network path and TLS work (a 401 or 403 is expected from
 * an API that wants a sign-in). It does not sign in: the credentials are not tested.
 */
export async function checkEndpoint(url: string, fetchFn: typeof fetch = fetch, timeoutMs = 10_000): Promise<TestResult> {
  const started = Date.now();
  try {
    const res = await fetchFn(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'User-Agent': 'IntelliDoc connectivity check' } });
    const ms = Date.now() - started;
    if (res.status >= 500) return { ok: false, message: `${url} answered, but with a server error (HTTP ${res.status}, ${ms} ms).` };
    return { ok: true, message: `Reached ${url} (HTTP ${res.status}, ${ms} ms). This checks the address and network only: the sign-in details were not tested.` };
  } catch (e) {
    const err = e as Error & { cause?: { code?: string; message?: string } };
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return { ok: false, message: `${url} did not answer within ${Math.round(timeoutMs / 1000)} seconds.` };
    const why = err.cause?.code ?? err.cause?.message ?? err.message;
    return { ok: false, message: clip(`Could not reach ${url}: ${why}`) };
  }
}

export const realConnectivity: Connectivity = { sendTestEmail: (smtp, to) => sendTestEmail(smtp, to), checkEndpoint: (url) => checkEndpoint(url) };
