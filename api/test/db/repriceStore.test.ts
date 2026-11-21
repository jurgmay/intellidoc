import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sql from 'mssql';
import { assertScratchDatabase } from '../../../ingest/src/mssql/devDb.js';
import { connect as connectIngest, resetAndSeed } from '../../../ingest/test/db/setup.js';
import { Repricer } from '../../../ingest/src/mssql/reprice.js';
import { NotFoundError } from '../../src/errors.js';
import { MssqlRepriceStore } from '../../src/reprice/mssqlStore.js';

/** Runs against the scratch database named in INTELLIDOC_TEST_DB. It DROPS and recreates the idoc schema. */
const cs = process.env['INTELLIDOC_TEST_DB'];
describe.skipIf(!cs)('MssqlRepriceStore', { timeout: 120_000 }, () => {
  let pool: sql.ConnectionPool; let ipool: Awaited<ReturnType<typeof connectIngest>>; let engine: Repricer; let store: MssqlRepriceStore; let account: number;
  beforeAll(async () => {
    pool = new sql.ConnectionPool(cs!); await pool.connect();
    await assertScratchDatabase(pool, /test|scratch|tmp/i);
    ipool = await connectIngest(); await resetAndSeed(ipool);
    engine = new Repricer(cs!); store = new MssqlRepriceStore(pool, engine);
    account = (await pool.request().query(`INSERT INTO idoc.account (account_code, name) OUTPUT INSERTED.account_id AS n VALUES (N'RP_ACC', N'RP_ACC')`)).recordset[0].n;
  });
  afterAll(async () => { await engine?.close(); await pool?.close(); await ipool?.close(); });

  it('previews and runs for a customer with no mail, and writes a line on its history', async () => {
    const input = { from: '2026-01-01', to: null, overwrite: false };
    expect(await store.preview(account, input)).toEqual({ inScope: 0, alreadyPriced: 0, wouldPrice: 0, noModel: 0, unknownColours: 0 });
    expect(await store.run(account, input, 'tester')).toEqual({ priced: 0, noModel: 0, unknownColours: 0 });
    const lines = (await pool.request().query(`SELECT summary FROM idoc.audit_log WHERE entity = N'customer' AND entity_id = ${account}`)).recordset as { summary: string }[];
    expect(lines[0]!.summary).toMatch(/Priced mail again for 2026-01-01 to today: 0 priced/);
  });
  it('refuses an unknown customer', async () => {
    await expect(store.preview(999999, { from: null, to: null, overwrite: false })).rejects.toBeInstanceOf(NotFoundError);
  });
});
