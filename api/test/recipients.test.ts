import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { MemoryReportStore } from '../src/reports/memoryStore.js';
import { MemoryCustomerStore } from '../src/customers/memoryStore.js';
import { MemoryRepriceStore } from '../src/reprice/memoryStore.js';
import { MemoryPostalStore } from '../src/postal/memoryStore.js';
import { MemoryCostingStore } from '../src/costing/memoryStore.js';
import { MemoryRecipientStore, type MemoryRecipient } from '../src/recipients/memoryStore.js';
import { containsPattern, referencePattern } from '../src/recipients/validate.js';
import { MemorySettingsStore } from '../src/settings/store.js';

let app: FastifyInstance;
let store: MemoryRecipientStore;

const row = (packId: number, ancestors: number[], over: Partial<MemoryRecipient>): MemoryRecipient => ({
  packId, mailpieceId: packId, batchCode: 9000 + packId, batchStatus: 'Printed', job: `job-${packId}`, releaseDate: '2026-11-18T09:00:00',
  addressLines: ['Ann Lee', '1 High Street', 'Town'], postcode: 'AB1 2CD', accountCode: 'X', accountName: 'X', accountPath: 'X', invoicingCode: 'X', invoicingName: 'X', brand: null,
  references: {}, priceSell: null, ancestors, ...over,
});

beforeEach(async () => {
  store = new MemoryRecipientStore();
  // 1 Parent customer > 2 Child sub-account, 3 Other customer
  store.scopeList = [{ id: 1, label: 'Parent', isCustomer: true }, { id: 2, label: 'Parent > Child', isCustomer: false }, { id: 3, label: 'Other', isCustomer: true }];
  store.recipients = [
    row(1, [1], { addressLines: ['Mrs Anne Patel', '12 Mill Lane', 'Leeds'], postcode: 'LS1 4AB', releaseDate: '2026-11-10T09:00:00', references: { 'Tenant Reference': 'T-1001', 'Document Type': 'Statement' } }),
    row(2, [1, 2], { addressLines: ['Mr Joe Patel', '3 High Street', 'York'], postcode: 'YO1 7HH', releaseDate: '2026-11-15T09:00:00', references: { 'Tenant Reference': 'T-2040', 'Property Reference': 'T-1001' } }),
    row(3, [3], { addressLines: ['Mr Joe Patel', '3 High Street', 'York'], postcode: 'YO1 7HH', references: { 'Tenant Reference': 'T-1001' } }),
  ];
  app = await buildApp({ settings: new MemorySettingsStore(), customers: new MemoryCustomerStore(), costing: new MemoryCostingStore(), postal: new MemoryPostalStore(), reprice: new MemoryRepriceStore(), recipients: store, reports: new MemoryReportStore() });
});

const get = (qs: string) => app.inject({ method: 'GET', url: `/api/recipients/search?${qs}` });
const packs = async (qs: string): Promise<number[]> => ((await get(qs)).json().rows as { packId: number }[]).map((r) => r.packId);

describe('recipient search: scope', () => {
  it('refuses a search without an account, however specific it is', async () => {
    const r = await get('name=patel');
    expect(r.statusCode).toBe(422);
    expect(r.json().errors.accountId).toMatch(/Choose the account/);
    expect((await get('accountId=abc&name=patel')).statusCode).toBe(422);
    expect((await get('accountId=0&name=patel')).statusCode).toBe(422);
  });
  it('covers the account and everything below it, never other customers', async () => {
    expect(await packs('accountId=1&name=patel')).toEqual([2, 1]); // newest first; the other customer's pack 3 is not found
    expect(await packs('accountId=2&name=patel')).toEqual([2]); // a sub-account sees only itself and below
    expect(await packs('accountId=3&name=patel')).toEqual([3]);
  });
  it('404 for an account that does not exist', async () => {
    expect((await get('accountId=99&name=patel')).statusCode).toBe(404);
  });
  it('lists the accounts that can be chosen', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/recipients/scopes' })).json().rows).toHaveLength(3);
  });
});

describe('recipient search: matching', () => {
  it('needs something to look for', async () => {
    const r = await get('accountId=1');
    expect(r.statusCode).toBe(422);
    expect(r.json().errors.name).toMatch(/Enter a name/);
  });
  it('contains, ignoring case, on the name line only', async () => {
    expect(await packs('accountId=1&name=ATEL')).toEqual([2, 1]);
    expect(await packs('accountId=1&name=high')).toEqual([]); // that is an address line, not a name
  });
  it('contains on address lines and postcode, but not on the name line', async () => {
    expect(await packs('accountId=1&address=mill')).toEqual([1]);
    expect(await packs('accountId=1&address=ls1')).toEqual([1]);
    expect(await packs('accountId=1&address=patel')).toEqual([]);
  });
  it('references match exactly, or by prefix with *, and can be limited to one key', async () => {
    expect(await packs('accountId=1&reference=T-1001')).toEqual([2, 1]); // pack 2 has it under Property Reference
    expect(await packs('accountId=1&reference=T-10')).toEqual([]); // not exact
    expect(await packs('accountId=1&reference=T-10*')).toEqual([2, 1]);
    expect(await packs(`accountId=1&reference=T-1001&referenceKey=${encodeURIComponent('Tenant Reference')}`)).toEqual([1]);
    expect((await get('accountId=1&referenceKey=Tenant')).json().errors.reference).toBeDefined();
  });
  it('date range is inclusive of both days', async () => {
    expect(await packs('accountId=1&name=patel&from=2026-11-15')).toEqual([2]);
    expect(await packs('accountId=1&name=patel&to=2026-11-10')).toEqual([1]);
    expect(await packs('accountId=1&from=2026-11-10&to=2026-11-15')).toEqual([2, 1]);
  });
  it('checks the inputs', async () => {
    expect((await get('accountId=1&name=a')).json().errors.name).toMatch(/at least 2/);
    expect((await get('accountId=1&reference=*')).json().errors.reference).toMatch(/at least 2/);
    expect((await get('accountId=1&from=2026-13-01')).json().errors.from).toBeDefined();
    expect((await get('accountId=1&from=2026-11-10&to=2026-11-01')).json().errors.to).toMatch(/before/);
    expect((await get('accountId=1&name=patel&limit=0')).json().errors.limit).toBeDefined();
    expect((await get('accountId=1&name=patel&limit=501')).json().errors.limit).toBeDefined();
  });
  it('limits the rows and says when there are more', async () => {
    const r = (await get('accountId=1&name=patel&limit=1')).json();
    expect(r.rows).toHaveLength(1);
    expect(r.truncated).toBe(true);
    expect(r.scope).toEqual({ id: 1, label: 'Parent' });
    expect((await get('accountId=1&name=patel&limit=2')).json().truncated).toBe(false);
  });
});

describe('LIKE patterns', () => {
  it('make wildcard characters literal', () => {
    expect(containsPattern('50%_[x]\\')).toBe('%50\\%\\_\\[x]\\\\%');
    expect(referencePattern('AB_1')).toBe('AB\\_1');
    expect(referencePattern('AB%*')).toBe('AB\\%%');
  });
});

describe('mailpiece price', () => {
  const price = { mailpieceId: 7, batchCode: 9007, priced: true, reason: null, pricedAt: '2026-11-18T09:01:00', model: { id: 1, name: '2026 prices' }, packs: 2, colourPages: 1, monoPages: 3, blankPages: 0,
    lines: [{ code: 'HPOD', label: 'H-POD processing', quantity: 1, unitCost: 0.1, unitSell: 0.2, cost: 0.1, sell: 0.2 }],
    productionCost: 0.1, productionSell: 0.2, postageCost: 0.6, postageSell: 0.65, totalCost: 0.7, totalSell: 0.85, warnings: null };
  it('returns the lines and totals of a mailpiece', async () => {
    store.prices.set(7, price);
    const r = await app.inject({ method: 'GET', url: '/api/mailpieces/7/price' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ mailpieceId: 7, priced: true, totalSell: 0.85, lines: [{ code: 'HPOD', sell: 0.2 }] });
  });
  it('says why a mailpiece has no price', async () => {
    store.prices.set(8, { ...price, mailpieceId: 8, priced: false, reason: 'No costing model was in force for this customer on 2026-11-18.', pricedAt: null, model: null, lines: [], productionSell: 0, productionCost: 0, postageCost: 0, postageSell: 0, totalCost: 0, totalSell: 0 });
    expect((await app.inject({ method: 'GET', url: '/api/mailpieces/8/price' })).json()).toMatchObject({ priced: false, reason: expect.stringMatching(/No costing model/) });
  });
  it('404 for a mailpiece that does not exist or an id that is not a number', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/mailpieces/99/price' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/mailpieces/abc/price' })).statusCode).toBe(404);
  });
});
