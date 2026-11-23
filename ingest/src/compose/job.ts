import { mkdir, readdir, rename, rm, stat, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sql from 'mssql';
import { PDFDocument } from 'pdf-lib';
import { applyDuePendingJobNumbers } from '../mssql/jobNumbers.js';
import { buildRunSheet, paperFacts } from '../runsheet/data.js';
import { renderRunSheet } from '../runsheet/pdf.js';
import { loadRunSheetInputs } from '../runsheet/query.js';
import type { Mailer } from '../mail.js';
import { noActivity, type ActivityLog } from '../activity.js';
import { emailRunSheets, loadEmailSettings, type RunSheetEmailResult } from '../runsheet/email.js';
import { composeBatch } from './compose.js';
import type { BatchToCompose } from './db.js';
import type { BatchPlan } from './plan.js';
import { loadComposeSettings, loadJobToCompose, loadMrdfRecipients, recordedFiles, saveComposition } from './db.js';
import { batchKeywords } from './keywords.js';
import { buildMrdf, encodeAnsi, mailpiecePages } from './mrdf.js';
import type { GreyConverter } from './grey.js';
import { planBatch } from './plan.js';

export interface ComposeJobOptions {
  pool: sql.ConnectionPool; jobId: number;
  /** Where the customer's PDF is: the watcher's processed folder (it puts a prefix on the name, so the file is found by the end of its name). */
  pdfDir: string;
  outDir: string;
  /** Where the MRDF files (<batchCode>.txt) go: the inserter's input folder. Without it no MRDF file is made, but the page codes are still printed. */
  mrdfDir?: string;
  logo?: Uint8Array;
  grey: GreyConverter | null;
  /** Leave alone a batch that already has print files (the automatic run); the default composes again. */
  onlyNew?: boolean;
  /**
   * With a mailer, and "E-mail run sheets" on in Settings, the run sheets are e-mailed once, when the job's print files are first made.
   * A job that has been e-mailed (idoc.job.run_sheets_emailed_at) is not e-mailed again. A failure to send never fails the compose.
   */
  mailer?: Mailer;
  /** Where progress is recorded for the Activity screen (default: nowhere). */
  activity?: ActivityLog;
  /** Told what happened to the e-mail (only when one was attempted). */
  onRunSheetEmail?: (r: RunSheetEmailResult) => void;
}
/** Turns a stream of fine-grained progress into at most one database write a second (always writing when `force`). */
function throttledSteps(log: ActivityLog, act: number | null, total: number) {
  let last = 0;
  return async (done: number, detail: string, force = false): Promise<void> => {
    const now = Date.now();
    if (!force && now - last < 1000) return;
    last = now;
    await log.step(act, Math.min(total, Math.round(done)), total, detail);
  };
}

export interface ComposedBatch { batchCode: number; files: string[]; mrdfFile?: string; skipped?: string }

/** The newest file in `dir` named `name`, or `name` with the watcher's clash prefix (yyyymmddhhmmss, optionally -n, then an underscore). */
export async function findSourcePdf(dir: string, name: string): Promise<string> {
  const lower = name.toLowerCase();
  const hits = (await readdir(dir)).filter((f) => { const l = f.toLowerCase(); return l === lower || (l.endsWith(`_${lower}`) && /^\d{14}(-\d+)?$/.test(l.slice(0, l.length - lower.length - 1))); });
  if (!hits.length) throw new Error(`The PDF "${name}" is not in ${dir}`);
  const withTime = await Promise.all(hits.map(async (f) => ({ f, t: (await stat(join(dir, f))).mtimeMs })));
  return join(dir, withTime.sort((a, b) => b.t - a.t)[0]!.f);
}

/**
 * The print file's name, as the run sheet's File name row says it: "77440 - IntelliDoc - Uinsure - 81899 - Batch 16 of 23.pdf"
 * (runSheetName). A batch in several files gets " - Segment 1 of 2" before the .pdf, as FileMaker named them.
 */
export function printFileName(runSheetName: string, segment: number, segments: number): string {
  if (segments <= 1) return runSheetName;
  return `${runSheetName.replace(/\.pdf$/i, '')} - Segment ${segment} of ${segments}.pdf`;
}

/** Composes the print file(s) of every batch of a job that is still Created. Safe to run again: it replaces its own files and records. */
export async function composeJob(o: ComposeJobOptions): Promise<ComposedBatch[]> {
  const log = o.activity ?? noActivity;
  const job = await loadJobToCompose(o.pool, o.jobId);
  const todo = job.batches.filter((b) => b.status === 'Created').length;
  // The bar counts mailpieces, so a batch of thousands is as long as it should be next to one of a few.
  const pieces = job.batches.filter((b) => b.status === 'Created').reduce((t, b) => t + b.mailpieces.length, 0);
  const act = await log.start('Print files', `Job ${o.jobId}: ${job.pdfFileName}`, o.jobId, Math.max(1, pieces));
  try {
    const result = await composeJobBatches(o, job, act, log, todo, Math.max(1, pieces));
    await log.finish(act, 'Done', `${result.filter((r) => r.files.length > 0).length} of ${todo} batches made`);
    return result;
  } catch (e) { await log.finish(act, 'Failed', (e as Error).message); throw e; }
}

async function composeJobBatches(o: ComposeJobOptions, job: Awaited<ReturnType<typeof loadJobToCompose>>, act: number | null, log: ActivityLog, todo: number, pieces: number): Promise<ComposedBatch[]> {
  if (job.status !== 'Received') throw new Error(`Job ${o.jobId} is "${job.status}"; only a Received job (its PDF checked) can be composed`);
  const source = new Uint8Array(await readFile(await findSourcePdf(o.pdfDir, job.pdfFileName)));
  const settings = await loadComposeSettings(o.pool);
  await applyDuePendingJobNumbers(o.pool); // a job number due today must be on the run sheet
  const runInputs = await loadRunSheetInputs(o.pool, o.jobId);
  await mkdir(o.outDir, { recursive: true });

  const result: ComposedBatch[] = [];
  let batchNo = 0, piecesDone = 0;
  const step = throttledSteps(log, act, pieces);
  const rendered = new Map<number, Uint8Array>();
  for (const b of job.batches) {
    if (b.status !== 'Created') { result.push({ batchCode: b.batchCode, files: [], skipped: `the batch is ${b.status}` }); continue; }
    if (o.onlyNew && (await recordedFiles(o.pool, b.batchId)).length > 0) { piecesDone += b.mailpieces.length; result.push({ batchCode: b.batchCode, files: [], skipped: 'already composed' }); continue; }
    batchNo++;
    const at = `${batchNo - 1} of ${todo} batches. Batch ${b.batchCode} (${batchNo} of ${todo})`;
    const size = b.mailpieces.length;
    await step(piecesDone, `${at}: preparing`, true);
    const input = runInputs.find((r) => Number(r.batchCode) === b.batchCode);
    if (!input) throw new Error(`No run sheet data for batch ${b.batchCode}`);
    const runData = buildRunSheet(input);
    const runSheet = await renderRunSheet(runData, o.logo);
    rendered.set(b.batchCode, runSheet);
    const runPages = (await PDFDocument.load(runSheet)).getPageCount();
    const plan = planBatch(b.mailpieces, { maxPagesPerPdf: settings.maxPagesPerPdf, runSheetPages: runPages + (runPages % 2) });
    if (!plan.segments.length) { piecesDone += size; result.push({ batchCode: b.batchCode, files: [], skipped: 'no mailpieces to print' }); continue; }

    const kw = batchKeywords({ archive: b.archive, edgeToEdge: !!b.paperName && paperFacts(b.paperName).edgeToEdge });
    const files = await composeBatch({
      batchCode: b.batchCode, source, runSheet, plan, marks: settings.marks, grey: o.grey, fileName: (n, total) => printFileName(runData.fileName, n, total),
      keywords: kw ? [kw] : undefined, mrdf: b.mrdf !== null,
      // Building the files is 90% of a batch; writing, saving and the MRDF file take the rest.
      onProgress: (f, what) => { void step(piecesDone + size * 0.9 * f, `${at}: ${what}`); },
    });
    await step(piecesDone + size * 0.9, `${at}: writing the files`, true);
    const old = await recordedFiles(o.pool, b.batchId);
    for (const f of files) await writeFile(join(o.outDir, f.fileName), f.bytes);
    await step(piecesDone + size * 0.94, `${at}: saving to the database`, true);
    await saveComposition(o.pool, b.batchId, plan, files);
    for (const name of old) if (!files.some((f) => f.fileName === name)) await rm(join(o.outDir, name), { force: true });
    let mrdfFile: string | undefined;
    if (b.mrdf && o.mrdfDir) await step(piecesDone + size * 0.98, `${at}: writing the MRDF file`, true);
    if (b.mrdf && o.mrdfDir) mrdfFile = await writeMrdfFile(o.pool, o.mrdfDir, b, plan);
    result.push({ batchCode: b.batchCode, files: files.map((f) => join(o.outDir, f.fileName)), ...(mrdfFile ? { mrdfFile } : {}) });
    piecesDone += size;
    await step(piecesDone, `${batchNo} of ${todo} batches. Batch ${b.batchCode}: done`, true);
  }
  if (o.mailer && result.some((r) => r.files.length > 0)) await maybeEmailRunSheets(o, (d) => step(pieces, `All ${todo} batches made. E-mailing the run sheets: ${d}`, true), rendered);
  return result;
}

async function maybeEmailRunSheets(o: ComposeJobOptions, say: (detail: string) => Promise<void>, ready: ReadonlyMap<number, Uint8Array>): Promise<void> {
  try {
    await say('checking the settings');
    if (!(await loadEmailSettings(o.pool)).enabled) return;
    const sent = (await o.pool.request().input('j', sql.BigInt, o.jobId).query<{ at: Date | null }>('SELECT run_sheets_emailed_at AS at FROM idoc.job WHERE job_id = @j')).recordset[0]?.at;
    if (sent) return;
    o.onRunSheetEmail?.(await emailRunSheets(o.pool, o.jobId, o.mailer!, o.logo, { ready, onStep: (d) => void say(d) }));
  } catch (e) {
    o.onRunSheetEmail?.({ sent: false, to: [], cc: [], testMode: false, attachment: null, error: (e as Error).message });
  }
}

/** Writes <batchCode>.txt for the batch (ANSI, CRLF), through a temporary name so the inserter never picks up half a file. */
async function writeMrdfFile(pool: sql.ConnectionPool, dir: string, b: BatchToCompose, plan: BatchPlan, now: Date = new Date()): Promise<string> {
  const recipients = await loadMrdfRecipients(pool, b.batchId);
  const pages = mailpiecePages(plan);
  const pieces = plan.segments.flatMap((s) => s.mailpieces).map((m) => {
    const r = recipients.get(m.mailpieceId);
    if (!r) throw new Error(`Mailpiece ${m.mailpieceId} has no address for the MRDF file`);
    return { sequenceNumber: m.sequenceNumber, pages: pages.get(m.sequenceNumber) ?? 0, addressLines: r.addressLines, postcode: r.postcode };
  });
  const text = buildMrdf({ batchCode: b.batchCode, accountCode: b.mrdf!.accountCode, returnAddress: b.mrdf!.returnAddress, logo1: b.mrdf!.logo1 ?? undefined, logo2: b.mrdf!.logo2 ?? undefined, pieces, now });
  await mkdir(dir, { recursive: true });
  const target = join(dir, `${b.batchCode}.txt`), tmp = `${target}.tmp`;
  await writeFile(tmp, encodeAnsi(text));
  await rename(tmp, target);
  return target;
}
