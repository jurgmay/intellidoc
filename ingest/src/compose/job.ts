import { mkdir, readdir, rm, stat, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sql from 'mssql';
import { PDFDocument } from 'pdf-lib';
import { applyDuePendingJobNumbers } from '../mssql/jobNumbers.js';
import { buildRunSheet, paperFacts } from '../runsheet/data.js';
import { renderRunSheet } from '../runsheet/pdf.js';
import { loadRunSheetInputs } from '../runsheet/query.js';
import { composeBatch } from './compose.js';
import { loadComposeSettings, loadJobToCompose, recordedFiles, saveComposition } from './db.js';
import type { GreyConverter } from './grey.js';
import { planBatch } from './plan.js';

export interface ComposeJobOptions {
  pool: sql.ConnectionPool; jobId: number;
  /** Where the customer's PDF is: the watcher's processed folder (it puts a prefix on the name, so the file is found by the end of its name). */
  pdfDir: string;
  outDir: string;
  logo?: Uint8Array;
  grey: GreyConverter | null;
  /** Leave alone a batch that already has print files (the automatic run); the default composes again. */
  onlyNew?: boolean;
}
export interface ComposedBatch { batchCode: number; files: string[]; skipped?: string }

/** The newest file in `dir` named `name`, or `name` with the watcher's clash prefix (yyyymmddhhmmss, optionally -n, then an underscore). */
export async function findSourcePdf(dir: string, name: string): Promise<string> {
  const lower = name.toLowerCase();
  const hits = (await readdir(dir)).filter((f) => { const l = f.toLowerCase(); return l === lower || (l.endsWith(`_${lower}`) && /^\d{14}(-\d+)?$/.test(l.slice(0, l.length - lower.length - 1))); });
  if (!hits.length) throw new Error(`The PDF "${name}" is not in ${dir}`);
  const withTime = await Promise.all(hits.map(async (f) => ({ f, t: (await stat(join(dir, f))).mtimeMs })));
  return join(dir, withTime.sort((a, b) => b.t - a.t)[0]!.f);
}

export const printFileName = (batchCode: number, segment: number): string => `${batchCode}_${segment}.pdf`;

/** Composes the print file(s) of every batch of a job that is still Created. Safe to run again: it replaces its own files and records. */
export async function composeJob(o: ComposeJobOptions): Promise<ComposedBatch[]> {
  const job = await loadJobToCompose(o.pool, o.jobId);
  if (job.status !== 'Received') throw new Error(`Job ${o.jobId} is "${job.status}"; only a Received job (its PDF checked) can be composed`);
  const source = new Uint8Array(await readFile(await findSourcePdf(o.pdfDir, job.pdfFileName)));
  const settings = await loadComposeSettings(o.pool);
  await applyDuePendingJobNumbers(o.pool); // a job number due today must be on the run sheet
  const runInputs = await loadRunSheetInputs(o.pool, o.jobId);
  await mkdir(o.outDir, { recursive: true });

  const result: ComposedBatch[] = [];
  for (const b of job.batches) {
    if (b.status !== 'Created') { result.push({ batchCode: b.batchCode, files: [], skipped: `the batch is ${b.status}` }); continue; }
    if (o.onlyNew && (await recordedFiles(o.pool, b.batchId)).length > 0) { result.push({ batchCode: b.batchCode, files: [], skipped: 'already composed' }); continue; }
    const input = runInputs.find((r) => Number(r.batchCode) === b.batchCode);
    if (!input) throw new Error(`No run sheet data for batch ${b.batchCode}`);
    const runSheet = await renderRunSheet(buildRunSheet(input), o.logo);
    const runPages = (await PDFDocument.load(runSheet)).getPageCount();
    const plan = planBatch(b.mailpieces, { maxPagesPerPdf: settings.maxPagesPerPdf, runSheetPages: runPages + (runPages % 2) });
    if (!plan.segments.length) { result.push({ batchCode: b.batchCode, files: [], skipped: 'no mailpieces to print' }); continue; }

    const files = await composeBatch({
      batchCode: b.batchCode, source, runSheet, plan, marks: settings.marks, grey: o.grey, fileName: (n) => printFileName(b.batchCode, n),
      keywords: b.paperName && paperFacts(b.paperName).edgeToEdge ? ['imposition:SRA4'] : undefined,
    });
    const old = await recordedFiles(o.pool, b.batchId);
    for (const f of files) await writeFile(join(o.outDir, f.fileName), f.bytes);
    await saveComposition(o.pool, b.batchId, plan, files);
    for (const name of old) if (!files.some((f) => f.fileName === name)) await rm(join(o.outDir, name), { force: true });
    result.push({ batchCode: b.batchCode, files: files.map((f) => join(o.outDir, f.fileName)) });
  }
  return result;
}
