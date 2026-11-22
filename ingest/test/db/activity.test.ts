import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type sql from 'mssql';
import { connect, hasDb, resetAndSeed } from './setup.js';
import { DbActivity } from '../../src/activity.js';

/** Runs against INTELLIDOC_TEST_DB (it DROPS and recreates the idoc schema). */
describe.skipIf(!hasDb)('DbActivity', { timeout: 120_000 }, () => {
  let pool: sql.ConnectionPool; let a: DbActivity; const errors: string[] = [];
  beforeAll(async () => { pool = await connect(); await resetAndSeed(pool); a = new DbActivity(pool, (m) => errors.push(m)); });
  afterAll(async () => { await pool?.close(); });
  const row = async (id: number) => (await pool.request().input('i', id).query('SELECT * FROM idoc.activity WHERE activity_id = @i')).recordset[0];

  it('records a unit of work from start through progress to its end', async () => {
    const id = await a.start('Print files', 'Job 5: x.pdf', null, 3);
    expect(id).not.toBeNull();
    expect(await row(id!)).toMatchObject({ kind: 'Print files', state: 'Running', step_done: 0, step_total: 3, finished_at: null });
    await a.step(id, 1, 3, 'Batch 70 (2 of 3): saving');
    expect(await row(id!)).toMatchObject({ step_done: 1, detail: 'Batch 70 (2 of 3): saving' });
    await a.finish(id, 'Done', '3 of 3 batches made');
    const r = await row(id!);
    expect(r).toMatchObject({ state: 'Done', detail: '3 of 3 batches made' }); expect(r.finished_at).not.toBeNull();
  });
  it('keeps the size of the file and whether a PDF is read, for the time estimate', async () => {
    const id = await a.start('PDF check', 'big.pdf', null, null, { bytes: 70_000_000, withPdf: true });
    expect(await row(id!)).toMatchObject({ with_pdf: true }); expect(Number((await row(id!)).bytes)).toBe(70_000_000);
    const plain = await a.start('Import', 'x.xml');
    expect(await row(plain!)).toMatchObject({ bytes: null, with_pdf: false });
  });
  it('keeps the progress detail when finishing with none, and drops a row on request', async () => {
    const id = await a.start('Import', 'a.xml');
    await a.step(id, 0, null, 'Reading'); await a.finish(id, 'Failed');
    expect(await row(id!)).toMatchObject({ state: 'Failed', detail: 'Reading' });
    const gone = await a.start('PDF check', 'lone.pdf'); await a.drop(gone);
    expect(await row(gone!)).toBeUndefined();
  });
  it('tidies: abandons work that stopped moving 10+ minutes ago and clears old finished rows, leaving live work alone', async () => {
    const stale = (await a.start('Import', 'stale.xml'))!, live = (await a.start('Import', 'live.xml'))!, old = (await a.start('Import', 'old.xml'))!;
    await a.finish(old, 'Done');
    await pool.request().input('s', stale).input('o', old).query(`UPDATE idoc.activity SET updated_at = DATEADD(MINUTE, -30, SYSUTCDATETIME()) WHERE activity_id = @s;
      UPDATE idoc.activity SET finished_at = DATEADD(DAY, -30, SYSUTCDATETIME()) WHERE activity_id = @o`);
    await a.tidy(7);
    expect((await row(stale)).state).toBe('Abandoned');
    expect((await row(live)).state).toBe('Running');
    expect(await row(old)).toBeUndefined();
  });
  it('never throws when the database refuses', async () => {
    const broken = new DbActivity({ request: () => { throw new Error('connection lost'); } } as unknown as sql.ConnectionPool, (m) => errors.push(m));
    expect(await broken.start('Import', 'x.xml')).toBeNull();
    await expect(broken.step(5, 1, 2, 'x')).resolves.toBeUndefined();
    expect(errors.some((m) => m.includes('connection lost'))).toBe(true);
  });
});
