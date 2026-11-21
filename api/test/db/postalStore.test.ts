import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sql from 'mssql';
import { assertScratchDatabase } from '../../../ingest/src/mssql/devDb.js';
import { connect as connectIngest, resetAndSeed } from '../../../ingest/test/db/setup.js';
import { MssqlPostalStore } from '../../src/postal/mssqlStore.js';
import { ConflictError, NotFoundError } from '../../src/errors.js';

/** Runs against the scratch database named in INTELLIDOC_TEST_DB. It DROPS and recreates the idoc schema. */
const cs = process.env['INTELLIDOC_TEST_DB'];
describe.skipIf(!cs)('MssqlPostalStore', { timeout: 120_000 }, () => {
  let pool: sql.ConnectionPool; let ipool: Awaited<ReturnType<typeof connectIngest>>; let store: MssqlPostalStore;
  let provider: number; let service: number; let formatId: number;
  const scalar = async (q: string): Promise<number> => (await pool.request().query(q)).recordset[0].n as number;
  const history = async (): Promise<string[]> => ((await pool.request().query(`SELECT summary FROM idoc.audit_log WHERE entity = N'postal' ORDER BY audit_id`)).recordset as { summary: string }[]).map((r) => r.summary);
  const rate = { minWeightG: 0, maxWeightG: 100, validFrom: '2026-01-01', validTo: null as string | null, cost: 0.6, sellPrice: 0.7 };
  const rows = async (): Promise<{ id: number; validFrom: string; validTo: string | null; cost: number | null; usedBy: number }[]> =>
    (await store.overview()).providers.find((p) => p.id === provider)!.services.find((s) => s.id === service)!.rates;

  beforeAll(async () => {
    pool = new sql.ConnectionPool(cs!); await pool.connect();
    await assertScratchDatabase(pool, /test|scratch|tmp/i);
    ipool = await connectIngest(); await resetAndSeed(ipool); store = new MssqlPostalStore(pool);
    formatId = await scalar('SELECT TOP 1 postal_format_id AS n FROM idoc.postal_format ORDER BY rank_order');
    provider = await store.createProvider('PS Courier', 'tester');
    service = await store.createService(provider, { formatId, name: 'PS Express', serviceCode: 'PSX', isSignedFor: false, isTracked: true, isRecorded: false }, 'tester');
  });
  afterAll(async () => { await pool?.close(); await ipool?.close(); });

  it('rejects duplicate names', async () => {
    await expect(store.createProvider('ps courier', 'tester')).rejects.toBeInstanceOf(ConflictError);
    await expect(store.createService(provider, { formatId, name: 'PS Express', serviceCode: null, isSignedFor: false, isTracked: false, isRecorded: false }, 'tester')).rejects.toBeInstanceOf(ConflictError);
  });
  it('adds a price, refuses an overlapping one, and edits it', async () => {
    const id = await store.createRate(service, rate, 'tester');
    await expect(store.createRate(service, { ...rate, validFrom: '2026-06-01' }, 'tester')).rejects.toBeInstanceOf(ConflictError);
    await store.updateRate(id, { ...rate, maxWeightG: 120, cost: 0.65 }, 'tester');
    expect((await rows())[0]).toMatchObject({ id, cost: 0.65, usedBy: 0 });
    expect((await history()).some((h) => /cost 0.6 → 0.65/.test(h))).toBe(true);
  });
  it('a dated change ends the old row, starts a new one and carries the customer adjustments over', async () => {
    const old = (await rows())[0]!.id;
    const acc = await scalar(`INSERT INTO idoc.account (account_code, name) OUTPUT INSERTED.account_id AS n VALUES (N'PS_ACC', N'PS_ACC')`);
    const model = await scalar(`INSERT INTO idoc.costing_model (account_id, name, valid_from) OUTPUT INSERTED.costing_model_id AS n VALUES (${acc}, N'm', '2026-01-01')`);
    await pool.request().query(`INSERT INTO idoc.costing_model_postage (costing_model_id, postal_rate_id, adjustment) VALUES (${model}, ${old}, 0.05)`);
    const n = await store.priceChange(service, { effectiveFrom: '2099-01-01', changes: [{ rateId: old, cost: 0.9, sellPrice: 1 }] }, 'tester');
    expect(n).toBe(1);
    const all = await rows();
    expect(all).toHaveLength(2);
    const fresh = all.find((r) => r.validFrom === '2099-01-01')!;
    expect(fresh).toMatchObject({ cost: 0.9, validTo: null });
    expect(all.find((r) => r.id === old)).toMatchObject({ validTo: '2098-12-31', usedBy: 1 });
    expect(await scalar(`SELECT adjustment AS n FROM idoc.costing_model_postage WHERE costing_model_id = ${model} AND postal_rate_id = ${fresh.id}`)).toBeCloseTo(0.05);
    await expect(store.priceChange(service, { effectiveFrom: '2099-06-01', changes: [{ rateId: old, cost: 1, sellPrice: 1 }] }, 'tester')).rejects.toBeInstanceOf(ConflictError);
    await expect(store.priceChange(service, { effectiveFrom: '2020-01-01', changes: [{ rateId: fresh.id, cost: 1, sellPrice: 1 }] }, 'tester')).rejects.toThrow();
  });
  it('a used price keeps its weights and cannot be deleted; an unused one can', async () => {
    const used = (await rows()).find((r) => r.usedBy > 0)!;
    await expect(store.updateRate(used.id, { ...rate, maxWeightG: 999, validFrom: '2026-01-01', validTo: '2098-12-31' }, 'tester')).rejects.toBeInstanceOf(ConflictError);
    await expect(store.deleteRate(used.id, 'tester')).rejects.toBeInstanceOf(ConflictError);
    const spare = await store.createRate(service, { ...rate, minWeightG: 101, maxWeightG: 200 }, 'tester');
    await store.deleteRate(spare, 'tester');
    await expect(store.deleteRate(spare, 'tester')).rejects.toBeInstanceOf(NotFoundError);
  });
  it('a service or provider can only be deleted when nothing hangs off it', async () => {
    await expect(store.deleteService(service, 'tester')).rejects.toBeInstanceOf(ConflictError);
    await expect(store.deleteProvider(provider, 'tester')).rejects.toBeInstanceOf(ConflictError);
    const p2 = await store.createProvider('PS Spare', 'tester');
    const s2 = await store.createService(p2, { formatId, name: 'Spare', serviceCode: null, isSignedFor: false, isTracked: false, isRecorded: false }, 'tester');
    await store.deleteService(s2, 'tester'); await store.deleteProvider(p2, 'tester');
    expect((await store.history(5)).length).toBeGreaterThan(0);
  });
});
