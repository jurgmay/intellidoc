import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { MemoryCustomerStore } from '../src/customers/memoryStore.js';
import { FLAGS } from '../src/customers/types.js';
import { MemorySettingsStore } from '../src/settings/store.js';

let app: FastifyInstance;
let store: MemoryCustomerStore;
let acme: number;
const flags = (over: Record<string, boolean> = {}) => ({ ...Object.fromEntries(FLAGS.map((f) => [f, false])), ...over });
const details = (over: Record<string, unknown> = {}) => ({ code: 'ACME', name: 'Acme Ltd', misJobNumber: null, pendingJobNumber: null, returnAddress: null, batchingKey: null, packSequenceKey: null, parentId: null, flags: flags(), ...over });
const env = (over: Record<string, unknown> = {}) => ({ brandId: null, deliveryBand: '2nd Class', postalRateId: 1, stockItemId: 10, reference: null, externalName: null, isOversticker: false, ...over });

beforeEach(async () => {
  store = new MemoryCustomerStore();
  acme = store.seed({ code: 'ACME', name: 'Acme Ltd' });
  store.seed({ code: 'NWB', name: 'Northwest Bank', misJobNumber: '24102' });
  app = await buildApp({ settings: new MemorySettingsStore(), customers: store });
});

const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) => app.inject({ method, url, payload: payload as object });

describe('list and search', () => {
  it('lists customers by name and searches code, name and MIS job number', async () => {
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
