import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sql from 'mssql';
import { assertScratchDatabase } from '../../../ingest/src/mssql/devDb.js';
import { connect as connectIngest, resetAndSeed } from '../../../ingest/test/db/setup.js';
import { ingest } from '../../../ingest/src/ingest.js';
import { loadReferenceData } from '../../../ingest/src/mssql/reference.js';
import { MssqlRepository } from '../../../ingest/src/mssql/repository.js';
import { buildXml, FakePdf } from '../../../ingest/test/helpers.js';
import { MssqlCostingStore } from '../../src/costing/mssqlStore.js';
import { CHARGES, type ModelInput } from '../../src/costing/types.js';
import { ConflictError, NotFoundError, ValidationError } from '../../src/errors.js';

/** Runs against the scratch database named in INTELLIDOC_TEST_DB. It DROPS and recreates the idoc schema. */
const cs = process.env['INTELLIDOC_TEST_DB'];
describe.skipIf(!cs)('MssqlCostingStore', { timeout: 120_000 }, () => {
  let pool: sql.ConnectionPool; let ipool: Awaited<ReturnType<typeof connectIngest>>; let store: MssqlCostingStore;
  let parent: number; let child: number; let sub: number; let stock: number; let rate1: number; let rate2: number;
  const scalar = async (q: string): Promise<number> => (await pool.request().query(q)).recordset[0].n as number;
  const acct = (code: string, parentId: number | null, extra = ''): Promise<number> => scalar(`
    INSERT INTO idoc.account (account_code, name, parent_account_id${extra ? ', ' + extra.split('=')[0] : ''}) OUTPUT INSERTED.account_id AS n
    VALUES (N'${code}', N'${code}', ${parentId ?? 'NULL'}${extra ? ', ' + extra.split('=')[1] : ''})`);
  const history = async (customer: number): Promise<string[]> =>
    ((await pool.request().query(`SELECT summary FROM idoc.audit_log WHERE entity = N'customer' AND entity_id = ${customer} ORDER BY audit_id`)).recordset as { summary: string }[]).map((r) => r.summary);
  const input = (over: Partial<ModelInput> = {}): ModelInput => ({
    name: 'Prices', validFrom: '2026-01-01', validTo: null, isActive: true, comments: null,
    charges: [{ code: 'HPOD', cost: 0.1, sellPrice: 0.2, adjustment: 0 }, { code: 'MONO_PAGE', cost: 0.0212, sellPrice: 0.0431, adjustment: -0.005 }],
    envelopes: [{ stockItemId: stock, cost: 0.04, sellPrice: 0.08, adjustment: 0.01 }], postage: [{ postalRateId: rate1, adjustment: 0.05 }, { postalRateId: rate2, adjustment: 0 }], ...over,
  });

  beforeAll(async () => {
    pool = new sql.ConnectionPool(cs!); await pool.connect();
    await assertScratchDatabase(pool, /test|scratch|tmp/i);
    ipool = await connectIngest(); await resetAndSeed(ipool); store = new MssqlCostingStore(pool);
    parent = await acct('CS_PARENT', null);
    child = await acct('CS_CHILD', parent, `costing_mode=N'INHERIT'`);
    sub = await acct('CS_SUB', parent, 'inherits_settings=1');
    stock = await scalar(`SELECT TOP 1 stock_item_id AS n FROM idoc.stock_item WHERE is_envelope = 1`);
    const rates = (await pool.request().query(`SELECT TOP 2 postal_rate_id AS id FROM idoc.postal_rate ORDER BY postal_rate_id`)).recordset as { id: number }[];
    rate1 = rates[0]!.id; rate2 = rates[1]?.id ?? rates[0]!.id + 1;
  });
  afterAll(async () => { await pool?.close(); await ipool?.close(); });

  it('creates, saves and reads back a model with every kind of price', async () => {
    const id = await store.create(parent, { name: 'Prices', validFrom: '2026-01-01', validTo: null, isActive: true, copyFromId: null }, 'ann');
    const detail = await store.update(id, input({ comments: 'Agreed in January' }), 'ann').then(() => store.model(id));
    expect(detail).toMatchObject({ id, customerId: parent, name: 'Prices', validFrom: '2026-01-01', validTo: null, isActive: true, comments: 'Agreed in January', mailpieceCount: 0, copiedFrom: null });
    expect(detail.charges.map((c) => c.code)).toEqual(CHARGES.map((c) => c.code));
    expect(detail.charges.find((c) => c.code === 'MONO_PAGE')).toMatchObject({ cost: 0.0212, sellPrice: 0.0431, adjustment: -0.005 });
    expect(detail.charges.find((c) => c.code === 'BAGGING')).toMatchObject({ cost: 0, sellPrice: 0 });
    expect(detail.envelopes).toEqual([expect.objectContaining({ stockItemId: stock, cost: 0.04, sellPrice: 0.08, adjustment: 0.01 })]);
    expect(detail.postage.find((p) => p.postalRateId === rate1)!.adjustment).toBe(0.05);
    expect((await history(parent)).at(-1)).toMatch(/^Costing model "Prices" changed: .*H-POD processing: cost 0 → 0.1, sell 0 → 0.2.*postage .*adjustment 0 → 0.05/);
  });

  it('every charge in the list is accepted by the database', async () => {
    const id = await store.create(parent, { name: 'All charges', validFrom: '2026-02-01', validTo: null, isActive: true, copyFromId: null }, 'ann');
    await store.update(id, input({ name: 'All charges', validFrom: '2026-02-01', charges: CHARGES.map((c, i) => ({ code: c.code, cost: i, sellPrice: i + 1, adjustment: 0 })) }), 'ann');
    expect((await store.model(id)).charges.map((c) => c.cost)).toEqual(CHARGES.map((_, i) => i));
  });

  it('replacing the prices replaces them (nothing is left over)', async () => {
    const id = await store.create(parent, { name: 'Replace', validFrom: '2026-03-01', validTo: null, isActive: true, copyFromId: null }, 'ann');
    await store.update(id, input({ name: 'Replace', validFrom: '2026-03-01' }), 'ann');
    await store.update(id, input({ name: 'Replace', validFrom: '2026-03-01', charges: [{ code: 'HPOD', cost: 1, sellPrice: 2, adjustment: 0 }], envelopes: [], postage: [] }), 'ann');
    const m = await store.model(id);
    expect(m.charges.filter((c) => c.cost !== 0 || c.sellPrice !== 0).map((c) => c.code)).toEqual(['HPOD']);
    expect(m.envelopes).toEqual([]);
    expect(m.postage.every((p) => p.adjustment === 0)).toBe(true);
  });

  it('copies a model with its prices and remembers where it came from', async () => {
    const a = await store.create(parent, { name: 'Original', validFrom: '2027-01-01', validTo: null, isActive: true, copyFromId: null }, 'ann');
    await store.update(a, input({ name: 'Original', validFrom: '2027-01-01' }), 'ann');
    const b = await store.create(parent, { name: 'Copy', validFrom: '2028-01-01', validTo: null, isActive: false, copyFromId: a }, 'ann');
    const m = await store.model(b);
    expect(m).toMatchObject({ name: 'Copy', isActive: false, copiedFrom: { id: a, name: 'Original' } });
    expect(m.charges.find((c) => c.code === 'HPOD')).toMatchObject({ cost: 0.1, sellPrice: 0.2 });
    expect(m.envelopes).toHaveLength(1);
    expect((await history(parent)).some((s) => s === 'Created costing model "Copy" (copied from "Original")')).toBe(true);
    await expect(store.create(parent, { name: 'x', validFrom: '2028-06-01', validTo: null, isActive: true, copyFromId: 99999 }, 'ann')).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses a second model on the same start day, and a missing envelope or rate', async () => {
    await expect(store.create(parent, { name: 'Dup', validFrom: '2026-01-01', validTo: null, isActive: true, copyFromId: null }, 'ann')).rejects.toBeInstanceOf(ConflictError);
    const id = await store.create(parent, { name: 'Other', validFrom: '2029-01-01', validTo: null, isActive: true, copyFromId: null }, 'ann');
    await expect(store.update(id, input({ name: 'Other', validFrom: '2026-01-01' }), 'ann')).rejects.toBeInstanceOf(ConflictError);
    await expect(store.update(id, input({ name: 'Other', validFrom: '2029-01-01', envelopes: [{ stockItemId: 999999, cost: 0, sellPrice: 0, adjustment: 0 }] }), 'ann')).rejects.toBeInstanceOf(ValidationError);
    await expect(store.update(id, input({ name: 'Other', validFrom: '2029-01-01', postage: [{ postalRateId: 999999, adjustment: 1 }] }), 'ann')).rejects.toBeInstanceOf(ValidationError);
    await expect(store.model(999999)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('inherits: a customer that takes its parent’s prices shows them, and switching changes the source', async () => {
    const o = await store.overview(child);
    expect(o).toMatchObject({ mode: 'INHERIT', inheritsAll: false, source: { id: parent, code: 'CS_PARENT' }, models: [] });
    expect(o.sourceModels.length).toBeGreaterThan(0);
    expect((await store.overview(parent)).source).toBeNull();
    expect(await store.overview(sub)).toMatchObject({ inheritsAll: true, source: { id: parent } });
    await store.setMode(child, 'OWN', 'ann');
    expect((await store.overview(child)).source).toBeNull();
    expect((await history(child)).at(-1)).toBe('Costing: parent’s prices → own prices');
    await store.setMode(child, 'INHERIT', 'ann');
    await expect(store.setMode(sub, 'OWN', 'ann')).rejects.toBeInstanceOf(ConflictError);
    await expect(store.setMode(parent, 'INHERIT', 'ann')).rejects.toBeInstanceOf(ValidationError);
  });

  it('says which model prices today', async () => {
    const o = await store.overview(parent);
    const today = new Date().toISOString().slice(0, 10);
    const expected = o.models.filter((m) => m.isActive && m.validFrom <= today && (m.validTo === null || m.validTo >= today)).sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
    expect(o.inForceId).toBe(expected?.id ?? null);
  });

  it('a model that has priced a mailpiece cannot be deleted; an unused one can', async () => {
    const ref = await loadReferenceData(ipool);
    const { xml, pages } = buildXml([{ first: 'Dee', surname: 'Lee', lines: ['Dee Lee', '1 High Street', 'Town', 'AB1 2CD'] }]);
    await ingest(xml, 'job-cost-used.xml', 'job-cost-used.pdf', { ref, pdf: new FakePdf(pages), repo: new MssqlRepository(ipool) });
    const customer = await scalar(`SELECT TOP 1 account_id AS n FROM idoc.mailpiece`);
    const used = await store.create(customer, { name: 'Used', validFrom: '2000-01-01', validTo: null, isActive: true, copyFromId: null }, 'ann');
    await pool.request().query(`UPDATE idoc.mailpiece SET costing_model_id = ${used}`);
    expect((await store.overview(customer)).models.find((m) => m.id === used)!.mailpieceCount).toBeGreaterThan(0);
    await expect(store.remove(used, 'ann')).rejects.toThrow(/cannot be deleted/);
    const free = await store.create(parent, { name: 'Unused', validFrom: '2030-01-01', validTo: null, isActive: true, copyFromId: null }, 'ann');
    const copy = await store.create(parent, { name: 'Copy of unused', validFrom: '2031-01-01', validTo: null, isActive: true, copyFromId: free }, 'ann');
    await store.remove(free, 'ann');
    await expect(store.model(free)).rejects.toBeInstanceOf(NotFoundError);
    expect((await store.model(copy)).copiedFrom).toBeNull();
    expect((await history(parent)).at(-1)).toBe('Deleted costing model "Unused"');
  });

  it('lists the envelopes that can be priced', async () => {
    expect((await store.lookups()).envelopeStock.some((s) => s.id === stock)).toBe(true);
  });
});
