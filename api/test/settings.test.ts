import { MemoryReportStore } from '../src/reports/memoryStore.js';
import { MemoryRecipientStore } from '../src/recipients/memoryStore.js';
import { MemoryCustomerStore } from '../src/customers/memoryStore.js';
import { MemoryPostalStore } from '../src/postal/memoryStore.js';
import { MemoryCostingStore } from '../src/costing/memoryStore.js';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemorySettingsStore } from '../src/settings/store.js';
import { SETTINGS, validate, BY_KEY } from '../src/settings/catalogue.js';

let store: MemorySettingsStore; let app: FastifyInstance;
beforeEach(async () => { store = new MemorySettingsStore(); app = await buildApp({ settings: store, customers: new MemoryCustomerStore(), costing: new MemoryCostingStore(), postal: new MemoryPostalStore(), recipients: new MemoryRecipientStore(), reports: new MemoryReportStore() }); });

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
    expect(body.groups).toEqual(['Weights and sizes', 'Enclosing', 'PDF and alerts']);
    expect(body.batchCode).toEqual({ highestUsed: 1041, next: 1042 });
  });
  it('every setting names a column, a group that exists and a description', () => {
    for (const s of SETTINGS) { expect(s.column).toMatch(/^[a-z0-9_]+$/); expect(['Weights and sizes', 'Enclosing', 'PDF and alerts']).toContain(s.group); expect(s.description.length).toBeGreaterThan(10); expect(s.usedBy.length).toBeGreaterThan(10); }
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
