import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sql from 'mssql';
import { assertScratchDatabase, resetAndSeed } from '../../../ingest/src/mssql/devDb.js';
import { MssqlReferenceStore } from '../../src/reference/mssqlStore.js';
import { ConflictError, NotFoundError } from '../../src/errors.js';

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
    expect(letter).toMatchObject({ maxLengthMm: 240, maxWidthMm: 165 }); // Royal Mail's maximum letter, 240 x 165
    expect(large).toMatchObject({ maxLengthMm: 353, maxWidthMm: 250 });
    const [, , small, medium] = await store.formats(); // the parcel formats, Royal Mail's maximums: weight, thickness (depth), length x width
    expect(small).toMatchObject({ name: 'Small Parcel', maxWeightG: 2000, maxThicknessMm: 160, maxLengthMm: 450, maxWidthMm: 350 });
    expect(medium).toMatchObject({ name: 'Medium Parcel', maxWeightG: 20000, maxThicknessMm: 460, maxLengthMm: 610, maxWidthMm: 460 });
    await expect(pool.request().query(`UPDATE idoc.postal_format SET max_width_mm = max_length_mm + 1 WHERE postal_format_id = ${letter!.id}`)).rejects.toThrow(/ck_postal_format_size/);
    await store.updateFormat(letter!.id, { maxWeightG: 120, maxThicknessMm: 6.5, maxSheets: null, maxLengthMm: 245.5, maxWidthMm: 170 }, 'sam');
    expect((await store.formats())[0]).toMatchObject({ maxWeightG: 120, maxThicknessMm: 6.5, maxSheets: null, maxLengthMm: 245.5, maxWidthMm: 170 });
    await expect(store.updateFormat(letter!.id, { maxWeightG: large!.maxWeightG + 1, maxThicknessMm: 5, maxSheets: 16, maxLengthMm: letter!.maxLengthMm, maxWidthMm: letter!.maxWidthMm }, 'sam')).rejects.toThrow(/Large Letter/);
    expect((await store.formats())[0]!.maxWeightG).toBe(120);
    expect(await count(`SELECT COUNT(*) AS n FROM idoc.audit_log WHERE entity = N'reference' AND summary LIKE N'Postal format "Letter"%'`)).toBe(1);
    await store.updateFormat(letter!.id, { maxWeightG: letter!.maxWeightG, maxThicknessMm: letter!.maxThicknessMm, maxSheets: letter!.maxSheets, maxLengthMm: letter!.maxLengthMm, maxWidthMm: letter!.maxWidthMm }, 'sam'); // put it back
  });

  it('adds and removes anonymous addressees', async () => {
    expect(await store.anonymous()).toContain('THEOCCUPIER');
    expect(await store.addAnonymous('THEGUARDIAN', 'sam')).toBe('THEGUARDIAN');
    await expect(store.addAnonymous('THEGUARDIAN', 'sam')).rejects.toThrow(/already/);
    await store.deleteAnonymous('THEGUARDIAN', 'sam');
    await expect(store.deleteAnonymous('THEGUARDIAN', 'sam')).rejects.toThrow(/Not on the list/);
    expect(await store.anonymous()).not.toContain('THEGUARDIAN');
  });
  it('insert sizes: seeded list, add, refuse a duplicate, remove, and audit', async () => {
    expect((await store.insertSizes()).map((z) => z.name)).toEqual(expect.arrayContaining(['A3', 'A4', 'A5', 'DL']));
    const z = await store.addInsertSize('Square 150', 'tester');
    await expect(store.addInsertSize('square 150', 'tester')).rejects.toBeInstanceOf(ConflictError);
    await store.deleteInsertSize(z.id, 'tester');
    expect((await store.insertSizes()).map((x) => x.name)).not.toContain('Square 150');
    const lines = (await store.history(10)).map((h) => h.summary);
    expect(lines).toEqual(expect.arrayContaining(['Insert size Square 150 added', 'Insert size Square 150 removed']));
    await expect(store.deleteInsertSize(z.id, 'tester')).rejects.toBeInstanceOf(NotFoundError);
  });
});
