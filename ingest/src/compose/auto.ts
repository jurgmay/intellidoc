import type sql from 'mssql';
import { composeJob, PdfNotFiledError, type ComposedBatch } from './job.js';
import { jobsToCompose, loadComposeSettings } from './db.js';
import type { GreyConverter } from './grey.js';
import type { Mailer } from '../mail.js';
import type { ActivityLog } from '../activity.js';

export interface AutoComposerOptions {
  pool: sql.ConnectionPool;
  /** Where the watcher keeps PDFs it has processed. */
  pdfDir: string;
  outDir: string;
  /** Where MRDF files go (the inserter's input folder). */
  mrdfDir?: string;
  grey: GreyConverter | null;
  /** Sends the run sheet e-mail (when it is on in Settings) as a job's print files are first made. */
  mailer?: Mailer;
  /** Records progress for the Activity screen. */
  activity?: ActivityLog;
  log: (level: 'info' | 'warn' | 'error', msg: string) => void;
  /** Told once when a job has failed several times in a row. */
  notify?: (subject: string, text: string) => Promise<void>;
  now?: () => number;
  /** Stand-ins for the database and the composer (tests). */
  isEnabled?: () => Promise<boolean>;
  listJobs?: () => Promise<number[]>;
  compose?: (jobId: number, waitForPdf: boolean) => Promise<ComposedBatch[]>;
}

const PDF_GRACE_MINUTES = 5;     // how long a job may wait for its PDF to be filed before that counts as a failure
const ALERT_AFTER = 3;           // consecutive failures before an e-mail
const BACKOFF_MINUTES = [1, 2, 5, 10, 30]; // wait after the 1st, 2nd, ... failure; the last value repeats

/**
 * Makes the print files of Received jobs that have none, when "Make print files automatically" is on. Call run() every minute.
 * A job that fails is tried again after a growing wait, and an e-mail goes out once after three failures in a row. Nothing is given up on.
 */
export class AutoComposer {
  private running = false;
  private readonly waiting = new Map<number, number>();
  private readonly failures = new Map<number, { count: number; retryAt: number }>();
  constructor(private readonly o: AutoComposerOptions) {}
  private now(): number { return (this.o.now ?? Date.now)(); }

  /** True once a job has waited for its PDF longer than the grace period (and so should be reported if it is still missing). */
  private pastGrace(jobId: number): boolean {
    const since = this.waiting.get(jobId) ?? (this.waiting.set(jobId, this.now()), this.now());
    return this.now() - since >= PDF_GRACE_MINUTES * 60_000;
  }

  /** Returns the number of jobs composed. Never throws. */
  async run(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let done = 0;
    try {
      if (!(await (this.o.isEnabled ?? (async () => (await loadComposeSettings(this.o.pool)).autoCompose))())) return 0;
      for (const jobId of await (this.o.listJobs ?? (() => jobsToCompose(this.o.pool)))()) {
        const f = this.failures.get(jobId);
        if (f && this.now() < f.retryAt) continue;
        try {
          const batches = await (this.o.compose ?? ((id, waitForPdf) => composeJob({ waitForPdf, pool: this.o.pool, jobId: id, pdfDir: this.o.pdfDir, outDir: this.o.outDir, mrdfDir: this.o.mrdfDir, grey: this.o.grey, onlyNew: true, mailer: this.o.mailer, activity: this.o.activity, onRunSheetEmail: (r) => this.o.log(r.sent ? 'info' : 'warn', r.sent ? `Job ${id}: run sheets e-mailed to ${[...r.to, ...r.cc].join(', ')}` : `Job ${id}: run sheets not e-mailed: ${r.error}`) })))(jobId, !this.pastGrace(jobId));
          const made = batches.filter((b) => b.files.length > 0);
          this.o.log('info', `Job ${jobId}: print files made for ${made.length} batch${made.length === 1 ? '' : 'es'} (${made.flatMap((b) => b.files).length} files)`);
          this.failures.delete(jobId); this.waiting.delete(jobId);
          done++;
        } catch (e) {
          if (e instanceof PdfNotFiledError && !this.pastGrace(jobId)) continue; // the watcher has not filed the PDF yet; try again next minute
          const count = (f?.count ?? 0) + 1;
          this.failures.set(jobId, { count, retryAt: this.now() + BACKOFF_MINUTES[Math.min(count, BACKOFF_MINUTES.length) - 1]! * 60_000 });
          const msg = (e as Error).message;
          this.o.log('error', `Job ${jobId}: could not make the print files (attempt ${count}): ${msg}`);
          if (count === ALERT_AFTER) {
            try { await this.o.notify?.(`IntelliDoc: print files not made for job ${jobId}`, `The print files for job ${jobId} could not be made after ${count} attempts.\n\n${msg}\n\nThe watcher keeps trying. You can also run: npm run compose -- ${jobId} <outDir>`); }
            catch (m) { this.o.log('error', `Could not send the alert: ${(m as Error).message}`); }
          }
        }
      }
    } catch (e) {
      this.o.log('error', `Print file check failed: ${(e as Error).message}`);
    } finally { this.running = false; }
    return done;
  }
}
