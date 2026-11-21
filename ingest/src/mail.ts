import nodemailer from 'nodemailer';

export interface Mailer {
  send(to: string[], subject: string, text: string): Promise<void>;
}

export interface SmtpSettings { host: string; port: number; secure: boolean; user?: string; pass?: string; from: string }

/** Sends through any SMTP server (Microsoft 365: smtp.office365.com, port 587, secure=false uses STARTTLS). */
export class SmtpMailer implements Mailer {
  private readonly transport;
  constructor(private readonly s: SmtpSettings) {
    this.transport = nodemailer.createTransport({ host: s.host, port: s.port, secure: s.secure, auth: s.user ? { user: s.user, pass: s.pass ?? '' } : undefined });
  }
  async send(to: string[], subject: string, text: string): Promise<void> {
    await this.transport.sendMail({ from: this.s.from, to: to.join(', '), subject, text });
  }
}

/** Used when no SMTP settings are configured: alerts only reach the log. */
export class LogMailer implements Mailer {
  constructor(private readonly log: (level: 'info' | 'warn' | 'error', msg: string) => void) {}
  async send(to: string[], subject: string, text: string): Promise<void> {
    this.log('warn', `E-mail NOT sent (SMTP not configured). To: ${to.join(', ') || '(nobody)'} | ${subject}\n${text}`);
  }
}
