import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { MemoryBatchStore, type MemoryBatch } from '../src/batches/memoryStore.js';
import { MemoryReportStore } from '../src/reports/memoryStore.js';
import { MemoryReferenceStore } from '../src/reference/memoryStore.js';
import { MemoryCustomerStore } from '../src/customers/memoryStore.js';
import { MemoryRepriceStore } from '../src/reprice/memoryStore.js';
import { MemoryPostalStore } from '../src/postal/memoryStore.js';
import { MemoryCostingStore } from '../src/costing/memoryStore.js';
import { MemoryRecipientStore } from '../src/recipients/memoryStore.js';
import { MemorySettingsStore } from '../src/settings/store.js';

let app: FastifyInstance;
let store: MemoryBatchStore;

const batch = (batchCode: number, ancestors: number[], over: Partial<MemoryBatch> = {}): MemoryBatch => ({
  batchId: batchCode, batchCode, status: 'Printed', job: `Statements ${batchCode}`, createdAt: '2026-11-18T09:30:00', department: 'Machine enclosing', service: 'Royal Mail 2nd Class (Letter)',
  envelope: 'C5 window', brand: null, invoicingCode: 'X', invoicingName: 'X', mailpieces: 2, mailpiecesInBatch: 2, cancelled: 0, packs: 3, pages: 6, sheets: 4, priceSell: 1.5, unpriced: 0, ancestors, ...over,
});

beforeEach(async () => {
  store = new MemoryBatchStore();
  store.scopeList = [{ id: 1, label: 'Parent', isCustomer: true }, { id: 2, label: 'Parent > Child', isCustomer: false }, { id: 3, label: 'Other', isCustomer: true }];
  store.batches = [
    batch(100, [1, 2], { createdAt: '2026-11-10T09:00:00' }),
    batch(101, [1], { createdAt: '2026-11-12T09:00:00', status: 'Despatched', job: 'Renewals' }),
    batch(102, [1, 2], { createdAt: '2026-11-12T11:00:00', mailpieces: 1, mailpiecesInBatch: 2 }),
    batch(200, [3], { createdAt: '2026-11-13T09:00:00' }),
  ];
  app = await buildApp({ settings: new MemorySettingsStore(), customers: new MemoryCustomerStore(), costing: new MemoryCostingStore(), postal: new MemoryPostalStore(), reprice: new MemoryRepriceStore(), recipients: new MemoryRecipientStore(), batches: store, reports: new MemoryReportStore(), reference: new MemoryReferenceStore() });
});

const get = (qs: string) => app.inject({ method: 'GET', url: `/api/batches/search?${qs}` });
const codes = async (qs: string): Promise<number[]> => ((await get(qs)).json().rows as { batchCode: number }[]).map((r) => r.batchCode);

describe('batch search', () => {
  it('needs an account', async () => {
    const r = await get('code=100');
    expect(r.statusCode).toBe(422);
    expect(r.json().errors.accountId).toMatch(/Choose the account/);
  });
  it('covers the account and below, newest first, never other customers', async () => {
    expect(await codes('accountId=1')).toEqual([102, 101, 100]);
    expect(await codes('accountId=2')).toEqual([102, 100]);
    expect(await codes('accountId=3')).toEqual([200]);
    expect((await get('accountId=1')).json().scope).toEqual({ id: 1, label: 'Parent' });
  });
  it('404 for an account that does not exist', async () => {
    expect((await get('accountId=99')).statusCode).toBe(404);
  });
  it('filters by code, status, job and the day created', async () => {
    expect(await codes('accountId=1&code=101')).toEqual([101]);
    expect(await codes('accountId=1&status=Despatched')).toEqual([101]);
    expect(await codes('accountId=1&job=renew')).toEqual([101]);
    expect(await codes('accountId=1&from=2026-11-12')).toEqual([102, 101]);
    expect(await codes('accountId=1&to=2026-11-11')).toEqual([100]);
    expect(await codes('accountId=1&from=2026-11-12&to=2026-11-12')).toEqual([102, 101]);
  });
  it('shows how many mailpieces are in scope and how many the batch holds', async () => {
    const row = (await get('accountId=2')).json().rows[0];
    expect(row).toMatchObject({ batchCode: 102, mailpieces: 1, mailpiecesInBatch: 2 });
  });
  it('checks the inputs', async () => {
    const e = (await get('accountId=1&code=abc&status=Lost&job=a&from=2026-13-01&to=x&limit=0')).json().errors;
    expect(Object.keys(e).sort()).toEqual(['code', 'from', 'job', 'limit', 'status', 'to']);
    expect((await get('accountId=1&from=2026-11-12&to=2026-11-01')).json().errors.to).toMatch(/before/);
  });
  it('limits the rows and says when there are more', async () => {
    const r = (await get('accountId=1&limit=2')).json();
    expect(r.rows).toHaveLength(2);
    expect(r.truncated).toBe(true);
    expect((await get('accountId=1&limit=3')).json().truncated).toBe(false);
  });
});
