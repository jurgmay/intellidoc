import { describe, expect, it } from 'vitest';
import { buildRunSheetEmail, pickRecipients, sendRunSheetEmail, type EmailSettings, type JobEmailSummary } from '../src/runsheet/email.js';
import type { Mailer } from '../src/mail.js';

const batch = (code: number, extra = {}) => ({ batchCode: code, service: 'Royal Mail 2nd Class', envelope: 'C5 window', department: 'Claims', mailpieces: 1200, pages: 3000, colourPages: 400, monoPages: 2500, blankPages: 100,
  weightBands: ['Letter (Up to 100g)'], fileName: `77440 - IntelliDoc - Uinsure - ${code} - Batch 1 of 2.pdf`, ...extra });
const job = (o: Partial<JobEmailSummary> = {}): JobEmailSummary => ({ jobName: 'Uinsure renewals 0612', customerName: 'Uinsure', jobNumber: '77440', isTesting: false, archive: false, customerEmails: ['ops@uinsure.example'],
  mailpieces: 2400, packs: 2500, sheets: 3200, colourPages: 800, monoPages: 5000, blankPages: 200, batches: [batch(81899), batch(81900)], ...o });
const settings: EmailSettings = { enabled: true, runSheetRecipients: ['print@latcham.example', 'planner@latcham.example'], alertRecipients: ['alerts@latcham.example'] };

describe('run sheet e-mail wording', () => {
  it('uses the job name as subject and FileMaker\'s body and attachment name', () => {
    const m = buildRunSheetEmail(job());
    expect(m.subject).toBe('Uinsure renewals 0612');
    expect(m.text.split('\n')[0]).toBe('UINSURE');
    expect(m.text).toContain('Total mailpieces: 2,400');
    expect(m.text).toContain('Total pages: 6,000 (800 colour, 5,000 mono, 200 blank)');
    expect(m.text).toContain('Royal Mail 2nd Class - C5 window - Claims');
    expect(m.text).toContain('Filename: 77440 - IntelliDoc - Uinsure - 81899 - Batch 1 of 2.pdf');
    expect(m.text).not.toContain('ALL MAILPIECES TO BE ARCHIVED');
    expect(m.attachmentName).toBe('77440 - IntelliDoc Run Sheets - Uinsure - 2 batches (81899 - 81900).pdf');
  });
  it('says so when everything is archived, and uses the singular for one batch', () => {
    const m = buildRunSheetEmail(job({ archive: true, batches: [batch(5)] }));
    expect(m.text).toContain('ALL MAILPIECES TO BE ARCHIVED');
    expect(m.attachmentName).toBe('77440 - IntelliDoc Run Sheet - Uinsure - 1 batch (5 - 5).pdf');
  });
  it('marks a test subject and drops characters a file name cannot hold', () => {
    const m = buildRunSheetEmail(job({ isTesting: true, customerName: 'A/B: Ltd' }));
    expect(m.subject).toBe('[TEST] Uinsure renewals 0612');
    expect(m.attachmentName).toContain('A-B- Ltd');
  });
});

describe('who gets the run sheets', () => {
  it('first recipient is To, the rest and the customer are Cc, without repeats', () => {
    const r = pickRecipients({ isTesting: false, customerEmails: ['OPS@uinsure.example', 'PLANNER@latcham.example'] }, settings);
    expect(r).toEqual({ to: ['print@latcham.example'], cc: ['planner@latcham.example', 'OPS@uinsure.example'] });
  });
  it('a customer in testing goes to the alert recipients only', () => {
    expect(pickRecipients({ isTesting: true, customerEmails: ['ops@uinsure.example'] }, settings)).toEqual({ to: ['alerts@latcham.example'], cc: [] });
  });
  it('explains when there is nobody to send to', () => {
    expect(pickRecipients({ isTesting: false, customerEmails: [] }, { ...settings, runSheetRecipients: [] }).problem).toMatch(/No run sheet e-mail recipients/);
    expect(pickRecipients({ isTesting: true, customerEmails: [] }, { ...settings, alertRecipients: [] }).problem).toMatch(/Testing/);
  });
});

describe('sendRunSheetEmail', () => {
  const run = (mailer: Mailer, j = job(), s = settings) => {
    const log = { stamped: 0 };
    return { log, p: sendRunSheetEmail({ mailer, summary: async () => j, settings: async () => s, pdf: async () => new Uint8Array([37, 80, 68, 70]), sent: async () => { log.stamped++; } }) };
  };
  it('sends with the PDF attached and stamps the job', async () => {
    const sent: { to: string[]; subject: string; cc?: string[]; files: string[] }[] = [];
    const mailer: Mailer = { configured: true, send: async (to, subject, _t, o) => { sent.push({ to: [...to], subject, cc: o?.cc as string[], files: (o?.attachments ?? []).map((a) => a.filename) }); } } as Mailer;
    const { p, log } = run(mailer);
    const r = await p;
    expect(r.sent).toBe(true);
    expect(sent[0]!.to).toEqual(['print@latcham.example']);
    expect(sent[0]!.files).toEqual(['77440 - IntelliDoc Run Sheets - Uinsure - 2 batches (81899 - 81900).pdf']);
    expect(log.stamped).toBe(1);
  });
  it('does not send, or stamp, when no mail server is set up', async () => {
    const { p, log } = run({ configured: false, send: async () => { throw new Error('no'); } } as Mailer);
    const r = await p;
    expect(r.sent).toBe(false); expect(r.error).toMatch(/SMTP_HOST/); expect(log.stamped).toBe(0);
  });
  it('reports a refusal by the mail server without stamping', async () => {
    const { p, log } = run({ configured: true, send: async () => { throw new Error('550 rejected'); } } as Mailer);
    const r = await p;
    expect(r.sent).toBe(false); expect(r.error).toMatch(/550 rejected/); expect(log.stamped).toBe(0);
  });
  it('reports missing recipients', async () => {
    const { p } = run({ configured: true, send: async () => undefined } as Mailer, job(), { ...settings, runSheetRecipients: [] });
    expect((await p).error).toMatch(/recipients/);
  });
});
