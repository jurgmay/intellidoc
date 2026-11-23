import sql from 'mssql';
import { composedPages, paddingPages, type ColourMode, type PackPages } from '../costing/colour.js';
import type { Mailer } from '../mail.js';
import { buildRunSheet } from './data.js';
import { loadRunSheetInputs } from './query.js';
import { mergePdfs, renderRunSheet } from './pdf.js';

/** What the run sheet e-mail says about one batch. */
export interface BatchEmailSummary {
  batchCode: number; service: string; envelope: string; department: string; mailpieces: number; pages: number;
  colourPages: number; monoPages: number; blankPages: number; weightBands: string[]; fileName: string;
}
export interface JobEmailSummary {
  jobName: string; customerName: string; jobNumber: string;
  /** The customer is marked Testing: the e-mail goes to the alert recipients only. */
  isTesting: boolean;
  /** The customer archives every mailpiece. */
  archive: boolean;
  /** The customer's notification addresses (Cc). */
  customerEmails: string[];
  mailpieces: number; packs: number; sheets: number; colourPages: number; monoPages: number; blankPages: number;
  batches: BatchEmailSummary[];
}
export interface EmailSettings { enabled: boolean; runSheetRecipients: string[]; alertRecipients: string[] }

const n = (v: number): string => v.toLocaleString('en-GB');
const RULE = '='.repeat(60);

/** The subject, plain-text body and attachment name, worded as FileMaker's "Email Run Sheets" script did. */
export function buildRunSheetEmail(j: JobEmailSummary): { subject: string; text: string; attachmentName: string } {
  const lines: string[] = [j.customerName.toUpperCase(), RULE, '',
    `Total mailpieces: ${n(j.mailpieces)}`, `Total packs submitted: ${n(j.packs)}`, `Total sheets: ${n(j.sheets)}`,
    `Total pages: ${n(j.colourPages + j.monoPages + j.blankPages)} (${n(j.colourPages)} colour, ${n(j.monoPages)} mono, ${n(j.blankPages)} blank)`, ''];
  if (j.archive) lines.push('ALL MAILPIECES TO BE ARCHIVED', '');
  for (const b of j.batches) {
    lines.push(RULE, '', `${b.service} - ${b.envelope} - ${b.department}`, '', `Mailpieces: ${n(b.mailpieces)}`, '', `Total pages: ${n(b.pages)}`, '',
      `Colour pages: ${n(b.colourPages)}`, `Mono pages: ${n(b.monoPages)}`, `Blank pages: ${n(b.blankPages)}`, '', 'Weight bands:', ...b.weightBands, '', `Filename: ${b.fileName}`, '');
  }
  lines.push(RULE, '');
  const count = j.batches.length;
  const first = j.batches[0]?.batchCode, last = j.batches[count - 1]?.batchCode;
  const attachmentName = `${[j.jobNumber, `IntelliDoc Run Sheet${count > 1 ? 's' : ''}`, j.customerName, `${count} batch${count > 1 ? 'es' : ''} (${first} - ${last})`].filter((x) => x !== '').join(' - ').replace(/[\\/:*?"<>|]/g, '-')}.pdf`;
  return { subject: `${j.isTesting ? '[TEST] ' : ''}${j.jobName}`, text: lines.join('\n'), attachmentName };
}

/** Who gets it: the first run sheet recipient is the To and the rest, plus the customer's addresses, are Cc. A customer in testing sends to the alert recipients only. */
export function pickRecipients(j: Pick<JobEmailSummary, 'isTesting' | 'customerEmails'>, s: EmailSettings): { to: string[]; cc: string[]; problem?: string } {
  if (j.isTesting) return s.alertRecipients.length ? { to: s.alertRecipients, cc: [] } : { to: [], cc: [], problem: 'This customer is marked Testing and no alert recipients are set (Settings), so there is nobody to send the test run sheets to.' };
  if (!s.runSheetRecipients.length) return { to: [], cc: [], problem: 'No run sheet e-mail recipients are set (Settings).' };
  const to = [s.runSheetRecipients[0]!];
  const seen = new Set(to.map((e) => e.toLowerCase()));
  const cc = [...s.runSheetRecipients.slice(1), ...j.customerEmails].filter((e) => { const k = e.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  return { to, cc };
}

export interface RunSheetEmailResult { sent: boolean; to: string[]; cc: string[]; testMode: boolean; attachment: string | null; error: string | null }

export interface RunSheetEmailDeps {
  mailer: Mailer;
  summary(): Promise<JobEmailSummary>;
  settings(): Promise<EmailSettings>;
  pdf(): Promise<Uint8Array>;
  /** Called once the e-mail has gone. */
  sent(): Promise<void>;
}

/** Sends the e-mail. Never throws for a problem the user can fix: it comes back as { sent: false, error }. */
export async function sendRunSheetEmail(d: RunSheetEmailDeps): Promise<RunSheetEmailResult> {
  const fail = (error: string, extra: Partial<RunSheetEmailResult> = {}): RunSheetEmailResult => ({ sent: false, to: [], cc: [], testMode: false, attachment: null, error, ...extra });
  if (d.mailer.configured === false) return fail('No mail server is set up on this server (SMTP_HOST in its .env file), so nothing can be e-mailed.');
  const [summary, settings] = await Promise.all([d.summary(), d.settings()]);
  if (summary.batches.length === 0) return fail('The job has no batches, so there are no run sheets to send.');
  const { to, cc, problem } = pickRecipients(summary, settings);
  if (problem) return fail(problem, { testMode: summary.isTesting });
  const mail = buildRunSheetEmail(summary);
  try {
    await d.mailer.send(to, mail.subject, mail.text, { cc, attachments: [{ filename: mail.attachmentName, content: await d.pdf(), contentType: 'application/pdf' }] });
  } catch (e) { return fail(`The mail server refused it: ${(e as Error).message}`, { to, cc, testMode: summary.isTesting, attachment: mail.attachmentName }); }
  await d.sent();
  return { sent: true, to, cc, testMode: summary.isTesting, attachment: mail.attachmentName, error: null };
}

export async function loadEmailSettings(pool: sql.ConnectionPool): Promise<EmailSettings> {
  const r = (await pool.request().query<{ on: number; rs: string; al: string }>('SELECT CAST(email_run_sheets AS INT) AS [on], run_sheet_recipients AS rs, alert_recipients AS al FROM idoc.settings WHERE settings_id = 1')).recordset[0];
  if (!r) throw new Error('idoc.settings has no row');
  const list = (s: string): string[] => s.split(/[;,]/).map((x) => x.trim()).filter(Boolean);
  return { enabled: r.on === 1, runSheetRecipients: list(r.rs), alertRecipients: list(r.al) };
}

/** The job as the e-mail describes it. Page counts are what is printed (the colour mode applied), the same figures pricing bills. */
export async function loadJobEmailSummary(pool: sql.ConnectionPool, jobId: number): Promise<JobEmailSummary> {
  const job = (await pool.request().input('j', sql.BigInt, jobId).query<{ account_id: number; base_name: string; name: string; testing: boolean; archive: boolean }>(`
    SELECT j.account_id, j.base_name, a.name, CAST(CASE WHEN a.is_testing = 1 OR o.is_testing = 1 THEN 1 ELSE 0 END AS BIT) AS testing, o.is_archive_mailpieces AS archive
    FROM idoc.job AS j INNER JOIN idoc.account AS a ON a.account_id = j.account_id
    INNER JOIN idoc.v_account_owner AS v ON v.account_id = a.account_id INNER JOIN idoc.account AS o ON o.account_id = v.owner_account_id
    WHERE j.job_id = @j`)).recordset[0];
  if (!job) throw new Error(`Job ${jobId} does not exist`);
  const emails = (await pool.request().input('a', sql.Int, job.account_id).query<{ email: string }>(`
    SELECT DISTINCT e.email FROM idoc.v_account_setting_source AS s INNER JOIN idoc.account_notification_email AS e ON e.account_id = s.source_account_id
    WHERE s.account_id = @a AND s.setting = N'emails' ORDER BY e.email`)).recordset.map((r) => r.email);
  const mps = (await pool.request().input('j', sql.BigInt, jobId).query<{ batch_code: number; pack_count: number; sheet_count: number; colour_mode: string; packs_json: string | null }>(`
    SELECT b.batch_code, m.pack_count, m.sheet_count,
           COALESCE((SELECT a.colour_mode FROM idoc.v_account_owner AS o INNER JOIN idoc.account AS a ON a.account_id = o.owner_account_id WHERE o.account_id = m.submitting_account_id), N'ORIGINAL') AS colour_mode,
           (SELECT COALESCE(x.colour_pages, 0) AS colour, COALESCE(x.mono_pages, 0) AS mono, COALESCE(x.blank_pages, 0) AS blank,
                   CASE WHEN o.colour LIKE N'Mono%' THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS forceMono
            FROM idoc.pack AS x INNER JOIN idoc.option_set AS o ON o.option_set_id = x.option_set_id
            WHERE x.mailpiece_id = m.mailpiece_id ORDER BY x.document_sequence, x.pack_id FOR JSON PATH) AS packs_json
    FROM idoc.mailpiece AS m INNER JOIN idoc.batch AS b ON b.batch_id = m.batch_id
    WHERE b.job_id = @j AND m.is_cancelled = 0 AND b.current_status <> N'Cancelled'`)).recordset;
  const per = new Map<number, PackPages>();
  let packs = 0, sheets = 0;
  for (const m of mps) {
    const packPages = m.packs_json ? (JSON.parse(m.packs_json) as PackPages[]) : [];
    const p = composedPages(m.colour_mode as ColourMode, packPages);
    p.blank += paddingPages(packPages);   // the blank the composer adds after an odd pack is printed too
    const t = per.get(Number(m.batch_code)) ?? { colour: 0, mono: 0, blank: 0 };
    t.colour += p.colour; t.mono += p.mono; t.blank += p.blank; per.set(Number(m.batch_code), t);
    packs += m.pack_count; sheets += m.sheet_count;
  }
  const inputs = await loadRunSheetInputs(pool, jobId);
  const batches: BatchEmailSummary[] = inputs.map((i) => {
    const d = buildRunSheet(i); const pg = per.get(Number(i.batchCode)) ?? { colour: 0, mono: 0, blank: 0 };
    return { batchCode: Number(i.batchCode), service: d.postalService, envelope: d.envelope, department: d.department, mailpieces: d.totalMailpieces, pages: pg.colour + pg.mono + pg.blank,
      colourPages: pg.colour, monoPages: pg.mono, blankPages: pg.blank, weightBands: d.weightBands, fileName: d.fileName };
  });
  const sum = (f: (b: BatchEmailSummary) => number): number => batches.reduce((t, b) => t + f(b), 0);
  return { jobName: job.base_name, customerName: job.name, jobNumber: inputs[0]?.jobNumber ?? '', isTesting: !!job.testing, archive: !!job.archive, customerEmails: emails,
    mailpieces: sum((b) => b.mailpieces), packs, sheets, colourPages: sum((b) => b.colourPages), monoPages: sum((b) => b.monoPages), blankPages: sum((b) => b.blankPages), batches };
}

/** The run sheets of every batch of a job as one PDF, in batch order (the same pages that start each print file). */
/** `ready` holds run sheets already drawn (by batch code), which are used as they are; `onStep` hears what is being done. */
export interface RunSheetReuse { ready?: ReadonlyMap<number, Uint8Array>; onStep?: (detail: string) => void }

export async function jobRunSheetsPdf(pool: sql.ConnectionPool, jobId: number, logo?: Uint8Array, reuse: RunSheetReuse = {}): Promise<Uint8Array> {
  reuse.onStep?.('loading the run sheet details');
  const inputs = await loadRunSheetInputs(pool, jobId);
  if (!inputs.length) throw new Error(`Job ${jobId} has no batches`);
  const parts: Uint8Array[] = [];
  for (const [n, i] of inputs.entries()) {
    reuse.onStep?.(`run sheet ${n + 1} of ${inputs.length}`);
    parts.push(reuse.ready?.get(Number(i.batchCode)) ?? await renderRunSheet(buildRunSheet(i), logo));
  }
  reuse.onStep?.('joining the run sheets');
  return mergePdfs(parts);
}

/** E-mails the job's run sheets and, when they have gone, stamps the job. Does not look at the on/off setting: the caller decides. */
export function emailRunSheets(pool: sql.ConnectionPool, jobId: number, mailer: Mailer, logo?: Uint8Array, reuse: RunSheetReuse = {}): Promise<RunSheetEmailResult> {
  return sendRunSheetEmail({
    mailer, summary: () => loadJobEmailSummary(pool, jobId), settings: () => loadEmailSettings(pool), pdf: async () => { const r = await jobRunSheetsPdf(pool, jobId, logo, reuse); reuse.onStep?.('sending the e-mail'); return r; },
    sent: async () => { await pool.request().input('j', sql.BigInt, jobId).query('UPDATE idoc.job SET run_sheets_emailed_at = SYSUTCDATETIME() WHERE job_id = @j'); },
  });
}
