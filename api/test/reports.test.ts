import type { FastifyInstance } from 'fastify';
import { PDFDocument } from 'pdf-lib';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { MemoryCustomerStore } from '../src/customers/memoryStore.js';
import { MemoryRepriceStore } from '../src/reprice/memoryStore.js';
import { MemoryPostalStore } from '../src/postal/memoryStore.js';
import { MemoryCostingStore } from '../src/costing/memoryStore.js';
import { MemoryRecipientStore } from '../src/recipients/memoryStore.js';
import { buildUsageReport, eachDay } from '../src/reports/aggregate.js';
import { MemoryReportStore } from '../src/reports/memoryStore.js';
import { MemoryReferenceStore } from '../src/reference/memoryStore.js';
import { chartBrands, usagePdf } from '../src/reports/pdf.js';
import type { UsageLine } from '../src/reports/types.js';
import { MemorySettingsStore } from '../src/settings/store.js';

const L = (day: string, brand: string, format: string, service: string, mailpieces: number, packs = mailpieces, sheets = mailpieces * 2, priced = mailpieces): UsageLine =>
  ({ day, brand, format, service, mailpieces, packs, sheets, priced, productionSell: priced * 0.25, postageSell: priced * 0.75 });
let app: FastifyInstance;
let store: MemoryReportStore;

beforeEach(async () => {
  store = new MemoryReportStore();
  store.accounts = [{ id: 5, code: 'ODEVO', name: 'Odevo' }, { id: 6, code: 'EMPTY', name: 'Empty Co' }];
  store.lines.set(5, [
    L('2026-11-02', 'Home', 'Letter', '2nd Class', 10, 12, 30), L('2026-11-02', 'Business', 'Letter', '1st Class', 4), L('2026-11-02', 'Home', 'Large Letter', '2nd Class', 1),
    L('2026-11-04', 'Home', 'Letter', '2nd Class', 7, 7, 14, 5), L('2026-11-30', 'Home', 'Letter', '2nd Class', 99), // outside the range asked for below
  ]);
  // the same mail with what it cost: production at 60% of sell, postage at 90%
  store.marginLines_.set(5, store.lines.get(5)!.map((l) => ({ day: l.day, brand: l.brand, format: l.format, service: l.service, mailpieces: l.mailpieces, priced: l.priced,
    productionSell: l.productionSell, postageSell: l.postageSell, productionCost: l.productionSell * 0.6, postageCost: l.postageSell * 0.9 })));
  app = await buildApp({ settings: new MemorySettingsStore(), customers: new MemoryCustomerStore(), costing: new MemoryCostingStore(), postal: new MemoryPostalStore(), reprice: new MemoryRepriceStore(), recipients: new MemoryRecipientStore(), reports: store, reference: new MemoryReferenceStore() });
});
const get = (qs: string) => app.inject({ method: 'GET', url: `/api/reports/usage?${qs}` });

describe('usage report', () => {
  it('counts per day (including empty days), brand, and format and service', async () => {
    const r = (await get('invoicingAccountId=5&from=2026-11-01&to=2026-11-05')).json();
    expect(r.account).toEqual({ id: 5, code: 'ODEVO', name: 'Odevo' });
    expect(r.days.map((d: { day: string }) => d.day)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05']);
    expect(r.days[0]).toMatchObject({ mailpieces: 0, packs: 0, sheets: 0, totalSell: 0, byBrand: {} });
    expect(r.days[1]).toMatchObject({ mailpieces: 15, packs: 17, sheets: 30 + 8 + 2, byBrand: { Home: 11, Business: 4 } });
    expect(r.brands).toMatchObject([{ brand: 'Home', mailpieces: 18, packs: 20, sheets: 30 + 2 + 14 }, { brand: 'Business', mailpieces: 4, packs: 4, sheets: 8 }]);
    expect(r.postage).toMatchObject([
      { format: 'Large Letter', service: '2nd Class', mailpieces: 1, packs: 1, sheets: 2 },
      { format: 'Letter', service: '1st Class', mailpieces: 4, packs: 4, sheets: 8 },
      { format: 'Letter', service: '2nd Class', mailpieces: 17, packs: 19, sheets: 44 },
    ]);
    expect(r.totals).toMatchObject({ mailpieces: 22, packs: 24, sheets: 54 });
  });
  it('adds up what would be invoiced, and counts mail that has no price yet instead of hiding it', async () => {
    const r = (await get('invoicingAccountId=5&from=2026-11-01&to=2026-11-05')).json();
    // 20 of the 22 mailpieces are priced: production 0.25 and postage 0.75 each
    expect(r.totals).toEqual({ mailpieces: 22, packs: 24, sheets: 54, productionSell: 5, postageSell: 15, totalSell: 20, unpriced: 2 });
    expect(r.days[3]).toMatchObject({ day: '2026-11-04', mailpieces: 7, unpriced: 2, productionSell: 1.25, postageSell: 3.75, totalSell: 5 });
    expect(r.brands.find((b: { brand: string }) => b.brand === 'Business')).toMatchObject({ productionSell: 1, postageSell: 3, totalSell: 4, unpriced: 0 });
  });
  it('gives zeros for an account that produced nothing', async () => {
    const r = (await get('invoicingAccountId=6&from=2026-11-01&to=2026-11-02')).json();
    expect(r.totals).toEqual({ mailpieces: 0, packs: 0, sheets: 0, productionSell: 0, postageSell: 0, totalSell: 0, unpriced: 0 });
    expect(r.days).toHaveLength(2);
  });
  it('needs an account and both days, and checks them', async () => {
    expect((await get('from=2026-11-01&to=2026-11-02')).json().errors.invoicingAccountId).toBeDefined();
    const e = (await get('invoicingAccountId=5')).json().errors;
    expect(Object.keys(e).sort()).toEqual(['from', 'to']);
    expect((await get('invoicingAccountId=5&from=2026-11-05&to=2026-11-01')).json().errors.to).toMatch(/before/);
    expect((await get('invoicingAccountId=5&from=2026-02-30&to=2026-03-01')).json().errors.from).toBeDefined();
    expect((await get('invoicingAccountId=5&from=2025-01-01&to=2026-11-01')).json().errors.to).toMatch(/at most 366/);
    expect((await get('invoicingAccountId=99&from=2026-11-01&to=2026-11-02')).statusCode).toBe(404);
  });
  it('lists the invoicing accounts', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/reports/invoicing-accounts' })).json().rows).toHaveLength(2);
  });
  it('eachDay includes both ends and crosses month and year ends', () => {
    expect(eachDay('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
  });
});

describe('usage PDF', () => {
  it('is a PDF named for the account and period', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/reports/usage.pdf?invoicingAccountId=5&from=2026-11-01&to=2026-11-05' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.headers['content-disposition']).toContain('usage-ODEVO-2026-11-01-to-2026-11-05.pdf');
    expect(r.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await PDFDocument.load(r.rawPayload)).getPageCount()).toBe(1);
  });
  it('refuses the same bad input as the report', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/reports/usage.pdf?from=2026-11-01&to=2026-11-02' })).statusCode).toBe(422);
  });
  it('runs to more pages for a long, busy report and an empty one still renders', async () => {
    const days = eachDay('2026-01-01', '2026-12-31');
    const lines = days.flatMap((d, i) => ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((b, j) => L(d, b, 'Letter', '2nd Class', 1 + ((i + j) % 9))));
    const big = await usagePdf(buildUsageReport({ id: 1, code: 'X', name: 'X' }, '2026-01-01', '2026-12-31', lines), new Date('2026-12-31T10:00:00Z'));
    expect((await PDFDocument.load(big)).getPageCount()).toBeGreaterThan(1);
    const empty = await usagePdf(buildUsageReport({ id: 1, code: 'X', name: 'X' }, '2026-11-01', '2026-11-01', []), new Date());
    expect((await PDFDocument.load(empty)).getPageCount()).toBe(1);
  });
  it('shows the six biggest brands in the chart and groups the rest', () => {
    const names = 'ABCDEFGHIJ'.split('');
    const rep = buildUsageReport({ id: 1, code: 'X', name: 'X' }, '2026-11-01', '2026-11-01', names.map((b, i) => L('2026-11-01', b, 'Letter', '2nd Class', 100 - i)));
    expect(chartBrands(rep)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'Other']);
    expect(chartBrands(buildUsageReport({ id: 1, code: 'X', name: 'X' }, '2026-11-01', '2026-11-01', names.slice(0, 7).map((b) => L('2026-11-01', b, 'Letter', '2nd Class', 1))))).toHaveLength(7);
  });
});

describe('margin report', () => {
  const margin = (qs: string) => app.inject({ method: 'GET', url: `/api/reports/margin?${qs}` });
  it('adds up sell, cost and margin, with the margin as a percentage of sell', async () => {
    const r = (await margin('invoicingAccountId=5&from=2026-11-01&to=2026-11-05')).json();
    // 20 priced mailpieces: sell 5 + 15 = 20; cost 5 x 0.6 + 15 x 0.9 = 16.5
    expect(r.totals).toEqual({ mailpieces: 22, unpriced: 2, productionSell: 5, productionCost: 3, postageSell: 15, postageCost: 13.5, sell: 20, cost: 16.5, margin: 3.5, marginPct: 17.5 });
    expect(r.days).toHaveLength(5);
    expect(r.days[0]).toMatchObject({ sell: 0, cost: 0, margin: 0, marginPct: null });   // nothing sold, so no percentage
    expect(r.brands[0]).toMatchObject({ brand: 'Home' });
  });
  it('keeps costs out of the usage report and its PDF route', async () => {
    const usage = (await get('invoicingAccountId=5&from=2026-11-01&to=2026-11-05')).body;
    expect(usage).not.toMatch(/cost|margin/i);
  });
  it('validates like the usage report, and 404s for an unknown account', async () => {
    expect((await margin('invoicingAccountId=5&from=2026-11-05&to=2026-11-01')).statusCode).toBe(422);
    expect((await margin('invoicingAccountId=99&from=2026-11-01&to=2026-11-05')).statusCode).toBe(404);
  });
});

