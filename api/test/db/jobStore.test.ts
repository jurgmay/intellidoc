import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sql from 'mssql';
import { assertScratchDatabase } from '../../../ingest/src/mssql/devDb.js';
import { connect as connectIngest, resetAndSeed } from '../../../ingest/test/db/setup.js';
import { ingest } from '../../../ingest/src/ingest.js';
import { loadReferenceData } from '../../../ingest/src/mssql/reference.js';
import { MssqlRepository } from '../../../ingest/src/mssql/repository.js';
import { buildXml, FakePdf, type PackSpec } from '../../../ingest/test/helpers.js';
import { NotFoundError } from '../../src/errors.js';
import { MssqlJobStore } from '../../src/jobs/mssqlStore.js';

/** Runs against the scratch database named in INTELLIDOC_TEST_DB. It DROPS and recreates the idoc schema. */
const cs = process.env['INTELLIDOC_TEST_DB'];
describe.skipIf(!cs)('MssqlJobStore', { timeout: 120_000 }, () => {
  let pool: sql.ConnectionPool; let ipool: Awaited<ReturnType<typeof connectIngest>>; let store: MssqlJobStore;
  let jobId: number; let code: string;
  const person = (first: string, surname: string): PackSpec => ({ first, surname, lines: [`${first} ${surname}`, '1 High Street', 'Town', 'AB1 2CD'] });

  beforeAll(async () => {
    pool = new sql.ConnectionPool(cs!); await pool.connect();
    await assertScratchDatabase(pool, /test|scratch|tmp/i);
    ipool = await connectIngest(); await resetAndSeed(ipool); store = new MssqlJobStore(pool);
    const ref = await loadReferenceData(ipool);
    const { xml, pages } = buildXml([person('Ann', 'Lee'), person('Bob', 'Lee')]);
    await ingest(xml, 'job-list.xml', 'job-list.pdf', { ref, pdf: new FakePdf(pages), repo: new MssqlRepository(ipool) });
    jobId = Number((await pool.request().query('SELECT TOP 1 job_id AS n FROM idoc.job ORDER BY job_id DESC')).recordset[0].n);
    code = (await pool.request().query('SELECT TOP 1 a.account_code AS c FROM idoc.job j JOIN idoc.account a ON a.account_id = j.account_id')).recordset[0].c;
  });
  afterAll(async () => { await pool?.close(); await ipool?.close(); });

  it('lists the job with its customer, status and how many batches have print files', async () => {
    const [j] = (await store.list({ search: null, status: null, limit: 10 })).filter((x) => x.id === jobId);
    expect(j).toMatchObject({ customerCode: code, baseName: 'job-list', pdfFileName: 'job-list.pdf', composedBatchCount: 0, runSheetsEmailedAt: null });
    expect(j!.batchCount).toBeGreaterThan(0);
    expect(new Date(j!.receivedAt).getTime()).not.toBeNaN();
  });

  it('searches by customer code and file name, and filters by status', async () => {
    expect((await store.list({ search: code.slice(0, 3), status: null, limit: 10 })).map((x) => x.id)).toContain(jobId);
    expect((await store.list({ search: 'job-list', status: null, limit: 10 })).map((x) => x.id)).toContain(jobId);
    expect(await store.list({ search: 'no-such-thing', status: null, limit: 10 })).toEqual([]);
    expect(await store.list({ search: '%', status: null, limit: 10 })).toEqual([]); // a wildcard is searched for literally
    expect(await store.list({ search: null, status: 'Awaiting PDF', limit: 10 })).toEqual([]);
  });

  it('shows the batches and the print files once they are made', async () => {
    const d0 = await store.get(jobId);
    expect(d0.batches.length).toBe(d0.batchCount);
    expect(d0.batches.every((b) => b.files.length === 0)).toBe(true);
    const b = d0.batches[0]!;
    await pool.request().input('b', sql.BigInt, b.id).query(`INSERT INTO idoc.batch_file (batch_id, segment_number, file_name, mailpiece_count, page_count) VALUES (@b, 1, N'x_1.pdf', 2, 8)`);
    const d1 = await store.get(jobId);
    expect(d1.composedBatchCount).toBe(1);
    expect(d1.batches.find((x) => x.id === b.id)!.files).toEqual([{ fileName: 'x_1.pdf', segment: 1, mailpieces: 2, pages: 8 }]);
  });

  it('says when the job does not exist', async () => {
    await expect(store.get(999999)).rejects.toBeInstanceOf(NotFoundError);
  });
});
