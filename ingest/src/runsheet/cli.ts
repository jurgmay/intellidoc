import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildRunSheet } from './data.js';
import { renderRunSheet, mergePdfs } from './pdf.js';
import { loadRunSheetInputs } from './query.js';
import sql from 'mssql';

/** Writes one PDF per batch (<batchCode>.pdf) and one merged PDF per job (job-<id>.pdf). */
export async function writeRunSheets(jobId: number, outDir: string, logoPath?: string): Promise<string[]> {
  const cs = process.env['INTELLIDOC_DB'];
  if (!cs) throw new Error('Set INTELLIDOC_DB first');
  const pool = await new sql.ConnectionPool(cs).connect();
  try {
    const inputs = await loadRunSheetInputs(pool, jobId);
    if (!inputs.length) throw new Error(`Job ${jobId} has no batches`);
    const logo = logoPath ? new Uint8Array(await readFile(logoPath)) : undefined;
    await mkdir(outDir, { recursive: true });
    const parts: Uint8Array[] = [];
    const files: string[] = [];
    for (const input of inputs) {
      const data = buildRunSheet(input);
      const pdf = await renderRunSheet(data, logo);
      const file = join(outDir, data.fileName);
      await writeFile(file, pdf);
      parts.push(pdf);
      files.push(file);
    }
    const merged = join(outDir, `job-${jobId}.pdf`);
    await writeFile(merged, await mergePdfs(parts));
    files.push(merged);
    return files;
  } finally { await pool.close(); }
}

const [jobArg, outArg, logoArg] = process.argv.slice(2);
if (!jobArg || !outArg) { console.error('Usage: tsx src/runsheet/cli.ts <jobId> <outDir> [logo.png (default: assets/intellidoc-logo.png)]'); process.exit(2); }
const files = await writeRunSheets(Number(jobArg), outArg, logoArg);
console.log(`Wrote ${files.length} files to ${outArg}`);
