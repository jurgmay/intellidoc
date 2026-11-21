import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { MemoryCostingStore } from '../src/costing/memoryStore.js';
import { describeModelChange } from '../src/costing/describe.js';
import { CHARGES } from '../src/costing/types.js';
import { MemoryCustomerStore } from '../src/customers/memoryStore.js';
import { MemoryRecipientStore } from '../src/recipients/memoryStore.js';
import { MemoryReportStore } from '../src/reports/memoryStore.js';
import { MemorySettingsStore } from '../src/settings/store.js';

let app: FastifyInstance; let store: MemoryCostingStore;
const ODEVO = 1; const HIGH = 2; const SUB = 3; const TOP = 4;

beforeEach(async () => {
  store = new MemoryCostingStore(); store.today = () => '2026-11-21';
  store.customers.set(ODEVO, { id: ODEVO, code: 'ODEVO', name: 'Odevo', mode: 'OWN', inheritsAll: false, parentId: null });
  store.customers.set(HIGH, { id: HIGH, code: 'HIGH', name: 'Highline', mode: 'INHERIT', inheritsAll: false, parentId: ODEVO });
  store.customers.set(SUB, { id: SUB, code: 'SUB', name: 'Sub', mode: 'OWN', inheritsAll: true, parentId: ODEVO });
  store.customers.set(TOP, { id: TOP, code: 'TOP', name: 'Top', mode: 'OWN', inheritsAll: false, parentId: null });
  store.envelopeStock = [{ id: 10, code: 'C5', description: 'C5 window', size: 'C5' }, { id: 11, code: 'C4', description: 'C4 window', size: 'C4' }];
  store.postalRates = [{ id: 1, label: 'RM 2nd letter', format: 'Letter', cost: 0.6, sell: 0.65 }, { id: 2, label: 'RM 1st letter', format: 'Letter', cost: 0.8, sell: 0.9 }];
  app = await buildApp({ settings: new MemorySettingsStore(), customers: new MemoryCustomerStore(), costing: store, recipients: new MemoryRecipientStore(), reports: new MemoryReportStore() });
});
const body = (over: Record<string, unknown> = {}) => ({ name: '2026', validFrom: '2026-01-01', validTo: null, isActive: true, copyFromId: null, ...over });
const post = (customer: number, b: unknown) => app.inject({ method: 'POST', url: `/api/customers/${customer}/costing-models`, payload: b as object });
const put = (id: number, b: unknown) => app.inject({ method: 'PUT', url: `/api/costing-models/${id}`, payload: b as object });
const full = (over: Record<string, unknown> = {}) => ({
  name: '2026', validFrom: '2026-01-01', validTo: null, isActive: true, comments: null,
  charges: [{ code: 'HPOD', cost: 0.1, sellPrice: 0.2, adjustment: 0 }, { code: 'MONO_PAGE', cost: 0.02, sellPrice: 0.04, adjustment: 0.005 }],
  envelopes: [{ stockItemId: 10, cost: 0.02, sellPrice: 0.04, adjustment: 0 }], postage: [{ postalRateId: 1, adjustment: 0.05 }, { postalRateId: 2, adjustment: 0 }], ...over,
});

describe('costing models', () => {
  it('lists a customer’s models, newest first, and says which one prices today', async () => {
    await post(ODEVO, body({ name: '2025', validFrom: '2025-01-01', validTo: '2025-12-31' }));
    await post(ODEVO, body());
    const o = (await app.inject({ method: 'GET', url: `/api/customers/${ODEVO}/costing` })).json();
    expect(o.models.map((m: { name: string }) => m.name)).toEqual(['2026', '2025']);
    expect(o).toMatchObject({ mode: 'OWN', source: null, inForceId: 2 });
  });
  it('a model that is switched off or finished does not price today’s mail', async () => {
    await post(ODEVO, body({ isActive: false }));
    await post(ODEVO, body({ name: 'Ended', validFrom: '2025-01-01', validTo: '2025-12-31' }));
    expect((await app.inject({ method: 'GET', url: `/api/customers/${ODEVO}/costing` })).json().inForceId).toBeNull();
  });
  it('a new model can be copied, with every price', async () => {
    const a = (await post(ODEVO, body())).json().id;
    await put(a, full());
    const b = (await post(ODEVO, body({ name: '2027', validFrom: '2027-01-01', copyFromId: a }))).json().id;
    const m = (await app.inject({ method: 'GET', url: `/api/costing-models/${b}` })).json();
    expect(m).toMatchObject({ name: '2027', validFrom: '2027-01-01', copiedFrom: { id: a, name: '2026' } });
    expect(m.charges.find((c: { code: string }) => c.code === 'MONO_PAGE')).toMatchObject({ cost: 0.02, sellPrice: 0.04, adjustment: 0.005 });
    expect(m.envelopes).toHaveLength(1);
    expect(m.postage.find((p: { postalRateId: number }) => p.postalRateId === 1).adjustment).toBe(0.05);
  });
  it('shows every charge in order, with zero for the ones that are not set', async () => {
    const id = (await post(ODEVO, body())).json().id;
    const m = (await app.inject({ method: 'GET', url: `/api/costing-models/${id}` })).json();
    expect(m.charges.map((c: { code: string }) => c.code)).toEqual(CHARGES.map((c) => c.code));
    expect(m.charges.every((c: { cost: number; sellPrice: number }) => c.cost === 0 && c.sellPrice === 0)).toBe(true);
  });
  it('two models cannot start on the same day', async () => {
    await post(ODEVO, body());
    const r = await post(ODEVO, body({ name: 'Again' }));
    expect(r.statusCode).toBe(409);
    expect((await post(TOP, body())).statusCode).toBe(201); // another customer can
  });
  it('checks the details: name, dates, copy source', async () => {
    const r = await post(ODEVO, body({ name: ' ', validFrom: '2026-02-30', validTo: '2025-01-01' }));
    expect(r.statusCode).toBe(422);
    expect(Object.keys(r.json().errors)).toEqual(expect.arrayContaining(['name', 'validFrom']));
    const r2 = await post(ODEVO, body({ validTo: '2025-12-31' }));
    expect(r2.json().errors.validTo).toMatch(/before/);
    expect((await post(ODEVO, body({ validFrom: '2030-01-01', copyFromId: 999 }))).statusCode).toBe(404);
  });
  it('saves charges, envelope prices and postage adjustments, and drops zero postage adjustments', async () => {
    const id = (await post(ODEVO, body())).json().id;
    const r = await put(id, full({ comments: 'Agreed in January' }));
    expect(r.statusCode).toBe(200);
    expect(r.json().comments).toBe('Agreed in January');
    expect(r.json().charges.find((c: { code: string }) => c.code === 'HPOD')).toMatchObject({ cost: 0.1, sellPrice: 0.2 });
    expect(r.json().envelopes[0]).toMatchObject({ stockItemId: 10, stockCode: 'C5', sellPrice: 0.04 });
    expect(store.models.get(id)!.input.postage).toEqual([{ postalRateId: 1, adjustment: 0.05 }]);
  });
  it('rejects prices that make no sense, naming the field', async () => {
    const id = (await post(ODEVO, body())).json().id;
    const r = await put(id, full({
      charges: [{ code: 'HPOD', cost: -1, sellPrice: 0.12345, adjustment: 0 }, { code: 'HPOD', cost: 0, sellPrice: 0, adjustment: 0 }, { code: 'GEO', cost: 0, sellPrice: 0, adjustment: 0 }, { code: 'BAGGING', cost: 'x', sellPrice: 0, adjustment: -0.5 }],
      envelopes: [{ stockItemId: 10, cost: 0, sellPrice: 0, adjustment: 0 }, { stockItemId: 10, cost: 0, sellPrice: 0, adjustment: 0 }, { stockItemId: 99, cost: 0, sellPrice: 0, adjustment: 0 }],
    }));
    expect(r.statusCode).toBe(422);
    const e = r.json().errors;
    expect(e['charges.0.cost']).toMatch(/negative/);
    expect(e['charges.0.sellPrice']).toMatch(/4 decimal/);
    expect(e['charges.1.code']).toMatch(/once/);
    expect(e['charges.2.code']).toMatch(/Unknown/);
    expect(e['charges.3.cost']).toMatch(/number/);
    expect(e['charges.3.adjustment']).toBeUndefined(); // an adjustment can be negative
    expect(e['envelopes.1.stockItemId']).toMatch(/once/);
  });
  it('rejects an envelope or postal rate that does not exist', async () => {
    const id = (await post(ODEVO, body())).json().id;
    const r = await put(id, full({ envelopes: [{ stockItemId: 99, cost: 0, sellPrice: 0, adjustment: 0 }] }));
    expect(r.statusCode).toBe(422);
    expect(r.json().errors['envelopes.0.stockItemId']).toMatch(/does not exist/);
    expect((await put(id, full({ postage: [{ postalRateId: 77, adjustment: 1 }] }))).json().errors['postage.0.postalRateId']).toMatch(/does not exist/);
  });
  it('moving a model onto another model’s start day is refused', async () => {
    await post(ODEVO, body());
    const b = (await post(ODEVO, body({ name: 'Later', validFrom: '2027-01-01' }))).json().id;
    expect((await put(b, full({ name: 'Later', validFrom: '2026-01-01' }))).statusCode).toBe(409);
  });
  it('a model that has priced mail cannot be deleted; an unused one can', async () => {
    const used = (await post(ODEVO, body())).json().id; store.models.get(used)!.mailpieceCount = 3;
    const free = (await post(ODEVO, body({ name: 'Free', validFrom: '2027-01-01' }))).json().id;
    const r = await app.inject({ method: 'DELETE', url: `/api/costing-models/${used}` });
    expect(r.statusCode).toBe(409); expect(r.json().error).toMatch(/3 mailpieces/);
    expect((await app.inject({ method: 'DELETE', url: `/api/costing-models/${free}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/costing-models/${free}` })).statusCode).toBe(404);
  });
  it('deleting the model another was copied from keeps the copy', async () => {
    const a = (await post(ODEVO, body())).json().id;
    const b = (await post(ODEVO, body({ name: 'Copy', validFrom: '2027-01-01', copyFromId: a }))).json().id;
    await app.inject({ method: 'DELETE', url: `/api/costing-models/${a}` });
    expect((await app.inject({ method: 'GET', url: `/api/costing-models/${b}` })).json().copiedFrom).toBeNull();
  });
});

describe('costing mode and inheriting', () => {
  it('a customer that inherits shows its source and the source’s models, read only', async () => {
    await post(ODEVO, body());
    const o = (await app.inject({ method: 'GET', url: `/api/customers/${HIGH}/costing` })).json();
    expect(o).toMatchObject({ mode: 'INHERIT', source: { id: ODEVO, code: 'ODEVO' }, inForceId: 1 });
    expect(o.models).toEqual([]);
    expect(o.sourceModels).toHaveLength(1);
  });
  it('a customer can switch between its own prices and its parent’s, and the change is logged', async () => {
    const put = (id: number, mode: string) => app.inject({ method: 'PUT', url: `/api/customers/${id}/costing-mode`, payload: { mode } });
    expect((await put(HIGH, 'OWN')).json()).toMatchObject({ mode: 'OWN', source: null });
    expect((await put(HIGH, 'INHERIT')).json().source).toMatchObject({ code: 'ODEVO' });
    expect(store.audit.map((a) => a.summary)).toEqual(['Costing: parent’s prices → own prices', 'Costing: own prices → parent’s prices']);
    expect((await put(HIGH, 'SIDEWAYS')).statusCode).toBe(422);
  });
  it('a customer with no parent cannot take its parent’s prices; a sub-account cannot choose', async () => {
    const put = (id: number, mode: string) => app.inject({ method: 'PUT', url: `/api/customers/${id}/costing-mode`, payload: { mode } });
    expect((await put(TOP, 'INHERIT')).statusCode).toBe(422);
    expect((await put(SUB, 'OWN')).statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: `/api/customers/${SUB}/costing` })).json()).toMatchObject({ inheritsAll: true, source: { id: ODEVO } });
  });
  it('an unknown customer is a 404', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/customers/99/costing' })).statusCode).toBe(404);
  });
});

describe('what the change log says', () => {
  it('names each price that changed, before and after', async () => {
    const id = (await post(ODEVO, body())).json().id;
    await put(id, full());
    await put(id, full({ name: '2026 revised', charges: [{ code: 'HPOD', cost: 0.1, sellPrice: 0.25, adjustment: 0 }, { code: 'MONO_PAGE', cost: 0.02, sellPrice: 0.04, adjustment: 0.005 }], postage: [{ postalRateId: 1, adjustment: 0.1 }] }));
    const line = store.audit.at(-1)!.summary;
    expect(line).toContain('name "2026" → "2026 revised"');
    expect(line).toContain('H-POD processing: sell 0.2 → 0.25');
    expect(line).toContain('postage RM 2nd letter: adjustment 0.05 → 0.1');
    expect(line).not.toContain('Mono page');
  });
  it('says nothing when nothing changed', async () => {
    const id = (await post(ODEVO, body())).json().id;
    await put(id, full());
    const n = store.audit.length;
    await put(id, full());
    expect(store.audit).toHaveLength(n);
    expect(describeModelChange('x', full() as never, full() as never, String, String)).toBeNull();
  });
});
