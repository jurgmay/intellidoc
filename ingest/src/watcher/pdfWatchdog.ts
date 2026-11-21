import type { Mailer } from '../mail.js';
import type { OverdueJob, PdfTracker } from '../repository.js';

export interface WatchdogOptions {
  /** Alert once a job has waited this long for its PDF. */
  waitMinutes: number;
  /** Then remind this often until the PDF arrives. */
  reminderMinutes: number;
  to: string[];
  /** Name of the inbox folder, so the e-mail says where to put the PDF. */
  inbox: string;
}
type Log = (level: 'info' | 'warn' | 'error', msg: string) => void;

export function lateAlert(j: OverdueJob, inbox: string): { subject: string; text: string } {
  const nth = j.alertCount === 0 ? '' : ` (reminder ${j.alertCount})`;
  return {
    subject: `IntelliDoc: PDF missing for ${j.baseName}${nth}`,
    text: [
      `The data for ${j.xmlName} was imported ${j.minutesWaiting} minutes ago, but its PDF has not arrived.`,
      'The letters cannot be printed until the PDF is supplied.',
      '',
      `Customer:        ${j.customerName}`,
      `Job:             ${j.baseName}`,
      `Packs:           ${j.packCount}`,
      `Expected pages:  ${j.expectedPages}`,
      `Imported (UTC):  ${j.receivedAt.toISOString().replace('T', ' ').slice(0, 16)}`,
      '',
      `What to do: put ${j.baseName}.pdf in ${inbox} (the file name must match the XML). It is checked automatically.`,
      `Reminders continue until it arrives.`,
    ].join('\n'),
  };
}

/** Looks for jobs whose PDF is overdue and e-mails an alert. A job is only marked as alerted once the e-mail has been sent. */
export class PdfWatchdog {
  constructor(private readonly store: PdfTracker, private readonly mailer: Mailer, private readonly opts: WatchdogOptions, private readonly log: Log) {}

  /** One check. Returns the number of alerts sent. */
  async check(): Promise<number> {
    const overdue = await this.store.listOverdue(this.opts.waitMinutes, this.opts.reminderMinutes);
    let sent = 0;
    for (const j of overdue) {
      const { subject, text } = lateAlert(j, this.opts.inbox);
      try {
        await this.mailer.send(this.opts.to, subject, text);
        await this.store.markAlerted(j.jobId);
        sent++;
        this.log('warn', `PDF overdue for ${j.baseName} (${j.minutesWaiting} min): alert sent`);
      } catch (e) {
        this.log('error', `Could not send the PDF alert for ${j.baseName}: ${(e as Error).message}; will try again`);
      }
    }
    return sent;
  }
}
