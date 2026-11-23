import nodemailer from 'nodemailer';

export interface MailAttachment { filename: string; content: Uint8Array; contentType?: string }
export interface MailOptions { cc?: string[]; attachments?: MailAttachment[] }

export interface Mailer {
  send(to: string[], subject: string, text: string, options?: MailOptions): Promise<void>;
  /** false when nothing can really be sent (no SMTP server set up); anything else counts as able to send. */
  readonly configured?: boolean;
}

export interface SmtpSettings { host: string; port: number; secure: boolean; user?: string; pass?: string; from: string; replyTo?: string }

/** Reads SMTP_HOST, SMTP_PORT (587), SMTP_SECURE (1 = TLS from the start), SMTP_USER, SMTP_PASS, SMTP_FROM. Undefined when SMTP_HOST is not set. */
export function smtpFromEnv(env: Record<string, string | undefined>): SmtpSettings | undefined {
  if (!env['SMTP_HOST']) return undefined;
  const port = env['SMTP_PORT'] ? Number(env['SMTP_PORT']) : 587;
  if (!Number.isFinite(port) || port < 0) throw new Error('SMTP_PORT must be a non-negative number');
  const from = env['SMTP_FROM'] || env['SMTP_USER'];
  if (!from) throw new Error('SMTP_FROM (or SMTP_USER) is needed with SMTP_HOST');
  return { host: env['SMTP_HOST'], port, secure: env['SMTP_SECURE'] === '1', user: env['SMTP_USER'] || undefined, pass: env['SMTP_PASS'] || undefined, from };
}

/** Sends through any SMTP server (Microsoft 365: smtp.office365.com, port 587, secure=false uses STARTTLS). */
export class SmtpMailer implements Mailer {
  readonly configured = true;
  private readonly transport;
  constructor(private readonly s: SmtpSettings) {
    this.transport = nodemailer.createTransport({ host: s.host, port: s.port, secure: s.secure, auth: s.user ? { user: s.user, pass: s.pass ?? '' } : undefined,
      // a wrong host or a blocked port should fail in seconds, not after nodemailer's two minute defaults
      connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000 });
  }
  async send(to: string[], subject: string, text: string, options: MailOptions = {}): Promise<void> {
    await this.transport.sendMail({
      from: this.s.from, replyTo: this.s.replyTo || undefined, to: to.join(', '), cc: options.cc?.length ? options.cc.join(', ') : undefined, subject, text,
      attachments: options.attachments?.map((a) => ({ filename: a.filename, content: Buffer.from(a.content), contentType: a.contentType ?? 'application/pdf' })),
    });
  }
}

/** Used when no SMTP settings are configured: alerts only reach the log. */
export class LogMailer implements Mailer {
  readonly configured = false;
  constructor(private readonly log: (level: 'info' | 'warn' | 'error', msg: string) => void) {}
  async send(to: string[], subject: string, text: string, options: MailOptions = {}): Promise<void> {
    this.log('warn', `E-mail NOT sent (SMTP not configured). To: ${to.join(', ') || '(nobody)'}${options.cc?.length ? ` Cc: ${options.cc.join(', ')}` : ''} | ${subject}${options.attachments?.length ? ` | ${options.attachments.length} attachment(s)` : ''}\n${text}`);
  }
}
