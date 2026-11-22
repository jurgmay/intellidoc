import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type sql from 'mssql';
import { PDFDocument } from 'pdf-lib';
import { connect, hasDb, resetAndSeed } from './setup.js';
import { MssqlRepository } from '../../src/mssql/repository.js';
import { loadReferenceData } from '../../src/mssql/reference.js';
import { ingest } from '../../src/ingest.js';
import { composeJob } from '../../src/compose/job.js';
import { jobsToCompose, loadComposeSettings } from '../../src/compose/db.js';
import { buildXml, FakePdf, type PackSpec } from '../helpers.js';

/** Against a REAL scratch SQL Server database (INTELLIDOC_TEST_DB); see setup.ts. */
describe.skipIf(!hasDb)('composeJob', { timeout: 120_000 }, () => {
  let pool: sql.ConnectionPool;
  let repo: MssqlRepository;
  beforeAll(async () => { pool = await connect(); await resetAndSeed(pool); repo = new MssqlRepository(pool); });
  afterAll(async () => { await pool?.close(); });
  const scalar = async (q: string): Promise<number> => (await pool.request().query(q)).recordset[0].n as number;
  const person = (first: string, surname: string, pages: number): PackSpec => ({ first, surname, pages, lines: [`${first} ${surname}`, '1 High Street', 'Town', 'AB1 2CD'] });

  async function realPdf(pages: number, dir: string, name: string): Promise<void> {
    const d = await PDFDocument.create();
    for (let i = 1; i <= pages; i++) d.addPage([595.276, 841.89]).drawText(`Page ${i}`, { x: 100, y: 700, size: 20 });
    writeFileSync(join(dir, name), await d.save());
  }

  it('reads the mark settings and their defaults', async () => {
    const s = await loadComposeSettings(pool);
    expect(s.autoCompose).toBe(false);
    expect(s.maxPagesPerPdf).toBe(10000);
    expect(s.marks.dot).toEqual({ xMm: 205.5, yMm: 269, diameterMm: 2 });
    expect(s.marks.seq.fontPt).toBe(8);
  });

  it('composes a job, numbers the mailpieces, records the files and each pack\'s output pages, and can be repeated', async () => {
    const ref = await loadReferenceData(pool);
    const { xml, pages } = buildXml([person('Ann', 'Lee', 3), person('Ann', 'Lee', 2), person('Bob', 'Lee', 1)]);
    await ingest(xml, 'job-compose.xml', 'job-compose.pdf', { ref, pdf: new FakePdf(pages), repo });
    const jobId = await scalar(`SELECT job_id AS n FROM idoc.job WHERE base_name = N'job-compose'`);
    const batchId = await scalar(`SELECT TOP 1 batch_id AS n FROM idoc.batch WHERE job_id = ${jobId}`);
    const batchCode = await scalar(`SELECT batch_code AS n FROM idoc.batch WHERE batch_id = ${batchId}`);
    const dir = mkdtempSync(join(tmpdir(), 'idoc-compose-db-')); const pdfDir = join(dir, 'processed'), outDir = join(dir, 'out');
    mkdirSync(pdfDir);
    await realPdf(pages, pdfDir, '20260101120000_job-compose.pdf'); // the watcher puts a prefix on processed files

    expect(await jobsToCompose(pool)).toContain(jobId); // Received, nothing made yet
    const [b] = await composeJob({ pool, jobId, pdfDir, outDir, grey: null });
    expect(await jobsToCompose(pool)).not.toContain(jobId);
    expect(b!.skipped).toBeUndefined();
    const file = join(outDir, `${batchCode}_1.pdf`);
    expect(existsSync(file)).toBe(true);

    const mps = (await pool.request().query(`SELECT mailpiece_id, sequence_number, pack_count FROM idoc.mailpiece WHERE batch_id = ${batchId} ORDER BY sequence_number`)).recordset;
    expect(mps.map((m) => m.sequence_number)).toEqual([1, 2]);
    const f = (await pool.request().query(`SELECT * FROM idoc.batch_file WHERE batch_id = ${batchId}`)).recordset;
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ segment_number: 1, file_name: `${batchCode}_1.pdf`, mailpiece_count: 2, first_sequence: 1, last_sequence: 2 });
    const doc = await PDFDocument.load(new Uint8Array(readFileSync(file)));
    expect(doc.getPageCount()).toBe(f[0].page_count);
    const run = f[0].page_count - 8; // run sheet (padded to even) + Ann 3+1 and 2, Bob 1+1
    const packs = (await pool.request().query(`SELECT start_page, output_start_page, output_end_page FROM idoc.pack WHERE job_id = ${jobId} ORDER BY start_page`)).recordset;
    expect(packs.map((p) => [p.output_start_page, p.output_end_page])).toEqual([[run + 1, run + 4], [run + 5, run + 6], [run + 7, run + 8]]);
    expect(run % 2).toBe(0);

    // again: the same numbers, one file record, nothing doubled
    await composeJob({ pool, jobId, pdfDir, outDir, grey: null });
    expect(await scalar(`SELECT COUNT(*) AS n FROM idoc.batch_file WHERE batch_id = ${batchId}`)).toBe(1);
    expect(await scalar(`SELECT COUNT(*) AS n FROM idoc.mailpiece WHERE batch_id = ${batchId} AND sequence_number IN (1, 2)`)).toBe(2);

    // the automatic run leaves a batch that already has files alone
    expect((await composeJob({ pool, jobId, pdfDir, outDir, grey: null, onlyNew: true }))[0]!.skipped).toBe('already composed');

    // once printed, the batch is left alone
    await pool.request().query(`UPDATE idoc.batch SET current_status = N'Printed' WHERE batch_id = ${batchId}`);
    const [again] = await composeJob({ pool, jobId, pdfDir, outDir, grey: null });
    expect(again!.skipped).toMatch(/Printed/);
  });

  it('refuses a job that is not Received and rejects duplicate sequence numbers', async () => {
    const ref = await loadReferenceData(pool);
    const { xml } = buildXml([person('Cy', 'Dee', 2)]);
    await ingest(xml, 'job-compose-wait.xml', null, { ref, pdf: new FakePdf(0), repo }); // Awaiting PDF
    const jobId = await scalar(`SELECT job_id AS n FROM idoc.job WHERE base_name = N'job-compose-wait'`);
    expect(await jobsToCompose(pool)).not.toContain(jobId); // not Received
    await expect(composeJob({ pool, jobId, pdfDir: tmpdir(), outDir: tmpdir(), grey: null })).rejects.toThrow(/Awaiting PDF/);
    const batchId = await scalar(`SELECT TOP 1 batch_id AS n FROM idoc.batch WHERE batch_code = (SELECT MIN(batch_code) FROM idoc.batch)`);
    await expect(pool.request().query(`UPDATE idoc.mailpiece SET sequence_number = 1 WHERE batch_id = ${batchId} AND sequence_number = 2`)).rejects.toThrow(/ux_mailpiece_sequence/);
  });
});
