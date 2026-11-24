import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemoryCostingStore } from '../src/costing/memoryStore.js';
import { MemoryCustomerStore } from '../src/customers/memoryStore.js';
import { MemoryRepriceStore } from '../src/reprice/memoryStore.js';
import { MemoryPostalStore } from '../src/postal/memoryStore.js';
import { MemoryRecipientStore } from '../src/recipients/memoryStore.js';
import { MemoryReportStore } from '../src/reports/memoryStore.js';
import { MemoryReferenceStore } from '../src/reference/memoryStore.js';
import { MemorySettingsStore } from '../src/settings/store.js';
import { parseCsv, readRatesFile } from '../src/postal/importFile.js';
import { planImport } from '../src/postal/importPlan.js';

const HEAD = 'isCurrentPrice,postalProvider,postalService,postalFormat,minWeight,maxWeight,postageCost,postageSellPrice,isSignedFor,postalServiceCode';
const csv = (...rows: string[]): Buffer => Buffer.from([HEAD, ...rows].join('\n'));
let app: FastifyInstance; let store: MemoryPostalStore;

beforeEach(async () => {
  store = new MemoryPostalStore(); store.today = () => '2026-11-21';
  app = await buildApp({ settings: new MemorySettingsStore(), customers: new MemoryCustomerStore(), costing: new MemoryCostingStore(), postal: store, reprice: new MemoryRepriceStore(), recipients: new MemoryRecipientStore(), reports: new MemoryReportStore(), reference: new MemoryReferenceStore() });
});
const upload = (body: Buffer, q: string, name = 'rates.csv') =>
  app.inject({ method: 'POST', url: `/api/postal/import?${q}&name=${name}`, payload: body, headers: { 'content-type': name.endsWith('xlsx') ? 'application/octet-stream' : 'text/csv' } });
const plan = async (body: Buffer, start: string, end: string | null = null) => planImport(await readRatesFile(body, 'x.csv'), await store.overview(), { startDate: start, endDate: end, today: '2026-11-21' });

describe('reading files', () => {
  it('parses quoted CSV fields and ignores a byte order mark', () => {
    expect(parseCsv('﻿a,b\n"x, y","say ""hi"""\r\n\r\n1,2')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['1', '2']]);
  });
  it('reads the first sheet of an xlsx file by heading', async () => {
    const f = await readRatesFile(readFileSync('test/fixtures/rates-sample.xlsx'), 'rates-sample.xlsx');
    expect(f.rows).toHaveLength(4);
    expect(f.rows[0]!.cells.postalservice).toBe('1st Class');
  });
  it('rejects an empty or unreadable file', async () => {
    await expect(readRatesFile(Buffer.alloc(0), 'a.csv')).rejects.toThrow();
    await expect(readRatesFile(Buffer.from('nope'), 'a.xlsx')).rejects.toThrow();
  });
});

describe('planning an import', () => {
  it('adds new providers, services and prices, skipping rows that are not current', async () => {
    const f = await readRatesFile(readFileSync('test/fixtures/rates-sample.xlsx'), 'r.xlsx');
    const p = planImport(f, await store.overview(), { startDate: '2027-01-01', endDate: null, today: '2026-11-21' });
    expect(p.errors).toEqual([]);
    expect(p.counts).toMatchObject({ newProviders: 2, newServices: 3, newBands: 3, skippedRows: 1, blockedBands: 0 });
    expect(p.warnings.map((w) => w.message).join()).toContain('more than 4 decimal places');
    expect(p.bands.find((b) => b.service === 'Standard')!.cost).toBe(1.2346);
    expect(p.services.find((s) => s.name === '1st Class Signed For')).toMatchObject({ isSignedFor: true, serviceCode: 'STL1S' });
    expect(p.canImport).toBe(true);
  });
  it('requires a start date and an end date that is not before it', async () => {
    const b = csv('1,Royal Mail,2nd Class,Letter,0,100,0.5,0.6,0,');
    expect((await plan(b, '')).errors[0]!.message).toMatch(/start date is required/);
    expect((await plan(b, '2027-01-01', '2026-12-31')).errors[0]!.message).toMatch(/before the start/);
    expect((await plan(b, '2027-01-01', '2027-12-31')).canImport).toBe(true);
  });
  it('reports row errors with their row numbers and blocks the import', async () => {
    const p = await plan(csv('1,Royal Mail,2nd Class,Parcel,0,100,0.5,0.6,0,', '1,Royal Mail,2nd Class,Letter,50,10,0.5,0.6,0,', '1,Royal Mail,2nd Class,Letter,0,100,-1,0.6,0,', '1,,X,Letter,0,1,1,1,0,'), '2027-01-01');
    expect(p.errors.map((e) => e.row)).toEqual([2, 3, 4, 5]);
    expect(p.canImport).toBe(false);
  });
  it('reports a repeated band and missing columns', async () => {
    const p = await plan(csv('1,RM,S,Letter,0,100,1,1,0,', '1,rm,s,letter,0,100,2,2,0,'), '2027-01-01');
    expect(p.errors[0]).toMatchObject({ row: 3 });
    const q = planImport(await readRatesFile(Buffer.from('a,b\n1,2'), 'x.csv'), await store.overview(), { startDate: '2027-01-01', endDate: null, today: '2026-11-21' });
    expect(q.errors[0]!.message).toContain('postalProvider');
  });

  describe('against existing prices', () => {
    beforeEach(async () => {
      const prov = await store.createProvider('Royal Mail', 't');
      const svc = await store.createService(prov, { formatId: 1, name: '2nd Class', serviceCode: null, isSignedFor: false, isTracked: false, isRecorded: false }, 't');
      await store.createRate(svc, { minWeightG: 0, maxWeightG: 100, validFrom: '2026-01-01', validTo: null, cost: 0.5, sellPrice: 0.6 }, 't');
    });
    const row = (cost: number, sell: number, min = 0, max = 100) => csv(`1,royal mail,2nd class,letter,${min},${max},${cost},${sell},0,`);
    it('changes a band in force: old row ends the day before, new one starts', async () => {
      const p = await plan(row(0.55, 0.65), '2027-01-01');
      expect(p.bands[0]).toMatchObject({ action: 'change' }); expect(p.counts.newServices).toBe(0);
      await app.inject({ method: 'POST', url: '/api/postal/import?start=2027-01-01&apply=1&name=r.csv', payload: row(0.55, 0.65), headers: { 'content-type': 'text/csv' } });
      const rates = (await store.overview()).providers[0]!.services[0]!.rates;
      expect(rates.map((r) => [r.validFrom, r.validTo, r.cost])).toEqual([['2027-01-01', null, 0.55], ['2026-01-01', '2026-12-31', 0.5]]);
    });
    it('leaves identical prices alone and updates a row starting the same day', async () => {
      expect((await plan(row(0.5, 0.6), '2027-01-01')).counts).toMatchObject({ unchangedBands: 1, changedBands: 0 });
      expect((await plan(row(0.5, 0.6), '2027-01-01')).canImport).toBe(false); // nothing to do
      expect((await plan(row(0.7, 0.8), '2026-01-01')).bands[0]!.action).toBe('update');
    });
    it('will not start new prices for a band in use in the past', async () => {
      const p = await plan(row(0.7, 0.8), '2026-06-01');
      expect(p.bands[0]).toMatchObject({ action: 'blocked' }); expect(p.canImport).toBe(false);
    });
    it('blocks bands whose weights cross an existing band, and later rows in the window', async () => {
      expect((await plan(row(1, 1, 0, 200), '2027-01-01')).bands[0]!.action).toBe('blocked');
      const svcId = (await store.overview()).providers[0]!.services[0]!.id;
      await store.createRate(svcId, { minWeightG: 0, maxWeightG: 100, validFrom: '2028-01-01', validTo: null, cost: 1, sellPrice: 1 }, 't').catch(() => undefined);
      // the open-ended row above is refused (it overlaps), so end the first row and add the later one
      const first = (await store.overview()).providers[0]!.services[0]!.rates[0]!;
      await store.updateRate(first.id, { minWeightG: 0, maxWeightG: 100, validFrom: first.validFrom, validTo: '2027-12-31', cost: 0.5, sellPrice: 0.6 }, 't');
      await store.createRate(svcId, { minWeightG: 0, maxWeightG: 100, validFrom: '2028-01-01', validTo: null, cost: 1, sellPrice: 1 }, 't');
      const p = await plan(row(0.9, 0.9), '2027-06-01');
      expect(p.bands[0]!.action).toBe('blocked');
    });
    it('adds a new band for another weight range of an existing service', async () => {
      const p = await plan(row(1, 1.2, 101, 250), '2027-01-01', '2027-12-31');
      expect(p.bands[0]).toMatchObject({ action: 'new' });
    });
  });
});

describe('POST /api/postal/import', () => {
  it('checks without changing anything, then applies and audits', async () => {
    const body = readFileSync('test/fixtures/rates-sample.xlsx');
    const check = await upload(body, 'start=2027-01-01&end=2027-12-31', 'rates-sample.xlsx');
    expect(check.statusCode).toBe(200);
    expect(check.json().plan.canImport).toBe(true); expect(check.json().result).toBeNull();
    expect(store.providers.size).toBe(0);
    const done = await upload(body, 'start=2027-01-01&end=2027-12-31&apply=1', 'rates-sample.xlsx');
    expect(done.statusCode).toBe(200);
    expect(done.json().result).toMatchObject({ newProviders: 2, newServices: 3, newBands: 3 });
    const o = await store.overview();
    expect(o.providers.map((p) => p.name)).toEqual(['Royal Mail', 'The Delivery Group']);
    expect(o.providers[0]!.services.flatMap((s) => s.rates).every((r) => r.validFrom === '2027-01-01' && r.validTo === '2027-12-31')).toBe(true);
    expect(store.audit[0]!.summary).toContain('imported prices from "rates-sample.xlsx"');
    // a second import has nothing left to do
    expect((await upload(body, 'start=2027-01-01&end=2027-12-31&apply=1', 'rates-sample.xlsx')).statusCode).toBe(409);
  });
  it('answers 422 for a missing start date format and 409 when applying a file with problems', async () => {
    expect((await upload(csv('1,RM,S,Letter,0,1,1,1,0,'), 'start=01/01/2027')).statusCode).toBe(422);
    expect((await upload(csv('1,RM,S,Nope,0,1,1,1,0,'), 'start=2027-01-01&apply=1')).statusCode).toBe(409);
  });
});
