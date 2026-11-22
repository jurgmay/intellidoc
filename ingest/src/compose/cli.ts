import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sql from 'mssql';
import { composeJob } from './job.js';
import { GhostscriptGrey } from './grey.js';

/** Usage: tsx src/compose/cli.ts <jobId> <outDir> [pdfDir (default: $WATCH_DIR/processed)] [logo.png]. Ghostscript is used for mono pages (GS_PATH names it); MRDF_OUT_DIR is where MRDF files go. */
const [jobArg, outDir, pdfArg, logoArg] = process.argv.slice(2);
const cs = process.env['INTELLIDOC_DB'];
const pdfDir = pdfArg ?? (process.env['WATCH_DIR'] ? join(process.env['WATCH_DIR'], 'processed') : undefined);
if (!jobArg || !outDir || !pdfDir) { console.error('Usage: tsx src/compose/cli.ts <jobId> <outDir> [pdfDir (default: $WATCH_DIR/processed)] [logo.png]'); process.exit(2); }
if (!cs) { console.error('Set INTELLIDOC_DB first'); process.exit(2); }
const mrdfDir = process.env['MRDF_OUT_DIR'];
const pool = await new sql.ConnectionPool(cs).connect();
try {
  const logo = logoArg ? new Uint8Array(await readFile(logoArg)) : undefined;
  const batches = await composeJob({ pool, jobId: Number(jobArg), pdfDir, outDir, mrdfDir, logo, grey: new GhostscriptGrey() });
  for (const b of batches) console.log(b.skipped ? `Batch ${b.batchCode}: skipped (${b.skipped})` : `Batch ${b.batchCode}: ${b.files.join(', ')}${b.mrdfFile ? ` + ${b.mrdfFile}` : ''}`);
} finally { await pool.close(); }
