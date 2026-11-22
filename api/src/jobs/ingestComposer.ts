import { basename, join, resolve } from 'node:path';
import type sql from 'mssql';
import { connectPool } from '../../../ingest/src/mssql/connect.js';
import { composeJob } from '../../../ingest/src/compose/job.js';
import { GhostscriptGrey } from '../../../ingest/src/compose/grey.js';
import { LogMailer, smtpFromEnv, SmtpMailer, type Mailer } from '../../../ingest/src/mail.js';
import { emailRunSheets, jobRunSheetsPdf, loadJobEmailSummary, buildRunSheetEmail } from '../../../ingest/src/runsheet/email.js';
import type { ComposeOutcome, JobComposer, RunSheetEmailOutcome } from './types.js';

/**
 * Makes print files with the same code as the watcher. It needs the folders the watcher uses (set in the API's .env):
 * The run sheet e-mail uses the watcher's SMTP_* settings. WATCH_DIR (the PDFs are in its "processed" folder), COMPOSE_OUT_DIR, and optionally MRDF_OUT_DIR. GS_PATH names Ghostscript.
 */
export class IngestJobComposer implements JobComposer {
  private readonly pdfDir: string | null; private readonly outDir: string | null; private readonly mrdfDir: string | undefined;
  private readonly mailer: Mailer;
  constructor(private readonly connectionString: string, env: Record<string, string | undefined> = process.env, mailer?: Mailer) {
    this.mailer = mailer ?? (() => { try { const c = smtpFromEnv(env); if (c) return new SmtpMailer(c); } catch (e) { console.error(`SMTP settings ignored: ${(e as Error).message}`); } return new LogMailer((_l, m) => console.log(m)); })();
    this.pdfDir = env['WATCH_DIR'] ? join(resolve(env['WATCH_DIR']), 'processed') : null;
    this.outDir = env['COMPOSE_OUT_DIR'] ? resolve(env['COMPOSE_OUT_DIR']) : null;
    this.mrdfDir = env['MRDF_OUT_DIR'] ? resolve(env['MRDF_OUT_DIR']) : undefined;
  }
  private poolPromise: Promise<sql.ConnectionPool> | null = null;
  /** The composer's own pool, made by the ingest code's copy of the driver (see connectPool). */
  private db(): Promise<sql.ConnectionPool> {
    this.poolPromise ??= connectPool(this.connectionString).catch((e) => { this.poolPromise = null; throw e; });
    return this.poolPromise;
  }
  unavailable(): string | null {
    if (!this.pdfDir) return 'WATCH_DIR is not set on the API server, so it cannot find the customers\' PDFs. Set it in the API\'s .env and restart.';
    if (!this.outDir) return 'COMPOSE_OUT_DIR is not set on the API server, so it has nowhere to put the print files. Set it in the API\'s .env and restart.';
    return null;
  }
  async compose(jobId: number, onlyNew: boolean): Promise<ComposeOutcome> {
    let runSheetEmail: RunSheetEmailOutcome | null = null;
    const batches = await composeJob({ pool: await this.db(), jobId, pdfDir: this.pdfDir!, outDir: this.outDir!, mrdfDir: this.mrdfDir, grey: new GhostscriptGrey(), onlyNew,
      mailer: this.mailer, onRunSheetEmail: (r) => { runSheetEmail = { sent: r.sent, to: r.to, cc: r.cc, testMode: r.testMode, error: r.error }; } });
    return { batches: batches.map((b) => ({ batchCode: b.batchCode, files: b.files.map((f) => basename(f)), mrdfFile: b.mrdfFile ? basename(b.mrdfFile) : null, skipped: b.skipped ?? null })), runSheetEmail };
  }
  async emailRunSheets(jobId: number): Promise<RunSheetEmailOutcome> {
    const r = await emailRunSheets(await this.db(), jobId, this.mailer);
    return { sent: r.sent, to: r.to, cc: r.cc, testMode: r.testMode, error: r.error };
  }
  async runSheetsPdf(jobId: number): Promise<{ fileName: string; bytes: Uint8Array }> {
    const pool = await this.db();
    const [bytes, summary] = await Promise.all([jobRunSheetsPdf(pool, jobId), loadJobEmailSummary(pool, jobId)]);
    return { fileName: buildRunSheetEmail(summary).attachmentName, bytes };
  }
}
