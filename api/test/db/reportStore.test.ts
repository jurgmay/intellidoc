import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sql from 'mssql';
import { assertScratchDatabase } from '../../../ingest/src/mssql/devDb.js';
import { connect as connectIngest, resetAndSeed } from '../../../ingest/test/db/setup.js';
import { ingest } from '../../../ingest/src/ingest.js';
import { loadReferenceData } from '../../../ingest/src/mssql/reference.js';
import { MssqlRepository } from '../../../ingest/src/mssql/repository.js';
import { buildXml, FakePdf, type PackSpec } from '../../../ingest/test/helpers.js';
import { buildUsageReport } from '../../src/reports/aggregate.js';
import { MssqlReportStore } from '../../src/reports/mssqlStore.js';

/** Runs against the scratch database named in INTELLIDOC_TEST_DB. It DROPS and recreates the idoc schema. */
const cs = process.env['INTELLIDOC_TEST_DB'];
describe.skipIf(!cs)('MssqlReportStore', { timeout: 120_000 }, () => {
  // The ingest code has its own copy of the mssql package, so it gets its own connection (mixing the two breaks parameter types).
  let pool: sql.ConnectionPool; let ipool: Awaited<ReturnType<typeof connectIngest>>; let store: MssqlReportStore; let repo: MssqlRepository;
  let invoicing: number; let today: string;
  const person = (first: string, surname: string, extra: Partial<PackSpec> = {}): PackSpec =>
    ({ first, surname, lines: [`${first} ${surname}`, '1 High Street', 'Town', 'AB1 2CD'], ...extra });
  const scalar = async (q: string): Promise<number> => (await pool.request().query(q)).recordset[0].n as number;
  const report = async () => { const f = (await store.usageLines({ invoicingAccountId: invoicing, from: today, to: today }))!; return buildUsageReport(f.account, today, today, f.lines); };

  beforeAll(async () => {
    pool = new sql.ConnectionPool(cs!); await pool.connect();
    await assertScratchDatabase(pool, /test|scratch|tmp/i);
    ipool = await connectIngest(); await resetAndSeed(ipool); store = new MssqlReportStore(pool); repo = new MssqlRepository(ipool);
    const ref = await loadReferenceData(ipool);
    const { xml, pages } = buildXml([person('Ann', 'Lee'), person('Ann', 'Lee'), person('Bob', 'Lee'), person('Cat', 'Lee', { brand: 'Other brand' })]);
    await ingest(xml, 'job-usage.xml', 'job-usage.pdf', { ref, pdf: new FakePdf(pages), repo });
    invoicing = await scalar(`SELECT TOP 1 invoicing_account_id AS n FROM idoc.mailpiece`);
    // the UK day the mailpieces were produced on, worked out independently of the view
    today = (await pool.request().query(`SELECT CONVERT(NVARCHAR(10), CAST(MIN(created_at) AT TIME ZONE N'UTC' AT TIME ZONE N'GMT Standard Time' AS DATE), 23) AS d FROM idoc.mailpiece`)).recordset[0].d;
  });
  afterAll(async () => { await pool?.close(); await ipool?.close(); });

  it('lists invoicing accounts that have produced something', async () => {
    expect((await store.invoicingAccounts()).map((a) => a.id)).toContain(invoicing);
  });

  it('counts mailpieces, packs and sheets for the day, by brand and by format and service', async () => {
    const r = await report();
    expect(r.totals.mailpieces).toBe(await scalar(`SELECT COUNT(*) AS n FROM idoc.mailpiece`));
    expect(r.totals.packs).toBe(await scalar(`SELECT COUNT(*) AS n FROM idoc.pack`));
    expect(r.totals.sheets).toBe(await scalar(`SELECT SUM(sheet_count) AS n FROM idoc.mailpiece`));
    expect(r.brands.map((b) => b.brand).sort()).toEqual(['Other brand', 'Remus']);
    expect(r.brands.find((b) => b.brand === 'Remus')!.mailpieces).toBe(2); // Ann Lee x2 merge into one, plus Bob Lee
    expect(r.postage.every((p) => p.format !== 'Unknown')).toBe(true);
    expect((await store.usageLines({ invoicingAccountId: invoicing, from: '2000-01-01', to: '2000-01-02' }))!.lines).toEqual([]);
    expect(await store.usageLines({ invoicingAccountId: 999999, from: today, to: today })).toBeNull();
  });

  it('adds up production and postage sell for priced mailpieces, and counts the unpriced ones', async () => {
    const all = await scalar(`SELECT COUNT(*) AS n FROM idoc.mailpiece`);
    await pool.request().query(`UPDATE idoc.mailpiece SET production_sell = 0.5, postage_sell = 1.25, priced_at = SYSUTCDATETIME()`);
    await pool.request().query(`UPDATE TOP (1) idoc.mailpiece SET priced_at = NULL, production_sell = NULL, postage_sell = NULL`);
    const t = (await report()).totals;
    expect(t.unpriced).toBe(1);
    expect(t.productionSell).toBeCloseTo((all - 1) * 0.5, 4);
    expect(t.postageSell).toBeCloseTo((all - 1) * 1.25, 4);
    expect(t.totalSell).toBeCloseTo((all - 1) * 1.75, 4);
  });

  it('leaves out cancelled mailpieces and cancelled batches, and keeps the brand name as at production', async () => {
    const before = (await report()).totals.mailpieces;
    await pool.request().query(`UPDATE TOP (1) idoc.mailpiece SET is_cancelled = 1 WHERE brand_name = N'Remus'`);
    expect((await report()).totals.mailpieces).toBe(before - 1);
    const batchId = await scalar(`SELECT TOP 1 b.batch_id AS n FROM idoc.batch b JOIN idoc.mailpiece m ON m.batch_id = b.batch_id WHERE m.brand_name = N'Other brand'`);
    await repo.recordBatchEvent(batchId, 'Cancelled');
    const r = await report();
    expect(r.brands.map((b) => b.brand)).toEqual(['Remus']);
    await pool.request().query(`UPDATE idoc.brand SET name = name + N' (renamed)'`);
    expect((await report()).brands.map((b) => b.brand)).toEqual(['Remus']);
  });
});
