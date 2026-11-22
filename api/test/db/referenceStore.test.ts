import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sql from 'mssql';
import { assertScratchDatabase, resetAndSeed } from '../../../ingest/src/mssql/devDb.js';
import { MssqlReferenceStore } from '../../src/reference/mssqlStore.js';

/** Runs against the scratch database named in INTELLIDOC_TEST_DB. It DROPS and recreates the idoc schema. */
const cs = process.env['INTELLIDOC_TEST_DB'];
describe.skipIf(!cs)('MssqlReferenceStore', { timeout: 120_000 }, () => {
  let pool: sql.ConnectionPool; let store: MssqlReferenceStore;
  beforeAll(async () => {
    pool = new sql.ConnectionPool(cs!); await pool.connect();
    await assertScratchDatabase(pool, /test|scratch|tmp/i);
    await resetAndSeed(pool); store = new MssqlReferenceStore(pool);
  });
  afterAll(async () => { await pool?.close(); });
  const count = async (q: string): Promise<number> => Number((await pool.request().query(q)).recordset[0].n);

  it('lists, changes and deletes papers, and counts the print options that use one', async () => {
    const [seeded] = await store.papers();
    expect(seeded).toMatchObject({ name: 'A4 White', batchName: 'A4 WHITE', paperCode: null });
    await pool.request().query(`INSERT INTO idoc.paper (name, batch_name) VALUES (N'A4 Plain', N'A4 PLAIN')`);
    const plain = (await store.papers()).find((p) => p.name === 'A4 Plain')!;
    await store.updatePaper(plain.id, { batchName: 'A4 WHITE', paperCode: 'P1' }, 'sam');
    expect((await store.papers()).find((p) => p.id === plain.id)).toMatchObject({ batchName: 'A4 WHITE', paperCode: 'P1', usedBy: 0 });
    expect((await store.history(5))[0]).toMatchObject({ changedBy: 'sam', summary: 'Paper "A4 Plain": batch name A4 PLAIN -> A4 WHITE, paper code not set -> P1' });
    await pool.request().query(`INSERT INTO idoc.option_set (colour, delivery_method, delivery_band, envelope_value, envelope_code, is_duplex, paper_id)
      VALUES (N'Colour', N'x', N'y', N'z', NULL, 0, ${plain.id})`);
    expect((await store.papers()).find((p) => p.id === plain.id)!.usedBy).toBe(1);
    await expect(store.deletePaper(plain.id, 'sam')).rejects.toThrow(/cannot be deleted/);
    await pool.request().query(`DELETE FROM idoc.option_set WHERE paper_id = ${plain.id}`);
    await store.deletePaper(plain.id, 'sam');
    expect((await store.papers()).some((p) => p.id === plain.id)).toBe(false);
  });

  it('changes a postal format\'s limits, keeping the order, and logs it in the same transaction', async () => {
    const [letter, large] = await store.formats();
    expect([letter!.name, large!.name]).toEqual(['Letter', 'Large Letter']);
    expect(letter).toMatchObject({ maxWidthMm: 240, maxHeightMm: 165 }); // Royal Mail's maximum letter, 240 x 165
    expect(large).toMatchObject({ maxWidthMm: 353, maxHeightMm: 250 });
    await expect(pool.request().query(`UPDATE idoc.postal_format SET max_height_mm = max_width_mm + 1 WHERE postal_format_id = ${letter!.id}`)).rejects.toThrow(/ck_postal_format_size/);
    await store.updateFormat(letter!.id, { maxWeightG: 120, maxThicknessMm: 6.5, maxSheets: null, maxWidthMm: 245.5, maxHeightMm: 170 }, 'sam');
    expect((await store.formats())[0]).toMatchObject({ maxWeightG: 120, maxThicknessMm: 6.5, maxSheets: null, maxWidthMm: 245.5, maxHeightMm: 170 });
    await expect(store.updateFormat(letter!.id, { maxWeightG: large!.maxWeightG + 1, maxThicknessMm: 5, maxSheets: 16, maxWidthMm: letter!.maxWidthMm, maxHeightMm: letter!.maxHeightMm }, 'sam')).rejects.toThrow(/Large Letter/);
    expect((await store.formats())[0]!.maxWeightG).toBe(120);
    expect(await count(`SELECT COUNT(*) AS n FROM idoc.audit_log WHERE entity = N'reference' AND summary LIKE N'Postal format "Letter"%'`)).toBe(1);
    await store.updateFormat(letter!.id, { maxWeightG: letter!.maxWeightG, maxThicknessMm: letter!.maxThicknessMm, maxSheets: letter!.maxSheets, maxWidthMm: letter!.maxWidthMm, maxHeightMm: letter!.maxHeightMm }, 'sam'); // put it back
  });

  it('adds and removes anonymous addressees', async () => {
    expect(await store.anonymous()).toContain('THEOCCUPIER');
    expect(await store.addAnonymous('THEGUARDIAN', 'sam')).toBe('THEGUARDIAN');
    await expect(store.addAnonymous('THEGUARDIAN', 'sam')).rejects.toThrow(/already/);
    await store.deleteAnonymous('THEGUARDIAN', 'sam');
    await expect(store.deleteAnonymous('THEGUARDIAN', 'sam')).rejects.toThrow(/Not on the list/);
    expect(await store.anonymous()).not.toContain('THEGUARDIAN');
  });
});
