import { MemoryReportStore } from '../src/reports/memoryStore.js';
import { MemoryReferenceStore } from '../src/reference/memoryStore.js';
import { MemoryRecipientStore } from '../src/recipients/memoryStore.js';
import { MemoryCustomerStore } from '../src/customers/memoryStore.js';
import { MemoryRepriceStore } from '../src/reprice/memoryStore.js';
import { MemoryPostalStore } from '../src/postal/memoryStore.js';
import { MemoryCostingStore } from '../src/costing/memoryStore.js';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemorySettingsStore } from '../src/settings/store.js';
import { SETTINGS, validate, BY_KEY, nameOf } from '../src/settings/catalogue.js';
import type { MarksPreviewer } from '../src/settings/preview.js';

let store: MemorySettingsStore; let app: FastifyInstance;
beforeEach(async () => { store = new MemorySettingsStore(); app = await buildApp({ settings: store, customers: new MemoryCustomerStore(), costing: new MemoryCostingStore(), postal: new MemoryPostalStore(), reprice: new MemoryRepriceStore(), recipients: new MemoryRecipientStore(), reports: new MemoryReportStore(), reference: new MemoryReferenceStore() }); });

const put = (values: Record<string, unknown>) => app.inject({ method: 'PUT', url: '/api/settings', payload: { values } });

describe('GET /api/settings', () => {
  it('returns every setting with its explanation, value and groups', async () => {
    const r = await app.inject({ url: '/api/settings' });
    const body = r.json();
    expect(r.statusCode).toBe(200);
    expect(body.settings).toHaveLength(SETTINGS.length);
    const w = body.settings.find((s: { key: string }) => s.key === 'machineEnclosingMaxSheets');
    expect(w).toMatchObject({ value: 12, group: 'Enclosing' });
    expect(w.usedBy).toMatch(/machine/i);
    expect(body.settings.find((s: { key: string }) => s.key === 'machineEnclosingEnvelopeSize').options).toEqual(['C5', 'C4']);
    expect(body.groups).toEqual(['Weights and sizes', 'Enclosing', 'PDF and alerts', 'Print production settings', 'Page size', 'Envelope window', 'Sequence number', 'Data Matrix', 'Pack start dot', 'MRDF page codes']);
    expect(body.batchCode).toEqual({ highestUsed: 1041, next: 1042 });
  });
  it('every setting names a column, a group that exists and a description', () => {
    for (const s of SETTINGS) { expect(s.column).toMatch(/^[a-z0-9_]+$/); expect(['Weights and sizes', 'Enclosing', 'PDF and alerts', 'Print production settings', 'Page size', 'Envelope window', 'Sequence number', 'Data Matrix', 'Pack start dot', 'MRDF page codes']).toContain(s.group); expect(s.description.length).toBeGreaterThan(10); expect(s.usedBy.length).toBeGreaterThan(10); }
  });
});

describe('PUT /api/settings', () => {
  it('saves changes, and writes one audit row per changed value only', async () => {
    const r = await put({ pdfWaitMinutes: 45, pdfReminderMinutes: 30, xmlFirstEnabled: false });
    expect(r.statusCode).toBe(200);
    expect(r.json().changed).toBe(2);
    expect(store.values['pdfWaitMinutes']).toBe(45);
    const audit = (await app.inject({ url: '/api/settings/audit' })).json().rows;
    expect(audit).toHaveLength(2);
    expect(audit.map((a: { setting: string; oldValue: string; newValue: string }) => `${a.setting}: ${a.oldValue} -> ${a.newValue}`).sort()).toEqual([
      'Alert if the PDF has not arrived after: 30 -> 45', 'Import an XML without waiting for its PDF: on -> off']);
    expect(audit[0].changedBy).toBe('system');
  });
  it('names the mark settings in full in the change log and in error messages, though their labels leave out the heading', async () => {
    expect(BY_KEY.get('markSeqLeftMm')).toMatchObject({ group: 'Sequence number', label: 'Left' });
    expect(BY_KEY.get('markDotDiameterMm')).toMatchObject({ group: 'Pack start dot', label: 'Diameter' });
    expect((await put({ markSeqLeftMm: 22, markDmWidthMm: 9 })).statusCode).toBe(200);
    const audit = (await app.inject({ url: '/api/settings/audit' })).json().rows.map((a: { setting: string }) => a.setting).sort();
    expect(audit).toEqual(['Data Matrix: width', 'Sequence number: left']);
    const bad = await put({ markDotDiameterMm: 0 });
    expect(bad.json().errors.markDotDiameterMm).toBe('Pack start dot: diameter must be at least 0.1');
  });
  it('rejects bad values with a message per setting and saves nothing', async () => {
    const r = await put({ pdfWaitMinutes: 0, a4SheetWeightG: 'heavy', machineEnclosingEnvelopeSize: 'A9', alertRecipients: 'not-an-email', nonsense: 1, machineEnclosingMaxSheets: 8 });
    expect(r.statusCode).toBe(422);
    const e = r.json().errors;
    expect(Object.keys(e).sort()).toEqual(['a4SheetWeightG', 'alertRecipients', 'machineEnclosingEnvelopeSize', 'nonsense', 'pdfWaitMinutes']);
    expect(e.pdfWaitMinutes).toMatch(/at least 1/);
    expect(store.values['machineEnclosingMaxSheets']).toBe(12);
    expect(store.rows).toHaveLength(0);
  });
  it('tidies a list of e-mail addresses', async () => {
    await put({ alertRecipients: ' a@x.com;b@x.com ,  c@x.com ' });
    expect(store.values['alertRecipients']).toBe('a@x.com, b@x.com, c@x.com');
  });
  it('a request that changes nothing writes no audit rows', async () => {
    expect((await put({ pdfWaitMinutes: 30 })).json().changed).toBe(0);
    expect(store.rows).toHaveLength(0);
  });
  it('needs a body', async () => {
    expect((await app.inject({ method: 'PUT', url: '/api/settings', payload: {} })).statusCode).toBe(400);
  });
});

describe('batch code', () => {
  it('can be moved up, not back onto a number already used', async () => {
    const bad = await app.inject({ method: 'PUT', url: '/api/settings/batch-code', payload: { next: 1041 } });
    expect(bad.statusCode).toBe(422); expect(bad.json().errors.next).toMatch(/already been used/);
    const ok = await app.inject({ method: 'PUT', url: '/api/settings/batch-code', payload: { next: 90000 } });
    expect(ok.json().next).toBe(90000);
    expect(store.rows[0]).toMatchObject({ setting: 'Next batch code', oldValue: '1042', newValue: '90000' });
  });
  it('must be a whole number', async () => {
    expect((await app.inject({ method: 'PUT', url: '/api/settings/batch-code', payload: { next: 1.5 } })).statusCode).toBe(422);
    expect((await app.inject({ method: 'PUT', url: '/api/settings/batch-code', payload: { next: '5' } })).statusCode).toBe(422);
  });
});

describe('validate', () => {
  it('whole numbers only for integer settings', () => {
    expect(validate(BY_KEY.get('pdfWaitMinutes')!, 1.5)).toHaveProperty('error');
    expect(validate(BY_KEY.get('a4SheetWeightG')!, 5.625)).toEqual({ value: 5.625 });
  });
});

describe('page size settings', () => {
  it('are Width and Height of the Page size group, defaulting to A4, and named in full in the change log', async () => {
    const page = SETTINGS.filter((s) => s.group === 'Page size');
    expect(page.map((s) => [s.key, s.label])).toEqual([['pageWidthMm', 'Width'], ['pageHeightMm', 'Height']]);
    expect(store.values['pageWidthMm']).toBe(210); expect(store.values['pageHeightMm']).toBe(297);
    expect((await put({ pageHeightMm: 420 })).statusCode).toBe(200);
    expect(store.rows[0]).toMatchObject({ setting: 'Page size: height', oldValue: '297', newValue: '420' });
    expect((await put({ pageWidthMm: 0 })).statusCode).toBe(422);
  });
});

describe('envelope window settings', () => {
  it('are four settings in their own group, named in full in the change log', async () => {
    const win = SETTINGS.filter((s) => s.group === 'Envelope window');
    expect(win.map((s) => [s.key, s.label])).toEqual([['windowLeftMm', 'Left'], ['windowTopMm', 'Top'], ['windowWidthMm', 'Width'], ['windowHeightMm', 'Height']]);
    expect(win.map(nameOf)).toEqual(['Envelope window: left', 'Envelope window: top', 'Envelope window: width', 'Envelope window: height']);
    expect((await put({ windowWidthMm: 100 })).statusCode).toBe(200);
    expect(store.rows[0]).toMatchObject({ setting: 'Envelope window: width', oldValue: '90', newValue: '100' });
    const bad = await put({ windowHeightMm: 0 });
    expect(bad.statusCode).toBe(422); expect(bad.json().errors.windowHeightMm).toMatch(/Envelope window: height must be at least 0.1/);
  });
});

describe('POST /api/settings/marks-preview', () => {
  const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  let seen: Parameters<MarksPreviewer>[];
  const withPreview = async (fn: MarksPreviewer = async () => PNG) => {
    seen = [];
    return buildApp({ settings: store, customers: new MemoryCustomerStore(), costing: new MemoryCostingStore(), postal: new MemoryPostalStore(), reprice: new MemoryRepriceStore(), recipients: new MemoryRecipientStore(), reports: new MemoryReportStore(), reference: new MemoryReferenceStore(),
      marksPreview: async (...a) => { seen.push(a); return fn(...a); } });
  };
  it('draws the saved positions and returns a PNG', async () => {
    const a = await withPreview();
    const r = await a.inject({ method: 'POST', url: '/api/settings/marks-preview', payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect(new Uint8Array(r.rawPayload)).toEqual(PNG);
    expect(seen[0]![0]).toBe('window');
    expect(seen[0]![1]).toMatchObject({ seq: { leftMm: 20, topMm: 40, widthMm: 45, heightMm: 4, fontPt: 8 }, dm: { leftMm: 20, topMm: 30 }, dot: { xMm: 205.5, yMm: 269, diameterMm: 2 }, mrdf: { dm: { leftMm: 10 }, ocr: { fontPt: 8.2 } } });
    expect(seen[0]![2]).toEqual({ leftMm: 15, topMm: 25, widthMm: 90, heightMm: 35 });
    expect(seen[0]![3]).toEqual({ widthMm: 210, heightMm: 297 });
  });
  it('uses the values on screen over the saved ones, without saving them', async () => {
    const a = await withPreview();
    const r = await a.inject({ method: 'POST', url: '/api/settings/marks-preview', payload: { page: 'mrdf', values: { markSeqLeftMm: 33, windowTopMm: 12, pageWidthMm: 297 } } });
    expect(r.statusCode).toBe(200);
    expect(seen[0]![0]).toBe('mrdf');
    expect(seen[0]![1].seq.leftMm).toBe(33); expect(seen[0]![2].topMm).toBe(12); expect(seen[0]![3]).toEqual({ widthMm: 297, heightMm: 297 });
    expect(store.values['markSeqLeftMm']).toBe(20); expect(store.rows).toHaveLength(0);
  });
  it('refuses values that could not be saved, and unknown pages', async () => {
    const a = await withPreview();
    const bad = await a.inject({ method: 'POST', url: '/api/settings/marks-preview', payload: { values: { windowWidthMm: -1, nope: 1 } } });
    expect(bad.statusCode).toBe(422); expect(Object.keys(bad.json().errors).sort()).toEqual(['nope', 'windowWidthMm']);
    expect((await a.inject({ method: 'POST', url: '/api/settings/marks-preview', payload: { page: 'back' } })).statusCode).toBe(422);
    expect(seen).toHaveLength(0);
  });
  it('says so when the picture cannot be drawn (Ghostscript missing)', async () => {
    const a = await withPreview(async () => { throw new Error('Ghostscript was not found (gs).'); });
    const r = await a.inject({ method: 'POST', url: '/api/settings/marks-preview', payload: {} });
    expect(r.statusCode).toBe(503); expect(r.json().error).toMatch(/Ghostscript was not found/);
  });
});
