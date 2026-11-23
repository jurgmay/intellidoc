import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sql from 'mssql';
import { assertScratchDatabase } from '../../../ingest/src/mssql/devDb.js';
import { connect as connectIngest, resetAndSeed } from '../../../ingest/test/db/setup.js';
import { ingest } from '../../../ingest/src/ingest.js';
import { loadReferenceData } from '../../../ingest/src/mssql/reference.js';
import { MssqlRepository } from '../../../ingest/src/mssql/repository.js';
import { buildXml, FakePdf } from '../../../ingest/test/helpers.js';
import { NotFoundError } from '../../src/errors.js';
import { MssqlBatchStore } from '../../src/batches/mssqlStore.js';
import { MssqlRecipientStore } from '../../src/recipients/mssqlStore.js';
import type { BatchQuery } from '../../src/batches/types.js';

/** Runs against the scratch database named in INTELLIDOC_TEST_DB. It DROPS and recreates the idoc schema. */
const cs = process.env['INTELLIDOC_TEST_DB'];
describe.skipIf(!cs)('MssqlBatchStore', { timeout: 120_000 }, () => {
  let pool: sql.ConnectionPool; let ipool: Awaited<ReturnType<typeof connectIngest>>; let store: MssqlBatchStore; let mailpieces: MssqlRecipientStore;
  let customer: number; let child: number; let other: number;
  const q = (over: Partial<BatchQuery> = {}): BatchQuery => ({ accountId: customer, code: null, status: null, job: null, from: null, to: null, limit: 100, ...over });
  const id = async (code: string): Promise<number> => (await pool.request().query(`SELECT account_id AS n FROM idoc.account WHERE account_code = N'${code}'`)).recordset[0].n;

  beforeAll(async () => {
    pool = new sql.ConnectionPool(cs!); await pool.connect();
    await assertScratchDatabase(pool, /test|scratch|tmp/i);
    ipool = await connectIngest(); await resetAndSeed(ipool); store = new MssqlBatchStore(pool); mailpieces = new MssqlRecipientStore(pool);
    const { xml, pages } = buildXml([
      { first: 'Ann', surname: 'Patel', lines: ['Ann Patel', '1 High Street', 'Town', 'AB1 2CD'] },
      { first: 'Joe', surname: 'Patel', lines: ['Joe Patel', '2 High Street', 'Town', 'AB1 2CD'] },
      { first: 'Zed', surname: 'Quinn', lines: ['Zed Quinn', '3 High Street', 'Town', 'AB1 2CD'] },
    ]);
    await ingest(xml, 'job-batches.xml', 'job-batches.pdf', { ref: await loadReferenceData(ipool), pdf: new FakePdf(pages), repo: new MssqlRepository(ipool) });
    customer = await id('FEXCO_CUSTOMER'); const sub = await id('FEXCO');
    child = (await pool.request().query(`INSERT INTO idoc.account (account_code, name, parent_account_id, inherits_settings) OUTPUT INSERTED.account_id AS n VALUES (N'FEXCO_CHILD2', N'Child', ${sub}, 1)`)).recordset[0].n;
    other = (await pool.request().query(`INSERT INTO idoc.account (account_code, name) OUTPUT INSERTED.account_id AS n VALUES (N'BATCH_OTHER', N'Other customer')`)).recordset[0].n;
    // Zed Quinn's mailpiece was submitted from the child account
    await pool.request().query(`UPDATE m SET submitting_account_id = ${child} FROM idoc.mailpiece m JOIN idoc.pack p ON p.mailpiece_id = m.mailpiece_id JOIN idoc.address_line l ON l.address_id = p.address_id AND l.line_no = 1 WHERE l.text = N'Zed Quinn'`);
  });
  afterAll(async () => { await pool?.close(); await ipool?.close(); });

  it('finds the batches of an account and counts what is in scope', async () => {
    const r = await store.search(q());
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.reduce((n, b) => n + b.mailpieces, 0)).toBe(3); // Ann, Joe and Zed (the customer covers the child account too)
  });

  it('a search below the customer sees only its own mailpieces, and says how many the batch holds', async () => {
    const r = await store.search(q({ accountId: child }));
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ mailpieces: 1, mailpiecesInBatch: 3 });
    expect(r.rows[0]!.job).toMatch(/job-batches/);
  });

  it('finds nothing in another customer, and 404s for an unknown account', async () => {
    expect((await store.search(q({ accountId: other }))).rows).toEqual([]);
    await expect(store.search(q({ accountId: 999999 }))).rejects.toBeInstanceOf(NotFoundError);
  });

  it('filters by code, status, job and day', async () => {
    const first = (await store.search(q())).rows[0]!;
    expect((await store.search(q({ code: first.batchCode }))).rows).toHaveLength(1);
    expect((await store.search(q({ code: first.batchCode + 9999 }))).rows).toEqual([]);
    expect((await store.search(q({ status: first.status }))).rows.length).toBeGreaterThan(0);
    expect((await store.search(q({ status: 'Cancelled' }))).rows).toEqual([]);
    expect((await store.search(q({ job: 'job-batches' }))).rows.length).toBeGreaterThan(0);
    expect((await store.search(q({ job: 'no-such-job' }))).rows).toEqual([]);
    const day = first.createdAt.slice(0, 10);
    expect((await store.search(q({ from: day, to: day }))).rows.length).toBeGreaterThan(0);
    expect((await store.search(q({ to: '2000-01-01' }))).rows).toEqual([]);
  });

  it('the mailpiece search lists a batch in print order, paged', async () => {
    const b = (await store.search(q())).rows[0]!;
    const base = { accountId: customer, name: null, address: null, reference: null, referenceKey: null, from: null, to: null, batchId: b.batchId };
    const all = await mailpieces.search({ ...base, limit: 100, offset: 0 });
    expect(all.rows.map((r) => r.sequenceNumber)).toEqual([...all.rows.map((r) => r.sequenceNumber)].sort((x, y) => (x ?? 1e9) - (y ?? 1e9)));
    const page = await mailpieces.search({ ...base, limit: 1, offset: 1 });
    expect(page.rows[0]!.mailpieceId).toBe(all.rows[1]!.mailpieceId);
  });
});
