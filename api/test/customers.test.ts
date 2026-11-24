import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { MemoryReportStore } from '../src/reports/memoryStore.js';
import { MemoryReferenceStore } from '../src/reference/memoryStore.js';
import { MemoryRecipientStore } from '../src/recipients/memoryStore.js';
import { MemoryCustomerStore } from '../src/customers/memoryStore.js';
import { MemoryRepriceStore } from '../src/reprice/memoryStore.js';
import { MemoryPostalStore } from '../src/postal/memoryStore.js';
import { MemoryCostingStore } from '../src/costing/memoryStore.js';
import { FLAGS } from '../src/customers/types.js';
import { MemorySettingsStore } from '../src/settings/store.js';

let app: FastifyInstance;
let store: MemoryCustomerStore;
let acme: number;
const flags = (over: Record<string, boolean> = {}) => ({ ...Object.fromEntries(FLAGS.map((f) => [f, false])), ...over });
const details = (over: Record<string, unknown> = {}) => ({ code: 'ACME', name: 'Acme Ltd', misJobNumber: null, pendingJobNumber: null, jobNumberRolloverDay: 1, invoicingAccountId: null, returnAddress: null, colourMode: 'ORIGINAL', batchingKey: null, packSequenceKey: null, parentId: null, flags: flags(), ...over });
const env = (over: Record<string, unknown> = {}) => ({ brandId: null, deliveryBand: '2nd Class', postalRateId: 1, stockItemId: 10, reference: null, externalName: null, isOversticker: false, ...over });

beforeEach(async () => {
  store = new MemoryCustomerStore();
  acme = store.seed({ code: 'ACME', name: 'Acme Ltd' });
  store.seed({ code: 'NWB', name: 'Northwest Bank', misJobNumber: '24102' });
  app = await buildApp({ settings: new MemorySettingsStore(), customers: store, costing: new MemoryCostingStore(), postal: new MemoryPostalStore(), reprice: new MemoryRepriceStore(), recipients: new MemoryRecipientStore(), reports: new MemoryReportStore(), reference: new MemoryReferenceStore() });
});

const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as object });

describe('list and search', () => {
  it('lists customers by name and searches code, name and job number', async () => {
    expect((await call('GET', '/api/customers')).json().rows.map((r: { code: string }) => r.code)).toEqual(['ACME', 'NWB']);
    expect((await call('GET', '/api/customers?search=24102')).json().rows).toHaveLength(1);
    expect((await call('GET', '/api/customers?search=acme')).json().rows[0].code).toBe('ACME');
  });
  it('hides deleted customers unless asked', async () => {
    await call('PUT', `/api/customers/${acme}`, details({ flags: flags({ isDeleted: true }) }));
    expect((await call('GET', '/api/customers')).json().rows).toHaveLength(1);
    expect((await call('GET', '/api/customers?deleted=1')).json().rows).toHaveLength(2);
  });
});

describe('create and edit details', () => {
  it('creates a customer and refuses a duplicate code, ignoring case', async () => {
    const ok = await call('POST', '/api/customers', { code: 'NEW1', name: 'New Co' });
    expect(ok.statusCode).toBe(201);
    const dup = await call('POST', '/api/customers', { code: 'new1', name: 'Other' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toMatch(/already in use/);
  });
  it('needs a code and a name', async () => {
    const r = await call('POST', '/api/customers', { code: ' ', name: '' });
    expect(r.statusCode).toBe(422);
    expect(Object.keys(r.json().errors)).toEqual(['code', 'name']);
  });
  it('saves details and flags, and keeps the key names', async () => {
    const r = await call('PUT', `/api/customers/${acme}`, details({ misJobNumber: '555', returnAddress: 'PO Box 1', batchingKey: 'Department', flags: flags({ isAddressMatching: true }) }));
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ misJobNumber: '555', batchingKey: 'Department', flags: { isAddressMatching: true } });
  });
  it('saves the archive tags and logos, refuses a logo longer than 8 characters, and writes them to the history', async () => {
    const bad = await call('PUT', `/api/customers/${acme}`, details({ logo1: 'TOOLONGNAME' }));
    expect(bad.statusCode).toBe(422);
    expect(bad.json().errors.logo1).toBeDefined();
    const r = await call('PUT', `/api/customers/${acme}`, details({ archiveCustomerTag: 'ACME', archiveProviderTag: 'IRON', archiveDirectoryTag: 'acme/dir', logo1: 'LOGO1', logo2: ' ' }));
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ archiveCustomerTag: 'ACME', archiveProviderTag: 'IRON', archiveDirectoryTag: 'acme/dir', logo1: 'LOGO1', logo2: null });
    const h = await call('GET', `/api/customers/${acme}/history`);
    expect(JSON.stringify(h.json())).toContain('Archive customer tag: (none) → \\"ACME\\"');
  });
  it('saves the colour mode, refuses an unknown one, and writes it to the history', async () => {
    const bad = await call('PUT', `/api/customers/${acme}`, details({ colourMode: 'RAINBOW' }));
    expect(bad.statusCode).toBe(422);
    expect(bad.json().errors.colourMode).toBeDefined();
    const r = await call('PUT', `/api/customers/${acme}`, details({ colourMode: 'ALL_MONO' }));
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ colourMode: 'ALL_MONO' });
    const rows = (await call('GET', `/api/customers/${acme}/history`)).json().rows as { summary: string }[];
    expect(rows.map((x) => x.summary)).toEqual(['Colour mode: No change (as in the PDF) → All mono']);
  });
  it('rejects a missing flag and over-long text', async () => {
    const r = await call('PUT', `/api/customers/${acme}`, details({ name: 'x'.repeat(201), flags: {} }));
    expect(r.statusCode).toBe(422);
    expect(r.json().errors.name).toMatch(/200/);
    expect(r.json().errors['flags.isAddressMatching']).toBeDefined();
  });
  it('writes one history line per change and none when nothing changed', async () => {
    await call('PUT', `/api/customers/${acme}`, details({ name: 'Acme Energy', flags: flags({ isAddressMatching: true }) }));
    await call('PUT', `/api/customers/${acme}`, details({ name: 'Acme Energy', flags: flags({ isAddressMatching: true }) }));
    const rows = (await call('GET', `/api/customers/${acme}/history`)).json().rows as { summary: string }[];
    expect(rows.map((r) => r.summary)).toEqual(['Address matching: off → on', 'Name: "Acme Ltd" → "Acme Energy"']);
  });
  it('404s for an unknown or malformed id', async () => {
    expect((await call('GET', '/api/customers/9999')).statusCode).toBe(404);
    expect((await call('GET', '/api/customers/abc')).statusCode).toBe(404);
  });
});

describe('pending job number', () => {
  it('starts on the 1st of next month and appears in the list, the detail and the history', async () => {
    store.today = () => '2026-11-21';
    const r = await call('PUT', `/api/customers/${acme}`, details({ misJobNumber: '24518', pendingJobNumber: '24601' }));
    expect(r.json()).toMatchObject({ misJobNumber: '24518', pendingJobNumber: '24601', pendingFrom: '2026-12-01' });
    expect((await call('GET', '/api/customers')).json().rows.find((x: { id: number }) => x.id === acme)).toMatchObject({ misJobNumber: '24518', pendingJobNumber: '24601' });
    expect((await call('GET', `/api/customers/${acme}/history`)).json().rows[0].summary).toBe('Pending job number: (none) → "24601" (takes effect 2026-12-01)');
    expect((await call('GET', '/api/customers?search=24601')).json().rows).toHaveLength(1);
  });
  it('says in the list whether a customer uses MRDF', async () => {
    const mrdf = async () => (await call('GET', '/api/customers')).json().rows.find((x: { id: number }) => x.id === acme).isUseMrdf;
    expect(await mrdf()).toBe(false);
    await call('PUT', `/api/customers/${acme}`, details({ flags: flags({ isUseMrdf: true }) }));
    expect(await mrdf()).toBe(true);
  });
  it('says in the list whether a customer uses SSO, and calls the flag Uses SSO', async () => {
    const sso = async () => (await call('GET', '/api/customers')).json().rows.find((x: { id: number }) => x.id === acme).isSso;
    expect(await sso()).toBe(false);
    await call('PUT', `/api/customers/${acme}`, details({ flags: flags({ isSso: true }) }));
    expect(await sso()).toBe(true);
    expect((await call('GET', `/api/customers/${acme}/history`)).json().rows[0].summary).toBe('Uses SSO: off → on');
  });
  it('rolls over the year in December', async () => {
    store.today = () => '2026-12-15';
    expect((await call('PUT', `/api/customers/${acme}`, details({ pendingJobNumber: '25001' }))).json().pendingFrom).toBe('2027-01-01');
  });
  it('keeps the original start date when the pending number is left alone, and restarts it when changed', async () => {
    store.today = () => '2026-11-05';
    await call('PUT', `/api/customers/${acme}`, details({ pendingJobNumber: '111' }));
    store.today = () => '2026-11-28';
    expect((await call('PUT', `/api/customers/${acme}`, details({ name: 'Renamed', pendingJobNumber: '111' }))).json().pendingFrom).toBe('2026-12-01');
    store.today = () => '2026-12-02'; // the 1st has passed without a rollover running; a changed number now waits for January
    expect((await call('PUT', `/api/customers/${acme}`, details({ pendingJobNumber: '222' }))).json().pendingFrom).toBe('2027-01-01');
  });
  it('can be cancelled', async () => {
    await call('PUT', `/api/customers/${acme}`, details({ pendingJobNumber: '111' }));
    const r = await call('PUT', `/api/customers/${acme}`, details({ pendingJobNumber: null }));
    expect(r.json()).toMatchObject({ pendingJobNumber: null, pendingFrom: null });
  });
  it('must be stated, so a client cannot cancel it by leaving it out', async () => {
    const { pendingJobNumber: _omit, ...rest } = details();
    expect((await call('PUT', `/api/customers/${acme}`, rest)).json().errors.pendingJobNumber).toMatch(/must be given/);
  });
  it('moves into the job number on its date, clears itself, and is recorded', async () => {
    store.today = () => '2026-11-21';
    await call('PUT', `/api/customers/${acme}`, details({ misJobNumber: '24518', pendingJobNumber: '24601' }));
    store.today = () => '2026-11-30';
    expect(await store.applyDuePending()).toBe(0);
    store.today = () => '2026-12-01';
    expect(await store.applyDuePending()).toBe(1);
    expect(await store.applyDuePending()).toBe(0);
    expect((await call('GET', `/api/customers/${acme}`)).json()).toMatchObject({ misJobNumber: '24601', pendingJobNumber: null, pendingFrom: null });
    expect((await call('GET', `/api/customers/${acme}/history`)).json().rows[0]).toMatchObject({ changedBy: 'system', summary: 'Job number: "24518" → "24601" (the pending job number took effect)' });
  });
});

describe('job number rollover day', () => {
  it('a customer that rolls over on the 21st starts a pending number on the next 21st', async () => {
    store.today = () => '2026-11-10';
    expect((await call('PUT', `/api/customers/${acme}`, details({ pendingJobNumber: '5', jobNumberRolloverDay: 21 }))).json()).toMatchObject({ jobNumberRolloverDay: 21, pendingFrom: '2026-11-21' });
    store.today = () => '2026-11-21'; // on the day itself the number set today waits for next month
    expect((await call('PUT', `/api/customers/${acme}`, details({ pendingJobNumber: '6', jobNumberRolloverDay: 21 }))).json().pendingFrom).toBe('2026-12-21');
    store.today = () => '2026-12-22';
    expect((await call('PUT', `/api/customers/${acme}`, details({ pendingJobNumber: '7', jobNumberRolloverDay: 21 }))).json().pendingFrom).toBe('2027-01-21');
  });
  it('changing the day moves the start date of a pending number; other customers keep the 1st', async () => {
    store.today = () => '2026-11-10';
    await call('PUT', `/api/customers/${acme}`, details({ pendingJobNumber: '5' }));
    expect((await call('GET', `/api/customers/${acme}`)).json().pendingFrom).toBe('2026-12-01');
    expect((await call('PUT', `/api/customers/${acme}`, details({ pendingJobNumber: '5', jobNumberRolloverDay: 21 }))).json().pendingFrom).toBe('2026-11-21');
    expect((await call('GET', `/api/customers/${acme}/history`)).json().rows[0].summary).toBe('Job number rollover day: 1 → 21');
  });
  it('moves on the rollover day, not on the 1st', async () => {
    store.today = () => '2026-11-10';
    await call('PUT', `/api/customers/${acme}`, details({ misJobNumber: '1', pendingJobNumber: '2', jobNumberRolloverDay: 21 }));
    store.today = () => '2026-11-20';
    expect(await store.applyDuePending()).toBe(0);
    store.today = () => '2026-11-21';
    expect(await store.applyDuePending()).toBe(1);
    expect((await call('GET', `/api/customers/${acme}`)).json()).toMatchObject({ misJobNumber: '2', pendingJobNumber: null });
  });
  it('accepts 1 to 28 only, and must be given', async () => {
    for (const bad of [0, 29, 1.5, '21', null]) expect((await call('PUT', `/api/customers/${acme}`, details({ jobNumberRolloverDay: bad }))).json().errors.jobNumberRolloverDay).toMatch(/1 to 28/);
    expect((await call('PUT', `/api/customers/${acme}`, details({ jobNumberRolloverDay: 28 }))).statusCode).toBe(200);
  });
});

describe('hierarchy', () => {
  it('sets a parent, lists the child under it, and shows both in the list and detail', async () => {
    const child = (await call('POST', '/api/customers', { code: 'CHILD', name: 'Child Co' })).json().id;
    const r = await call('PUT', `/api/customers/${child}`, details({ code: 'CHILD', name: 'Child Co', parentId: acme }));
    expect(r.statusCode).toBe(200);
    expect(r.json().parent).toEqual({ id: acme, code: 'ACME', name: 'Acme Ltd' });
    expect((await call('GET', `/api/customers/${acme}`)).json().children).toEqual([{ id: child, code: 'CHILD', name: 'Child Co', isDeleted: false }]);
    const row = (await call('GET', '/api/customers')).json().rows.find((x: { id: number }) => x.id === child);
    expect(row).toMatchObject({ parentId: acme, parentCode: 'ACME' });
    expect((await call('GET', `/api/customers/${child}/history`)).json().rows[0].summary).toBe('Parent: (none) → "ACME"');
  });
  it('can clear a parent again', async () => {
    const child = (await call('POST', '/api/customers', { code: 'CHILD', name: 'Child Co' })).json().id;
    await call('PUT', `/api/customers/${child}`, details({ code: 'CHILD', name: 'Child Co', parentId: acme }));
    const r = await call('PUT', `/api/customers/${child}`, details({ code: 'CHILD', name: 'Child Co', parentId: null }));
    expect(r.json().parent).toBeNull();
  });
  it('refuses itself, an unknown customer, and a loop through its own descendants', async () => {
    const child = (await call('POST', '/api/customers', { code: 'CHILD', name: 'Child Co' })).json().id;
    const grand = (await call('POST', '/api/customers', { code: 'GRAND', name: 'Grand Co' })).json().id;
    await call('PUT', `/api/customers/${child}`, details({ code: 'CHILD', name: 'Child Co', parentId: acme }));
    await call('PUT', `/api/customers/${grand}`, details({ code: 'GRAND', name: 'Grand Co', parentId: child }));
    expect((await call('PUT', `/api/customers/${acme}`, details({ parentId: acme }))).json().errors.parentId).toMatch(/own parent/);
    expect((await call('PUT', `/api/customers/${acme}`, details({ parentId: 9999 }))).json().errors.parentId).toMatch(/not found/);
    expect((await call('PUT', `/api/customers/${acme}`, details({ parentId: grand }))).json().errors.parentId).toMatch(/below this one/);
  });
  it('needs the parent to be stated, so a client cannot clear it by leaving it out', async () => {
    const { parentId: _omit, ...rest } = details();
    expect((await call('PUT', `/api/customers/${acme}`, rest)).json().errors.parentId).toMatch(/must be given/);
  });
  it('offers customers to choose as a parent', async () => {
    expect((await call('GET', '/api/customers/lookups')).json().customers.map((c: { code: string }) => c.code)).toEqual(['ACME', 'NWB']);
  });
});

describe('accounts', () => {
  it('adds, renames and removes a sub-account, and its code must be unique across all accounts', async () => {
    const add = await call('POST', `/api/customers/${acme}/accounts`, { code: 'ACME-2', name: 'Second' });
    expect(add.statusCode).toBe(201);
    expect((await call('POST', `/api/customers/${acme}/accounts`, { code: 'NWB', name: 'Clash with a customer' })).statusCode).toBe(409);
    const id = add.json().id;
    expect((await call('PUT', `/api/accounts/${id}`, { code: 'ACME-2', name: 'Renamed', isDeleted: false })).statusCode).toBe(204);
    expect((await call('PUT', `/api/accounts/${id}`, { code: 'ACME-2', name: 'Renamed', isDeleted: true })).statusCode).toBe(204);
    expect((await call('GET', `/api/customers/${acme}`)).json().accounts).toEqual([{ id, code: 'ACME-2', name: 'Renamed', isDeleted: true }]);
  });
});

describe('brands', () => {
  it('adds, renames, and refuses duplicates', async () => {
    const id = (await call('POST', `/api/customers/${acme}/brands`, { name: 'Home' })).json().id;
    expect((await call('POST', `/api/customers/${acme}/brands`, { name: 'home' })).statusCode).toBe(409);
    expect((await call('PUT', `/api/brands/${id}`, { name: 'Business' })).statusCode).toBe(204);
    expect((await call('GET', `/api/customers/${acme}`)).json().brands).toEqual([{ id, name: 'Business', usage: 0 }]);
  });
  it('will not delete a brand that an envelope uses, and deletes it once that is removed', async () => {
    const b = (await call('POST', `/api/customers/${acme}/brands`, { name: 'Home' })).json().id;
    const e = (await call('POST', `/api/customers/${acme}/envelopes`, env({ brandId: b }))).json().id;
    const blocked = await call('DELETE', `/api/brands/${b}`);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toMatch(/1 envelope setting\./);
    await call('DELETE', `/api/envelopes/${e}`);
    expect((await call('DELETE', `/api/brands/${b}`)).statusCode).toBe(204);
  });
});

describe('envelopes', () => {
  it('adds an envelope with readable labels', async () => {
    const b = (await call('POST', `/api/customers/${acme}/brands`, { name: 'Home' })).json().id;
    expect((await call('POST', `/api/customers/${acme}/envelopes`, env({ brandId: b, reference: 'R1', isOversticker: true }))).statusCode).toBe(201);
    const [e] = (await call('GET', `/api/customers/${acme}`)).json().envelopes;
    expect(e).toMatchObject({ brandName: 'Home', deliveryBand: '2nd Class', stockCode: 'WH0101', reference: 'R1', isOversticker: true });
    expect(e.rateLabel).toContain('2nd Class');
  });
  it('refuses the same brand, band, service and reference twice, but allows another reference', async () => {
    await call('POST', `/api/customers/${acme}/envelopes`, env());
    expect((await call('POST', `/api/customers/${acme}/envelopes`, env())).statusCode).toBe(409);
    expect((await call('POST', `/api/customers/${acme}/envelopes`, env({ reference: 'X' }))).statusCode).toBe(201);
  });
  it('lets a removed setting be added again', async () => {
    const id = (await call('POST', `/api/customers/${acme}/envelopes`, env())).json().id;
    await call('DELETE', `/api/envelopes/${id}`);
    expect((await call('POST', `/api/customers/${acme}/envelopes`, env())).statusCode).toBe(201);
  });
  it('rejects another customer’s brand, unknown rates and incomplete input', async () => {
    const other = (await call('POST', '/api/customers', { code: 'O', name: 'Other' })).json().id;
    const foreign = (await call('POST', `/api/customers/${other}/brands`, { name: 'Theirs' })).json().id;
    expect((await call('POST', `/api/customers/${acme}/envelopes`, env({ brandId: foreign }))).json().errors.brandId).toBeDefined();
    expect((await call('POST', `/api/customers/${acme}/envelopes`, env({ postalRateId: 999 }))).json().errors.postalRateId).toBeDefined();
    const bad = await call('POST', `/api/customers/${acme}/envelopes`, { deliveryBand: '' });
    expect(Object.keys(bad.json().errors)).toEqual(expect.arrayContaining(['deliveryBand', 'postalRateId', 'stockItemId', 'isOversticker']));
  });
  it('updates an envelope', async () => {
    const id = (await call('POST', `/api/customers/${acme}/envelopes`, env())).json().id;
    expect((await call('PUT', `/api/envelopes/${id}`, env({ deliveryBand: '1st Class', postalRateId: 2 }))).statusCode).toBe(204);
    expect((await call('GET', `/api/customers/${acme}`)).json().envelopes[0]).toMatchObject({ deliveryBand: '1st Class', postalRateId: 2 });
    expect((await call('PUT', '/api/envelopes/9999', env())).statusCode).toBe(404);
  });
});

describe('matching, sequence and notification lists', () => {
  it('replaces the address-matching rules; an exclude rule needs a value and an include rule drops its value', async () => {
    expect((await call('PUT', `/api/customers/${acme}/match-rules`, { rules: [{ isInclude: false, key: 'Doc Type', value: '' }] })).json().errors['rules.0']).toMatch(/needs the value/);
    expect((await call('PUT', `/api/customers/${acme}/match-rules`, { rules: [{ isInclude: true, key: 'Department', value: 'ignored' }, { isInclude: false, key: 'Doc Type', value: 'Final Demand' }] })).statusCode).toBe(204);
    expect((await call('GET', `/api/customers/${acme}`)).json().matchRules).toEqual([{ isInclude: true, key: 'Department', value: null }, { isInclude: false, key: 'Doc Type', value: 'Final Demand' }]);
  });
  it('replaces the pack sequence, and refuses a repeated value or a position below 1', async () => {
    expect((await call('PUT', `/api/customers/${acme}/sequence-rules`, { rules: [{ value: 'Bill', number: 1 }, { value: 'bill', number: 2 }] })).json().errors['rules.1']).toMatch(/twice/);
    expect((await call('PUT', `/api/customers/${acme}/sequence-rules`, { rules: [{ value: 'Bill', number: 0 }] })).statusCode).toBe(422);
    expect((await call('PUT', `/api/customers/${acme}/sequence-rules`, { rules: [{ value: 'Bill', number: 1 }, { value: 'Arrears', number: 2 }] })).statusCode).toBe(204);
    const hist = (await call('GET', `/api/customers/${acme}/history`)).json().rows[0].summary;
    expect(hist).toBe('Pack sequence: none → 1. Bill; 2. Arrears');
  });
  it('stores a clean, de-duplicated list of e-mail addresses', async () => {
    expect((await call('PUT', `/api/customers/${acme}/emails`, { emails: ['a@x.com; B@x.com', 'a@X.com'] })).statusCode).toBe(204);
    expect((await call('GET', `/api/customers/${acme}`)).json().emails).toEqual(['a@x.com', 'B@x.com']);
    const bad = await call('PUT', `/api/customers/${acme}/emails`, { emails: ['nope'] });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().errors.emails).toContain('nope');
  });
});

describe('lookups', () => {
  it('returns the lists the forms need, and is not mistaken for a customer id', async () => {
    const r = (await call('GET', '/api/customers/lookups')).json();
    expect(r.postalRates.length).toBeGreaterThan(0);
    expect(r.envelopeStock.length).toBeGreaterThan(0);
    expect(r.flagLabels.isAddressMatching).toBe('Address matching');
  });
});

describe('invoicing account', () => {
  it('defaults to the customer itself and offers the customer and its parents', async () => {
    const child = store.seed({ code: 'CHILD', name: 'Child Co', parentId: acme });
    const d = (await call('GET', `/api/customers/${child}`)).json();
    expect(d.invoicing).toBeNull();
    expect(d.invoicingOptions.map((o: { code: string }) => o.code)).toEqual(['CHILD', 'ACME']);
  });
  it('can be set to a parent, is written to the history, and can be cleared', async () => {
    const child = store.seed({ code: 'CHILD', name: 'Child Co', parentId: acme });
    const r = await call('PUT', `/api/customers/${child}`, details({ code: 'CHILD', name: 'Child Co', parentId: acme, invoicingAccountId: acme }));
    expect(r.json().invoicing).toMatchObject({ id: acme, code: 'ACME' });
    expect((await call('GET', `/api/customers/${child}/history`)).json().rows[0].summary).toBe('Invoicing account: (none) → "ACME"');
    const cleared = await call('PUT', `/api/customers/${child}`, details({ code: 'CHILD', name: 'Child Co', parentId: acme, invoicingAccountId: null }));
    expect(cleared.json().invoicing).toBeNull();
  });
  it('refuses an account that is neither the customer nor one of its parents', async () => {
    const child = store.seed({ code: 'CHILD', name: 'Child Co', parentId: acme });
    const other = store.seed({ code: 'OTHER', name: 'Other' });
    const r = await call('PUT', `/api/customers/${child}`, details({ code: 'CHILD', name: 'Child Co', parentId: acme, invoicingAccountId: other }));
    expect(r.statusCode).toBe(422);
    expect(r.json().errors.invoicingAccountId).toMatch(/this customer or one of its parents/);
  });
  it('refuses a move that would leave the invoicing account out of the parent chain', async () => {
    const child = store.seed({ code: 'CHILD', name: 'Child Co', parentId: acme, invoicingAccountId: acme });
    const r = await call('PUT', `/api/customers/${child}`, details({ code: 'CHILD', name: 'Child Co', parentId: null, invoicingAccountId: acme }));
    expect(r.statusCode).toBe(422);
  });
  it('must be given explicitly, so leaving it out cannot clear it', async () => {
    const { invoicingAccountId: _omit, ...without } = details();
    void _omit;
    const r = await call('PUT', `/api/customers/${acme}`, without);
    expect(r.statusCode).toBe(422);
    expect(r.json().errors.invoicingAccountId).toBeDefined();
  });
});

describe('envelope inheritance', () => {
  let child: number;
  beforeEach(async () => {
    child = store.seed({ code: 'CHILD', name: 'Child Co', parentId: acme });
    await call('POST', `/api/customers/${acme}/envelopes`, env({ deliveryBand: '1st Class' }));
    await call('POST', `/api/customers/${acme}/envelopes`, env({ deliveryBand: '2nd Class' }));
  });
  const mode = (id: number, m: string, setting = 'envelopes') => call('PUT', `/api/customers/${id}/inheritance`, { setting, mode: m });
  const detail = async (id: number) => (await call('GET', `/api/customers/${id}`)).json();

  it('a customer starts with its own list and nothing inherited', async () => {
    const d = await detail(child);
    expect(d.modes.envelopes).toBe('OWN');
    expect(d.inheritedEnvelopes).toEqual([]);
  });
  it('INHERIT shows the parent list, read only, with where it comes from', async () => {
    expect((await mode(child, 'INHERIT')).statusCode).toBe(204);
    const d = await detail(child);
    expect(d.envelopes).toEqual([]);
    expect(d.inheritedEnvelopes.map((e: { deliveryBand: string }) => e.deliveryBand).sort()).toEqual(['1st Class', '2nd Class']);
    expect(d.inheritedEnvelopes[0].from).toMatchObject({ id: acme, code: 'ACME' });
    expect((await call('GET', `/api/customers/${child}/history`)).json().rows[0].summary).toBe("Envelopes: its own list → the parent's list");
  });
  it('EXTEND adds the customer’s own settings to the parent list', async () => {
    await mode(child, 'EXTEND');
    await call('POST', `/api/customers/${child}/envelopes`, env({ deliveryBand: '1st Class', reference: 'Planning' }));
    const d = await detail(child);
    expect(d.envelopes).toHaveLength(1);
    expect(d.inheritedEnvelopes).toHaveLength(2);
  });
  it('an own setting with the same brand, band, service and reference replaces the parent’s', async () => {
    await mode(child, 'EXTEND');
    await call('POST', `/api/customers/${child}/envelopes`, env({ deliveryBand: '1st Class' }));
    const d = await detail(child);
    expect(d.inheritedEnvelopes.map((e: { deliveryBand: string }) => e.deliveryBand)).toEqual(['2nd Class']);
  });
  it('passes through several levels', async () => {
    const grand = store.seed({ code: 'GRAND', name: 'Grandchild', parentId: child });
    await mode(child, 'INHERIT');
    await mode(grand, 'INHERIT');
    const d = await detail(grand);
    expect(d.inheritedEnvelopes).toHaveLength(2);
    expect(d.inheritedEnvelopes[0].from.code).toBe('ACME');
  });
  it('needs a parent', async () => {
    const r = await mode(acme, 'INHERIT');
    expect(r.statusCode).toBe(422);
    expect(r.json().errors.mode).toMatch(/no parent/);
    expect((await mode(acme, 'OWN')).statusCode).toBe(204);
    expect((await mode(child, 'INHERIT', 'colours')).statusCode).toBe(422);
    expect((await mode(child, 'SOMETIMES')).statusCode).toBe(422);
  });
  it('goes back to its own list when the parent is removed, and says so in the history', async () => {
    await mode(child, 'INHERIT');
    await call('PUT', `/api/customers/${child}`, details({ code: 'CHILD', name: 'Child Co', parentId: null }));
    expect((await detail(child)).modes.envelopes).toBe('OWN');
    expect((await call('GET', `/api/customers/${child}/history`)).json().rows[0].summary).toBe("Envelopes: the parent's list → its own list");
  });
});

describe('customer to sub-account and back', () => {
  let child: number;
  beforeEach(async () => {
    child = store.seed({ code: 'CHILD', name: 'Child Co', parentId: acme });
    await call('POST', `/api/customers/${child}/brands`, { name: 'Own brand' });
    await call('POST', `/api/customers/${child}/accounts`, { code: 'CH-1', name: 'Child account' });
  });
  const detail = async (id: number) => (await call('GET', `/api/customers/${id}`)).json();

  it('needs a parent', async () => {
    const r = await call('POST', `/api/customers/${acme}/make-sub-account`);
    expect(r.statusCode).toBe(422);
    expect(r.json().errors.parentId).toMatch(/parent customer/);
    expect((await call('POST', '/api/customers/99999/make-sub-account')).statusCode).toBe(404);
  });
  it('is refused while customers are placed under it', async () => {
    store.seed({ code: 'KID1', name: 'Kid One', parentId: child });
    const r = await call('POST', `/api/customers/${child}/make-sub-account`);
    expect(r.statusCode).toBe(422);
    expect(r.json().errors.parentId).toMatch(/1 customer is placed under this one \(Kid One\)/);
    expect((await detail(child)).code).toBe('CHILD'); // still a customer
  });
  it('makes the customer one of the parent’s accounts and takes its own accounts along', async () => {
    expect((await call('POST', `/api/customers/${child}/make-sub-account`)).statusCode).toBe(204);
    expect((await call('GET', `/api/customers/${child}`)).statusCode).toBe(404); // no longer a customer of its own
    expect((await call('GET', '/api/customers')).json().rows.map((r: { code: string }) => r.code)).not.toContain('CHILD');
    expect((await detail(acme)).accounts.map((a: { code: string }) => a.code).sort()).toEqual(['CH-1', 'CHILD']);
  });
  it('says so in the history of both', async () => {
    await call('POST', `/api/customers/${child}/make-sub-account`);
    expect((await call('GET', `/api/customers/${child}/history`)).json().rows[0].summary).toBe('Became a sub-account of ACME: settings now come from ACME');
    expect((await call('GET', `/api/customers/${acme}/history`)).json().rows[0].summary).toBe('Account CHILD "Child Co" became a sub-account of this customer');
  });
  it('can be undone: the customer comes back with its own settings and its own accounts', async () => {
    await call('POST', `/api/customers/${child}/make-sub-account`);
    expect((await call('POST', `/api/accounts/${child}/make-customer`)).statusCode).toBe(204);
    const d = await detail(child);
    expect(d.parent).toMatchObject({ id: acme });
    expect(d.brands.map((b: { name: string }) => b.name)).toEqual(['Own brand']);
    expect(d.accounts.map((a: { code: string }) => a.code)).toEqual(['CH-1']);
    expect((await detail(acme)).accounts).toEqual([]);
    expect((await call('GET', `/api/customers/${child}/history`)).json().rows[0].summary).toBe('Account CHILD "Child Co" now holds its own settings, as a customer');
  });
  it('an account that was always a sub-account can be given its own settings', async () => {
    const a = (await call('POST', `/api/customers/${acme}/accounts`, { code: 'AC-1', name: 'Acme one' })).json().id;
    expect((await call('POST', `/api/accounts/${a}/make-customer`)).statusCode).toBe(204);
    expect(await detail(a)).toMatchObject({ code: 'AC-1', name: 'Acme one', parent: { id: acme }, brands: [] });
    expect((await call('POST', '/api/accounts/99999/make-customer')).statusCode).toBe(404);
    expect((await call('POST', `/api/accounts/${acme}/make-customer`)).statusCode).toBe(404); // a customer is not an account
  });
});

describe('inheritance of brands, matching, pack sequence and notification e-mails', () => {
  let child: number; let grand: number;
  const mode = (id: number, setting: string, m: string) => call('PUT', `/api/customers/${id}/inheritance`, { setting, mode: m });
  const detail = async (id: number) => (await call('GET', `/api/customers/${id}`)).json();
  beforeEach(async () => {
    child = store.seed({ code: 'CHILD', name: 'Child Co', parentId: acme });
    grand = store.seed({ code: 'GRAND', name: 'Grand Co', parentId: child });
    await call('POST', `/api/customers/${acme}/brands`, { name: 'Home' });
    await call('POST', `/api/customers/${acme}/brands`, { name: 'Business' });
    await call('PUT', `/api/customers/${acme}/match-rules`, { rules: [{ isInclude: true, key: 'Department', value: null }, { isInclude: false, key: 'Doc Type', value: 'Final Demand' }] });
    await call('PUT', `/api/customers/${acme}/sequence-rules`, { rules: [{ value: 'Bill', number: 1 }, { value: 'Reminder', number: 2 }] });
    await call('PUT', `/api/customers/${acme}/emails`, { emails: ['print@acme.example', 'ops@acme.example'] });
    await call('PUT', `/api/customers/${acme}`, details({ batchingKey: 'Department', packSequenceKey: 'Doc Type', flags: flags({ isAddressMatching: true }) }));
  });

  it('every group starts on its own list with nothing inherited', async () => {
    const d = await detail(child);
    expect(d.modes).toEqual({ envelopes: 'OWN', brands: 'OWN', matching: 'OWN', sequence: 'OWN', emails: 'OWN' });
    expect(d.inherited).toEqual({ brands: [], matchRules: [], sequenceRules: [], emails: [], matching: null, sequence: null });
  });
  it('INHERIT shows the parent’s brands, rules and addresses read only, with where each comes from', async () => {
    for (const g of ['brands', 'matching', 'sequence', 'emails']) expect((await mode(child, g, 'INHERIT')).statusCode).toBe(204);
    const d = await detail(child);
    expect(d.brands).toEqual([]);
    expect(d.inherited.brands.map((b: { name: string }) => b.name).sort()).toEqual(['Business', 'Home']);
    expect(d.inherited.brands[0].from).toMatchObject({ id: acme, code: 'ACME' });
    expect(d.inherited.matchRules).toHaveLength(2);
    expect(d.inherited.sequenceRules.map((r: { value: string }) => r.value)).toEqual(['Bill', 'Reminder']);
    expect(d.inherited.emails.map((e: { email: string }) => e.email).sort()).toEqual(['ops@acme.example', 'print@acme.example']);
    expect(d.inherited.matching).toMatchObject({ isAddressMatching: true, batchingKey: 'Department', from: { code: 'ACME' } });
    expect(d.inherited.sequence).toMatchObject({ key: 'Doc Type', from: { code: 'ACME' } });
  });
  it('EXTEND adds to the parent’s list, a nearer entry with the same key replaces the parent’s, and the single values stay its own', async () => {
    for (const g of ['brands', 'matching', 'sequence', 'emails']) await mode(child, g, 'EXTEND');
    await call('POST', `/api/customers/${child}/brands`, { name: 'home' });                        // same name as the parent's Home, other case
    await call('POST', `/api/customers/${child}/brands`, { name: 'Extra' });
    await call('PUT', `/api/customers/${child}/sequence-rules`, { rules: [{ value: 'Reminder', number: 5 }] });
    await call('PUT', `/api/customers/${child}/emails`, { emails: ['PRINT@acme.example'] });
    await call('PUT', `/api/customers/${child}/match-rules`, { rules: [{ isInclude: true, key: 'Department', value: null }] });
    const d = await detail(child);
    expect(d.inherited.brands.map((b: { name: string }) => b.name)).toEqual(['Business']);
    expect(d.inherited.sequenceRules.map((r: { value: string }) => r.value)).toEqual(['Bill']);
    expect(d.inherited.emails.map((e: { email: string }) => e.email)).toEqual(['ops@acme.example']);
    expect(d.inherited.matchRules).toEqual([expect.objectContaining({ isInclude: false, key: 'Doc Type' })]);
    expect(d.inherited.matching).toBeNull(); expect(d.inherited.sequence).toBeNull();
  });
  it('passes through several levels, taking the single values from the nearest source', async () => {
    await mode(child, 'matching', 'INHERIT'); await mode(grand, 'matching', 'INHERIT');
    await call('PUT', `/api/customers/${child}`, details({ code: 'CHILD', name: 'Child Co', parentId: acme, batchingKey: 'Own key' }));
    const d = await detail(grand);
    expect(d.inherited.matching).toMatchObject({ from: { code: 'ACME' }, batchingKey: 'Department' }); // the child inherits, so it adds nothing; the source is ACME
    await mode(child, 'matching', 'OWN');
    expect((await detail(grand)).inherited.matching).toMatchObject({ from: { code: 'CHILD' }, batchingKey: 'Own key' });
  });
  it('needs a parent and a known group', async () => {
    const r = await mode(acme, 'brands', 'INHERIT');
    expect(r.statusCode).toBe(422); expect(r.json().errors.mode).toMatch(/no parent/);
    expect((await mode(child, 'colours', 'INHERIT')).statusCode).toBe(422);
    expect((await mode(child, 'brands', 'SOMETIMES')).statusCode).toBe(422);
  });
  it('writes the change to the history in plain words', async () => {
    await mode(child, 'brands', 'INHERIT'); await mode(child, 'matching', 'EXTEND'); await mode(child, 'sequence', 'INHERIT'); await mode(child, 'emails', 'EXTEND');
    const lines = (await call('GET', `/api/customers/${child}/history`)).json().rows.map((r: { summary: string }) => r.summary);
    expect(lines).toEqual(expect.arrayContaining([
      "Brands: its own list → the parent's list", "Matching: its own settings → the parent's settings plus its own",
      "Pack sequence: its own settings → the parent's settings", "Notification e-mails: its own list → the parent's list plus its own",
    ]));
  });
  it('removing the parent puts every group back on its own and says so', async () => {
    await mode(child, 'brands', 'INHERIT'); await mode(child, 'emails', 'EXTEND');
    await call('PUT', `/api/customers/${child}`, details({ code: 'CHILD', name: 'Child Co', parentId: null }));
    expect((await detail(child)).modes).toEqual({ envelopes: 'OWN', brands: 'OWN', matching: 'OWN', sequence: 'OWN', emails: 'OWN' });
    const lines = (await call('GET', `/api/customers/${child}/history`)).json().rows.map((r: { summary: string }) => r.summary);
    expect(lines).toEqual(expect.arrayContaining(["Brands: the parent's list → its own list", "Notification e-mails: the parent's list plus its own → its own list"]));
  });
});
