import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemoryCostingStore } from '../src/costing/memoryStore.js';
import { MemoryCustomerStore } from '../src/customers/memoryStore.js';
import { MemoryPostalStore } from '../src/postal/memoryStore.js';
import { MemoryRecipientStore } from '../src/recipients/memoryStore.js';
import { MemoryReportStore } from '../src/reports/memoryStore.js';
import { MemoryRepriceStore } from '../src/reprice/memoryStore.js';
import { MemorySettingsStore } from '../src/settings/store.js';

let app: FastifyInstance; let store: MemoryRepriceStore;
const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload: payload as object });

beforeEach(async () => {
  store = new MemoryRepriceStore(); store.customers.add(7); store.counts = { inScope: 100, alreadyPriced: 80, wouldPrice: 20, noModel: 2, unknownColours: 1 };
  app = await buildApp({ settings: new MemorySettingsStore(), customers: new MemoryCustomerStore(), costing: new MemoryCostingStore(), postal: new MemoryPostalStore(), reprice: store, recipients: new MemoryRecipientStore(), reports: new MemoryReportStore() });
});

describe('re-price', () => {
  it('previews without running anything', async () => {
    const r = await post('/api/customers/7/reprice/preview', { from: '2026-01-01', to: '2026-03-31', overwrite: false });
    expect(r.json()).toEqual(store.counts);
    expect(store.runs).toHaveLength(0);
  });
  it('runs, answers with what was priced and logs it on the customer', async () => {
    const r = await post('/api/customers/7/reprice', { from: null, to: null, overwrite: true });
    expect(r.json()).toEqual({ priced: 20, noModel: 2, unknownColours: 1 });
    expect(store.runs[0]).toMatchObject({ customerId: 7, input: { overwrite: true } });
    expect(store.audit[0]!.summary).toMatch(/Priced mail again \(including mail already priced\): 20 priced; 2 had no costing model, 1 had unknown page colours/);
  });
  it('defaults to unpriced mail only with no date limits', async () => {
    await post('/api/customers/7/reprice', {});
    expect(store.runs[0]!.input).toEqual({ from: null, to: null, overwrite: false });
  });
  it('rejects bad dates and an unknown customer', async () => {
    expect((await post('/api/customers/7/reprice', { from: '2026-05-01', to: '2026-04-01' })).statusCode).toBe(422);
    expect((await post('/api/customers/7/reprice/preview', { from: 'yesterday' })).statusCode).toBe(422);
    expect((await post('/api/customers/7/reprice', { overwrite: 'yes' })).statusCode).toBe(422);
    expect((await post('/api/customers/99/reprice', {})).statusCode).toBe(404);
  });
});
