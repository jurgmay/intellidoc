import { basename, join, resolve } from 'node:path';
import type sql from 'mssql';
import { composeJob } from '../../../ingest/src/compose/job.js';
import { GhostscriptGrey } from '../../../ingest/src/compose/grey.js';
import type { ComposeBatchResult, JobComposer } from './types.js';

/**
 * Makes print files with the same code as the watcher. It needs the folders the watcher uses (set in the API's .env):
 * WATCH_DIR (the PDFs are in its "processed" folder), COMPOSE_OUT_DIR, and optionally MRDF_OUT_DIR. GS_PATH names Ghostscript.
 */
export class IngestJobComposer implements JobComposer {
  private readonly pdfDir: string | null; private readonly outDir: string | null; private readonly mrdfDir: string | undefined;
  constructor(private readonly pool: sql.ConnectionPool, env: Record<string, string | undefined> = process.env) {
    this.pdfDir = env['WATCH_DIR'] ? join(resolve(env['WATCH_DIR']), 'processed') : null;
    this.outDir = env['COMPOSE_OUT_DIR'] ? resolve(env['COMPOSE_OUT_DIR']) : null;
    this.mrdfDir = env['MRDF_OUT_DIR'] ? resolve(env['MRDF_OUT_DIR']) : undefined;
  }
  unavailable(): string | null {
    if (!this.pdfDir) return 'WATCH_DIR is not set on the API server, so it cannot find the customers\' PDFs. Set it in the API\'s .env and restart.';
    if (!this.outDir) return 'COMPOSE_OUT_DIR is not set on the API server, so it has nowhere to put the print files. Set it in the API\'s .env and restart.';
    return null;
  }
  async compose(jobId: number, onlyNew: boolean): Promise<ComposeBatchResult[]> {
    const batches = await composeJob({ pool: this.pool, jobId, pdfDir: this.pdfDir!, outDir: this.outDir!, mrdfDir: this.mrdfDir, grey: new GhostscriptGrey(), onlyNew });
    return batches.map((b) => ({ batchCode: b.batchCode, files: b.files.map((f) => basename(f)), mrdfFile: b.mrdfFile ? basename(b.mrdfFile) : null, skipped: b.skipped ?? null }));
  }
}
