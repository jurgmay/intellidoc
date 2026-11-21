import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sql from 'mssql';
import { assertScratchDatabase, resetAndSeed } from '../../../ingest/src/mssql/devDb.js';
import { MssqlCustomerStore } from '../../src/customers/mssqlStore.js';
import { FLAGS, type EnvelopeInput } from '../../src/customers/types.js';
import { ConflictError, NotFoundError, ValidationError } from '../../src/errors.js';

/** Runs against the scratch database named in INTELLIDOC_TEST_DB. It DROPS and recreates the idoc schema. */
const cs = process.env['INTELLIDOC_TEST_DB'];
describe.skipIf(!cs)('MssqlCustomerStore', { timeout: 120_000 }, () => {
  let pool: sql.ConnectionPool; let store: MssqlCustomerStore;
  let rateId: number; let envelopeId: number; let otherStockId: number;
  beforeAll(async () => {
    pool = new sql.ConnectionPool(cs!); await pool.connect();
    await assertScratchDatabase(pool, /test|scratch|tmp/i);
    await resetAndSeed(pool); store = new MssqlCustomerStore(pool);
    const lk = await store.lookups();
    rateId = lk.postalRates[0]!.id; envelopeId = lk.envelopeStock[0]!.id;
    otherStockId = (await pool.request().query(`INSERT INTO idoc.stock_item (description, is_envelope, is_insert) OUTPUT INSERTED.stock_item_id AS id VALUES (N'A leaflet', 0, 1)`)).recordset[0].id;
  });
  afterAll(async () => { await pool?.close(); });
  const env = (over: Partial<EnvelopeInput> = {}): EnvelopeInput => ({ brandId: null, deliveryBand: '2nd Class', postalRateId: rateId, stockItemId: envelopeId, reference: null, externalName: null, isOversticker: false, ...over });
  const flags = (over: Record<string, boolean> = {}) => ({ ...Object.fromEntries(FLAGS.map((f) => [f, false])), ...over }) as Record<(typeof FLAGS)[number], boolean>;

  it('lists the seeded customers but not their sub-accounts', async () => {
    const rows = await store.list('', false);
    expect(rows.map((r) => r.code)).toContain('FEXCO_CUSTOMER');
    expect(rows.every((r) => !['FEXCO'].includes(r.code))).toBe(true);
    expect((await store.list('fexco', false)).length).toBeGreaterThan(0);
    expect(await store.list('100%_[x', false)).toEqual([]); // LIKE wildcards are escaped
  });

  it('creates a customer, rejects a duplicate code, and records history', async () => {
    const id = await store.create({ code: 'NEWCO', name: 'New Co' }, 'tester');
    await expect(store.create({ code: 'newco', name: 'Again' }, 'tester')).rejects.toBeInstanceOf(ConflictError);
    expect((await store.history(id, 10))[0]).toMatchObject({ changedBy: 'tester', summary: 'Created customer NEWCO "New Co"' });
  });

  it('saves details, creates passthrough keys by name, and describes the changes', async () => {
    const id = await store.create({ code: 'DET', name: 'Details Co' }, 'tester');
    await store.updateDetails(id, { code: 'DET', name: 'Details Co', misJobNumber: '777', pendingJobNumber: null, returnAddress: 'PO Box 1', batchingKey: 'Brand New Key', packSequenceKey: 'Department', parentId: null, flags: flags({ isAddressMatching: true, isNhs: true }) }, 'tester');
    const d = await store.get(id);
    expect(d).toMatchObject({ misJobNumber: '777', pendingJobNumber: null, returnAddress: 'PO Box 1', batchingKey: 'Brand New Key', packSequenceKey: 'Department', flags: { isAddressMatching: true, isNhs: true, isTesting: false } });
    expect((await store.lookups()).passthroughKeys).toContain('Brand New Key');
    const lines = (await store.history(id, 20)).map((h) => h.summary);
    expect(lines).toEqual(expect.arrayContaining(['Address matching: off → on', 'NHS: off → on', 'MIS job number: (none) → "777"']));
    await expect(store.get(999999)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('sub-accounts share the account code space with customers, and are not customers themselves', async () => {
    const id = await store.create({ code: 'PARENT', name: 'Parent' }, 'tester');
    const sub = await store.addAccount(id, { code: 'PARENT-1', name: 'Sub one' }, 'tester');
    await expect(store.addAccount(id, { code: 'PARENT', name: 'Clash' }, 'tester')).rejects.toBeInstanceOf(ConflictError);
    await expect(store.get(sub)).rejects.toBeInstanceOf(NotFoundError);
    await expect(store.addBrand(sub, 'Nope', 'tester')).rejects.toBeInstanceOf(NotFoundError);
    await store.updateAccount(sub, { code: 'PARENT-1', name: 'Sub one', isDeleted: true }, 'tester');
    expect((await store.get(id)).accounts).toEqual([{ id: sub, code: 'PARENT-1', name: 'Sub one', isDeleted: true }]);
  });

  it('brands: unique per customer, cannot be deleted while an envelope setting uses them', async () => {
    const id = await store.create({ code: 'BR', name: 'Brands' }, 'tester');
    const b = await store.addBrand(id, 'Home', 'tester');
    await expect(store.addBrand(id, 'HOME', 'tester')).rejects.toBeInstanceOf(ConflictError);
    await store.renameBrand(b, 'House', 'tester');
    const e = await store.addEnvelope(id, env({ brandId: b }), 'tester');
    await expect(store.deleteBrand(b, 'tester')).rejects.toBeInstanceOf(ConflictError);
    expect((await store.get(id)).brands[0]).toMatchObject({ name: 'House', usage: 1 });
    await store.deleteEnvelope(e, 'tester');
    await store.deleteBrand(b, 'tester'); // the removed (soft-deleted) setting lets go of the brand
    expect((await store.get(id)).brands).toEqual([]);
  });

  it('envelopes: stock must be an envelope, brand must be the customer’s, duplicates refused, removed ones can be re-added', async () => {
    const id = await store.create({ code: 'EN', name: 'Envelopes' }, 'tester');
    const other = await store.create({ code: 'EN2', name: 'Other' }, 'tester');
    const foreign = await store.addBrand(other, 'Theirs', 'tester');
    await expect(store.addEnvelope(id, env({ stockItemId: otherStockId }), 'tester')).rejects.toBeInstanceOf(ValidationError);
    await expect(store.addEnvelope(id, env({ brandId: foreign }), 'tester')).rejects.toBeInstanceOf(ValidationError);
    const first = await store.addEnvelope(id, env({ reference: 'R1', externalName: 'Ext', isOversticker: true }), 'tester');
    await expect(store.addEnvelope(id, env({ reference: 'R1' }), 'tester')).rejects.toBeInstanceOf(ConflictError);
    await store.addEnvelope(id, env({ reference: 'R2' }), 'tester');
    const got = (await store.get(id)).envelopes.find((x) => x.id === first)!;
    expect(got).toMatchObject({ deliveryBand: '2nd Class', reference: 'R1', externalName: 'Ext', isOversticker: true, brandName: null });
    expect(got.rateLabel).toMatch(/g$/);
    await store.updateEnvelope(first, env({ reference: 'R3' }), 'tester');
    await store.deleteEnvelope(first, 'tester');
    await store.addEnvelope(id, env({ reference: 'R3' }), 'tester');
    await expect(store.updateEnvelope(first, env(), 'tester')).rejects.toBeInstanceOf(NotFoundError);
    expect((await store.get(id)).envelopes).toHaveLength(2);
  });

  it('match rules, pack sequence and e-mails are replaced as a list and audited', async () => {
    const id = await store.create({ code: 'LST', name: 'Lists' }, 'tester');
    await store.setMatchRules(id, [{ isInclude: true, key: 'Department', value: null }, { isInclude: false, key: 'Doc Type', value: 'Final Demand' }], 'tester');
    await store.setSequenceRules(id, [{ value: 'Arrears', number: 2 }, { value: 'Bill', number: 1 }], 'tester');
    await store.setEmails(id, ['a@x.com', 'b@x.com'], 'tester');
    let d = await store.get(id);
    expect(d.matchRules).toEqual([{ isInclude: true, key: 'Department', value: null }, { isInclude: false, key: 'Doc Type', value: 'Final Demand' }]);
    expect(d.sequenceRules).toEqual([{ value: 'Bill', number: 1 }, { value: 'Arrears', number: 2 }]);
    expect(d.emails).toEqual(['a@x.com', 'b@x.com']);
    await store.setMatchRules(id, [], 'tester'); await store.setEmails(id, [], 'tester');
    d = await store.get(id);
    expect(d.matchRules).toEqual([]); expect(d.emails).toEqual([]);
    const lines = (await store.history(id, 20)).map((h) => h.summary);
    expect(lines).toEqual(expect.arrayContaining(['Pack sequence: none → 1. Bill; 2. Arrears', 'Notification e-mails: a@x.com, b@x.com → none']));
  });

  it('hierarchy: parent and children are shown, loops are refused, and the child keeps its own settings', async () => {
    const parent = await store.create({ code: 'HPARENT', name: 'Hier Parent' }, 'tester');
    const child = await store.create({ code: 'HCHILD', name: 'Hier Child' }, 'tester');
    const grand = await store.create({ code: 'HGRAND', name: 'Hier Grandchild' }, 'tester');
    const input = (code: string, name: string, parentId: number | null) => ({ code, name, misJobNumber: null, pendingJobNumber: null, returnAddress: null, batchingKey: null, packSequenceKey: null, parentId, flags: flags({ isAddressMatching: true }) });
    await store.updateDetails(child, input('HCHILD', 'Hier Child', parent), 'tester');
    await store.updateDetails(grand, input('HGRAND', 'Hier Grandchild', child), 'tester');
    expect((await store.get(child)).parent).toMatchObject({ id: parent, code: 'HPARENT' });
    expect((await store.get(parent)).children.map((c) => c.code)).toEqual(['HCHILD']);
    expect((await store.list('Hier', false)).find((r) => r.id === grand)).toMatchObject({ parentId: child, parentCode: 'HCHILD' });
    await expect(store.updateDetails(parent, input('HPARENT', 'Hier Parent', grand), 'tester')).rejects.toBeInstanceOf(ValidationError);
    await expect(store.updateDetails(parent, input('HPARENT', 'Hier Parent', parent), 'tester')).rejects.toBeInstanceOf(ValidationError);
    await expect(store.updateDetails(parent, input('HPARENT', 'Hier Parent', 999999), 'tester')).rejects.toBeInstanceOf(ValidationError);
    const sub = await store.addAccount(parent, { code: 'HPARENT-SUB', name: 'A sub-account' }, 'tester');
    await expect(store.updateDetails(parent, input('HPARENT', 'Hier Parent', sub), 'tester')).rejects.toBeInstanceOf(ValidationError); // a sub-account is not a customer
    expect((await store.history(child, 5)).map((h) => h.summary)).toContain('Parent: (none) → "HPARENT"');
    expect((await store.lookups()).customers.map((c) => c.code)).toEqual(expect.arrayContaining(['HPARENT', 'HCHILD']));
    await store.updateDetails(child, input('HCHILD', 'Hier Child', null), 'tester');
    expect((await store.get(parent)).children).toEqual([]);
  });

  it('pending job number: starts on the 1st of next month, moves on its date, and keeps its date when untouched', async () => {
    const id = await store.create({ code: 'PEND', name: 'Pending Co' }, 'tester');
    const input = (pending: string | null) => ({ code: 'PEND', name: 'Pending Co', misJobNumber: '100', pendingJobNumber: pending, returnAddress: null, batchingKey: null, packSequenceKey: null, parentId: null, flags: flags() });
    await store.updateDetails(id, input('101'), 'tester');
    const first = (await store.get(id)).pendingFrom!;
    expect(first).toMatch(/^\d{4}-\d{2}-01$/);
    const todayLondon = (await pool.request().query(`SELECT CONVERT(CHAR(10), CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'GMT Standard Time' AS DATE), 23) AS d`)).recordset[0].d as string;
    expect(first > todayLondon).toBe(true);
    await store.updateDetails(id, input('101'), 'tester');
    expect((await store.get(id)).pendingFrom).toBe(first);
    expect(await store.applyDuePending()).toBe(0);
    await pool.request().input('i', id).query(`UPDATE idoc.account SET pending_job_number_from = '2020-01-01' WHERE account_id = @i`);
    expect(await store.applyDuePending()).toBeGreaterThanOrEqual(1);
    expect(await store.get(id)).toMatchObject({ misJobNumber: '101', pendingJobNumber: null, pendingFrom: null });
    expect((await store.history(id, 5))[0]).toMatchObject({ changedBy: 'system', summary: 'Job number: "100" → "101" (the pending job number took effect)' });
    await store.updateDetails(id, input('102'), 'tester');
    await store.updateDetails(id, input(null), 'tester');
    expect(await store.get(id)).toMatchObject({ pendingJobNumber: null, pendingFrom: null });
  });

  it('a failed change leaves no half-written history', async () => {
    const id = await store.create({ code: 'ATOM', name: 'Atomic' }, 'tester');
    const before = (await store.history(id, 50)).length;
    await expect(store.updateDetails(id, { code: 'FEXCO_CUSTOMER', name: 'Atomic', misJobNumber: '1', pendingJobNumber: null, returnAddress: null, batchingKey: null, packSequenceKey: null, parentId: null, flags: flags() }, 'tester')).rejects.toBeInstanceOf(ConflictError);
    expect((await store.history(id, 50)).length).toBe(before);
    expect((await store.get(id)).misJobNumber).toBeNull();
  });
});
