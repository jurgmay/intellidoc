import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sql from 'mssql';
import { assertScratchDatabase } from '../../../ingest/src/mssql/devDb.js';
import { connect as connectIngest, resetAndSeed } from '../../../ingest/test/db/setup.js';
import { MssqlActivityStore } from '../../src/activity/mssqlStore.js';

/** Runs against the scratch database named in INTELLIDOC_TEST_DB. It DROPS and recreates the idoc schema. */
const cs = process.env['INTELLIDOC_TEST_DB'];
describe.skipIf(!cs)('MssqlActivityStore', { timeout: 120_000 }, () => {
  let pool: sql.ConnectionPool; let ipool: Awaited<ReturnType<typeof connectIngest>>; let store: MssqlActivityStore;
  beforeAll(async () => {
    pool = new sql.ConnectionPool(cs!); await pool.connect();
    await assertScratchDatabase(pool, /test|scratch|tmp/i);
    ipool = await connectIngest(); await resetAndSeed(ipool); store = new MssqlActivityStore(pool);
  });
  afterAll(async () => { await pool?.close(); await ipool?.close(); });
  const add = (kind: string, label: string, state: string, o: { bytes?: number; pdf?: boolean; seconds?: number; staleMinutes?: number } = {}) => pool.request()
    .input('k', kind).input('l', label).input('s', state).input('b', sql.BigInt, o.bytes ?? null).input('p', sql.Bit, o.pdf ?? false).input('sec', sql.Int, o.seconds ?? 0).input('st', sql.Int, o.staleMinutes ?? 0)
    .query(`INSERT INTO idoc.activity (kind, label, state, bytes, with_pdf, step_done, step_total, started_at, updated_at, finished_at)
            VALUES (@k, @l, @s, @b, @p, 2, 5, DATEADD(SECOND, -@sec, SYSUTCDATETIME()), DATEADD(MINUTE, -@st, SYSUTCDATETIME()), CASE WHEN @s = N'Running' THEN NULL ELSE SYSUTCDATETIME() END)`);

  it('lists what is running (flagging work that has stopped moving) and what finished, newest first', async () => {
    await add('Print files', 'Job 1', 'Running'); await add('Import', 'stuck.xml', 'Running', { staleMinutes: 30 });
    await add('Import', 'a.xml', 'Done'); await add('Import', 'b.xml', 'Failed');
    const running = await store.running();
    expect(running.map((r) => [r.label, r.stalled])).toEqual([['Job 1', false], ['stuck.xml', true]]);
    expect(running[0]).toMatchObject({ done: 2, total: 5, kind: 'Print files', bytes: null, withPdf: false });
    expect((await store.recent(10)).map((r) => r.label)).toEqual(['b.xml', 'a.xml']);
  });
  it('gives the finished imports and PDF checks as samples for the estimate', async () => {
    await add('PDF check', 'big.pdf', 'Done', { bytes: 70_000_000, pdf: true, seconds: 140 });
    await add('Import', 'quick.xml', 'Done', { seconds: 3 });
    await add('Print files', 'Job 9', 'Done', { seconds: 600 });            // not an import: left out
    await add('PDF check', 'failed.pdf', 'Failed', { bytes: 5, pdf: true, seconds: 1 }); // failed: left out
    const s = await store.samples(10);
    const big = s.find((x) => x.bytes === 70_000_000)!;
    expect(big.withPdf).toBe(true); expect(big.seconds).toBeGreaterThanOrEqual(139); expect(big.seconds).toBeLessThanOrEqual(142);
    expect(s.some((x) => !x.withPdf)).toBe(true);
    expect(s.every((x) => x.seconds < 500)).toBe(true);
  });
});
