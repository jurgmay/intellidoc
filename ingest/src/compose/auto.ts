import type sql from 'mssql';
import { composeJob, type ComposedBatch } from './job.js';
import { jobsToCompose, loadComposeSettings } from './db.js';
import type { GreyConverter } from './grey.js';
import type { Mailer } from '../mail.js';

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
  log: (level: 'info' | 'warn' | 'error', msg: string) => void;
  /** Told once when a job has failed several times in a row. */
  notify?: (subject: string, text: string) => Promise<void>;
  now?: () => number;
  /** Stand-ins for the database and the composer (tests). */
  isEnabled?: () => Promise<boolean>;
  listJobs?: () => Promise<number[]>;
  compose?: (jobId: number) => Promise<ComposedBatch[]>;
}

const ALERT_AFTER = 3;           // consecutive failures before an e-mail
const BACKOFF_MINUTES = [1, 2, 5, 10, 30]; // wait after the 1st, 2nd, ... failure; the last value repeats

/**
 * Makes the print files of Received jobs that have none, when "Make print files automatically" is on. Call run() every minute.
 * A job that fails is tried again after a growing wait, and an e-mail goes out once after three failures in a row. Nothing is given up on.
 */
export class AutoComposer {
  private running = false;
  private readonly failures = new Map<number, { count: number; retryAt: number }>();
  constructor(private readonly o: AutoComposerOptions) {}
  private now(): number { return (this.o.now ?? Date.now)(); }

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
          const batches = await (this.o.compose ?? ((id) => composeJob({ pool: this.o.pool, jobId: id, pdfDir: this.o.pdfDir, outDir: this.o.outDir, mrdfDir: this.o.mrdfDir, grey: this.o.grey, onlyNew: true, mailer: this.o.mailer, onRunSheetEmail: (r) => this.o.log(r.sent ? 'info' : 'warn', r.sent ? `Job ${id}: run sheets e-mailed to ${[...r.to, ...r.cc].join(', ')}` : `Job ${id}: run sheets not e-mailed: ${r.error}`) })))(jobId);
          const made = batches.filter((b) => b.files.length > 0);
          this.o.log('info', `Job ${jobId}: print files made for ${made.length} batch${made.length === 1 ? '' : 'es'} (${made.flatMap((b) => b.files).length} files)`);
          this.failures.delete(jobId);
          done++;
        } catch (e) {
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
