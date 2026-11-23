import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
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
    expect(s.marks.mrdf?.ocr.rotationDeg).toBe(0);
    expect(s.pageSize).toEqual({ widthMm: 210, heightMm: 297 });
    expect(s.marks.dot).toEqual({ xMm: 205.5, yMm: 269, diameterMm: 2 });
    expect(s.marks.seq.fontPt).toBe(8);
    expect(s.marks.mrdf).toEqual({ dm: { leftMm: 10, topMm: 10, widthMm: 8, heightMm: 8 }, ocr: { fontPt: 8.2, leftMm: 20, topMm: 10, widthMm: 30, heightMm: 4 } });
  });

  it('writes the MRDF file for a customer that uses MRDF, and none for one that does not', async () => {
    const ref = await loadReferenceData(pool);
    const { xml, pages } = buildXml([person('Cy', 'Day', 3), person('Di', 'Day', 2)]);
    await ingest(xml, 'job-mrdf.xml', 'job-mrdf.pdf', { ref, pdf: new FakePdf(pages), repo });
    const jobId = await scalar(`SELECT job_id AS n FROM idoc.job WHERE base_name = N'job-mrdf'`);
    const batchId = await scalar(`SELECT TOP 1 batch_id AS n FROM idoc.batch WHERE job_id = ${jobId}`);
    const batchCode = await scalar(`SELECT batch_code AS n FROM idoc.batch WHERE batch_id = ${batchId}`);
    const dir = mkdtempSync(join(tmpdir(), 'idoc-mrdf-db-')); const pdfDir = join(dir, 'processed'), outDir = join(dir, 'out'), mrdfDir = join(dir, 'mrdf');
    mkdirSync(pdfDir);
    await realPdf(pages, pdfDir, '20260101120000_job-mrdf.pdf');

    const [off] = await composeJob({ pool, jobId, pdfDir, outDir, mrdfDir, grey: null });
    expect(off!.mrdfFile).toBeUndefined();
    expect(existsSync(join(mrdfDir, `${batchCode}.txt`))).toBe(false);

    await pool.request().query(`UPDATE o SET is_use_mrdf = 1, return_address = N'Latcham Direct' + CHAR(13) + CHAR(10) + N'Unit 1' FROM idoc.account AS o
      WHERE o.account_id = (SELECT v.owner_account_id FROM idoc.v_account_owner AS v INNER JOIN idoc.batch AS b ON b.account_id = v.account_id WHERE b.batch_id = ${batchId})`);
    const [on] = await composeJob({ pool, jobId, pdfDir, outDir, mrdfDir, grey: null });
    expect(on!.mrdfFile).toBe(join(mrdfDir, `${batchCode}.txt`));
    const lines = readFileSync(on!.mrdfFile!, 'latin1').split('\r\n');
    expect(lines).toHaveLength(4);
    expect(lines.slice(0, 3).map((l) => l.length)).toEqual([790, 1406, 1406]);
    expect(lines[0]!.slice(0, 10)).toBe(String(batchCode).padStart(10, '0'));
    expect(lines[1]!.slice(10, 16)).toBe('000001');
    expect(lines[1]!.slice(16, 19)).toMatch(/^00[12]$/);
    expect(lines[1]!).toContain('Latcham Direct');
    expect(lines[1]!).toContain('Unit 1');
    expect(lines[1]!).toMatch(/(Cy|Di) Day {30,}/);
    expect(lines[1]!).toContain('AB1 2CD');
  });

  it('composes a job, numbers the mailpieces, records the files and each pack\'s output pages, and can be repeated', async () => {
    const ref = await loadReferenceData(pool);
    const { xml, pages } = buildXml([person('Ann', 'Lee', 3), person('Ann', 'Lee', 2), person('Bob', 'Lee', 1)]);
    await ingest(xml, 'job-compose.xml', 'job-compose.pdf', { ref, pdf: new FakePdf(pages), repo });
    const jobId = Number(await scalar(`SELECT job_id AS n FROM idoc.job WHERE base_name = N'job-compose'`)); // BIGINT comes back as text
    const batchId = await scalar(`SELECT TOP 1 batch_id AS n FROM idoc.batch WHERE job_id = ${jobId}`);
    const batchCode = await scalar(`SELECT batch_code AS n FROM idoc.batch WHERE batch_id = ${batchId}`);
    const dir = mkdtempSync(join(tmpdir(), 'idoc-compose-db-')); const pdfDir = join(dir, 'processed'), outDir = join(dir, 'out');
    mkdirSync(pdfDir);
    await realPdf(pages, pdfDir, '20260101120000_job-compose.pdf'); // the watcher puts a prefix on processed files

    expect(await jobsToCompose(pool)).toContain(jobId); // Received, nothing made yet
    const [b] = await composeJob({ pool, jobId, pdfDir, outDir, grey: null });
    expect(await jobsToCompose(pool)).not.toContain(jobId);
    expect(b!.skipped).toBeUndefined();
    const file = b!.files[0]!;
    expect(dirname(file)).toBe(outDir);
    expect(basename(file)).toMatch(new RegExp(`(^| - )IntelliDoc - .* - ${batchCode} - Batch 1 of 1\\.pdf$`)); // the name the run sheet gives
    expect(existsSync(file)).toBe(true);

    const mps = (await pool.request().query(`SELECT mailpiece_id, sequence_number, pack_count FROM idoc.mailpiece WHERE batch_id = ${batchId} ORDER BY sequence_number`)).recordset;
    expect(mps.map((m) => m.sequence_number)).toEqual([1, 2]);
    const f = (await pool.request().query(`SELECT * FROM idoc.batch_file WHERE batch_id = ${batchId}`)).recordset;
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ segment_number: 1, file_name: basename(file), mailpiece_count: 2, first_sequence: 1, last_sequence: 2 });
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
    const jobId = Number(await scalar(`SELECT job_id AS n FROM idoc.job WHERE base_name = N'job-compose-wait'`));
    expect(await jobsToCompose(pool)).not.toContain(jobId); // not Received
    await expect(composeJob({ pool, jobId, pdfDir: tmpdir(), outDir: tmpdir(), grey: null })).rejects.toThrow(/Awaiting PDF/);
    const batchId = await scalar(`SELECT TOP 1 batch_id AS n FROM idoc.batch WHERE batch_code = (SELECT MIN(batch_code) FROM idoc.batch)`);
    await expect(pool.request().query(`UPDATE idoc.mailpiece SET sequence_number = 1 WHERE batch_id = ${batchId} AND sequence_number = 2`)).rejects.toThrow(/ux_mailpiece_sequence/);
  });
});
