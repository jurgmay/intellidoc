import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemoryCostingStore } from '../src/costing/memoryStore.js';
import { MemoryCustomerStore } from '../src/customers/memoryStore.js';
import { MemoryPostalStore } from '../src/postal/memoryStore.js';
import { MemoryReferenceStore } from '../src/reference/memoryStore.js';
import { MemoryRepriceStore } from '../src/reprice/memoryStore.js';
import { MemoryRecipientStore } from '../src/recipients/memoryStore.js';
import { MemoryReportStore } from '../src/reports/memoryStore.js';
import { MemorySettingsStore } from '../src/settings/store.js';
import { normaliseAnonymous } from '../src/reference/rules.js';

let app: FastifyInstance; let store: MemoryReferenceStore;
const put = (url: string, payload: unknown) => app.inject({ method: 'PUT', url, payload: payload as object });
const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload: payload as object });
const get = (url: string) => app.inject({ method: 'GET', url });
beforeEach(async () => {
  store = new MemoryReferenceStore();
  app = await buildApp({ settings: new MemorySettingsStore(), customers: new MemoryCustomerStore(), costing: new MemoryCostingStore(), postal: new MemoryPostalStore(), reprice: new MemoryRepriceStore(),
    recipients: new MemoryRecipientStore(), reports: new MemoryReportStore(), reference: store });
});

describe('anonymous addressee normalisation', () => {
  it('matches what the import does to a line, then removes the spaces', () => {
    expect(normaliseAnonymous('The Occupier')).toBe('THEOCCUPIER');
    expect(normaliseAnonymous('  the-  occupier. ')).toBe('THEOCCUPIER');
    expect(normaliseAnonymous('Mr & Mrs Smith')).toBe('MRANDMRSSMITH');
    expect(normaliseAnonymous("The Home Owner's")).toBe('THEHOMEOWNERS');
  });
});

describe('papers', () => {
  it('lists them with what they are used by', async () => {
    const r = (await get('/api/reference/papers')).json().papers;
    expect(r.map((p: { name: string }) => p.name)).toEqual(['A4 Plain', 'A4 White']);
    expect(r.find((p: { name: string }) => p.name === 'A4 White').usedBy).toBe(3);
  });
  it('changes the batch name and code, and logs it', async () => {
    const r = await put('/api/reference/papers/2', { batchName: ' A4 WHITE ', paperCode: 'P-1' });
    expect(r.statusCode).toBe(204);
    expect(store.paperRows[1]).toMatchObject({ batchName: 'A4 WHITE', paperCode: 'P-1' });
    const h = (await get('/api/reference/history')).json().rows;
    expect(h[0].summary).toBe('Paper "A4 Plain": batch name A4 PLAIN -> A4 WHITE, paper code not set -> P-1');
  });
  it('logs nothing when nothing changed, and needs a batch name', async () => {
    await put('/api/reference/papers/1', { batchName: 'A4 WHITE', paperCode: null });
    expect(store.log).toHaveLength(0);
    const bad = await put('/api/reference/papers/1', { batchName: '  ' });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().errors.batchName).toContain('required');
  });
  it('deletes an unused paper but not one that is in use', async () => {
    expect((await app.inject({ method: 'DELETE', url: '/api/reference/papers/1' })).statusCode).toBe(409);
    expect((await app.inject({ method: 'DELETE', url: '/api/reference/papers/2' })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: '/api/reference/papers/2' })).statusCode).toBe(404);
  });
});

describe('postal formats', () => {
  it('lists them smallest first', async () => {
    const f = (await get('/api/reference/postal-formats')).json().formats;
    expect(f.map((x: { name: string }) => x.name)).toEqual(['Letter', 'Large Letter', 'Small Parcel']);
  });
  it('changes the limits and logs it; the name and rank cannot be changed', async () => {
    const r = await put('/api/reference/postal-formats/1', { name: 'Hacked', rank: 9, maxWeightG: 120, maxThicknessMm: 6.5, maxSheets: null, maxWidthMm: 245, maxHeightMm: 170.5 });
    expect(r.statusCode).toBe(204);
    expect(store.formatRows[0]).toMatchObject({ name: 'Letter', rank: 1, maxWeightG: 120, maxThicknessMm: 6.5, maxSheets: null, maxWidthMm: 245, maxHeightMm: 170.5 });
    expect((await get('/api/reference/history')).json().rows[0].summary).toBe('Postal format "Letter": most weight 100g -> 120g, most thickness 5 -> 6.5 mm, most sheets 16 -> not set, most width 240 mm -> 245 mm, most height 165 mm -> 170.5 mm');
  });
  it('keeps the formats in order: a bigger one cannot take less than a smaller one', async () => {
    const low = await put('/api/reference/postal-formats/2', { maxWeightG: 90, maxThicknessMm: 25, maxSheets: 125, maxWidthMm: 353, maxHeightMm: 250 });
    expect(low.statusCode).toBe(422);
    expect(low.body).toContain('Letter');
    const high = await put('/api/reference/postal-formats/1', { maxWeightG: 800, maxThicknessMm: 5, maxSheets: 16, maxWidthMm: 240, maxHeightMm: 165 });
    expect(high.statusCode).toBe(422);
    expect(high.body).toContain('Large Letter');
    expect(store.log).toHaveLength(0);
  });
  it('keeps the sizes in order too, and every format must have a width and a height', async () => {
    const wide = await put('/api/reference/postal-formats/2', { maxWeightG: 750, maxThicknessMm: 25, maxSheets: 125, maxWidthMm: 239, maxHeightMm: 165 });
    expect(wide.statusCode).toBe(422); expect(wide.json().errors.maxWidthMm).toContain('Letter');
    const tall = await put('/api/reference/postal-formats/1', { maxWeightG: 100, maxThicknessMm: 5, maxSheets: 16, maxWidthMm: 300, maxHeightMm: 251 });
    expect(tall.statusCode).toBe(422); expect(tall.json().errors.maxHeightMm).toContain('Large Letter');
  });
  it('validates the numbers', async () => {
    const ok = { maxWeightG: 100, maxWidthMm: 240, maxHeightMm: 165 };
    expect((await put('/api/reference/postal-formats/1', ok)).statusCode).toBe(204);
    for (const body of [{ ...ok, maxWeightG: 0 }, { ...ok, maxWeightG: 1.5 }, { ...ok, maxThicknessMm: -1 }, { ...ok, maxThicknessMm: 1.234 }, { ...ok, maxSheets: 0 },
      { maxWeightG: 100 }, { ...ok, maxWidthMm: null }, { ...ok, maxHeightMm: undefined }, { ...ok, maxWidthMm: 0 }, { ...ok, maxHeightMm: -5 }, { ...ok, maxWidthMm: 240.123 }, { ...ok, maxWidthMm: 'wide' },
      { ...ok, maxWidthMm: 160, maxHeightMm: 165 }, {}]) {
      expect((await put('/api/reference/postal-formats/1', body)).statusCode, JSON.stringify(body)).toBe(422);
    }
  });
  it('404s an unknown format', async () => { expect((await put('/api/reference/postal-formats/99', { maxWeightG: 100, maxWidthMm: 240, maxHeightMm: 165 })).statusCode).toBe(404); });
});

describe('anonymous addressees', () => {
  it('adds a name in its normalised form and refuses a duplicate in another spelling', async () => {
    const r = await post('/api/reference/anonymous', { text: 'The Home-Owner' });
    expect(r.statusCode).toBe(201);
    expect(r.json().text).toBe('THEHOMEOWNER');
    expect((await get('/api/reference/anonymous')).json().names).toEqual(['THEHOMEOWNER', 'THEOCCUPIER', 'THERESIDENT']);
    expect((await post('/api/reference/anonymous', { text: 'the  occupier' })).statusCode).toBe(409);
    expect((await get('/api/reference/history')).json().rows[0].summary).toBe('Anonymous addressee THEHOMEOWNER added');
  });
  it('refuses empty text or text with no letters or digits', async () => {
    expect((await post('/api/reference/anonymous', { text: '  ' })).statusCode).toBe(422);
    expect((await post('/api/reference/anonymous', { text: '- . -' })).statusCode).toBe(422);
  });
  it('removes a name', async () => {
    expect((await app.inject({ method: 'DELETE', url: '/api/reference/anonymous/THEOCCUPIER' })).statusCode).toBe(204);
    expect((await get('/api/reference/anonymous')).json().names).toEqual(['THERESIDENT']);
    expect((await app.inject({ method: 'DELETE', url: '/api/reference/anonymous/NOBODY' })).statusCode).toBe(404);
  });
});
