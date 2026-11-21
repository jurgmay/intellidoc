import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemoryCostingStore } from '../src/costing/memoryStore.js';
import { MemoryCustomerStore } from '../src/customers/memoryStore.js';
import { MemoryPostalStore } from '../src/postal/memoryStore.js';
import { MemoryRecipientStore } from '../src/recipients/memoryStore.js';
import { MemoryReportStore } from '../src/reports/memoryStore.js';
import { MemorySettingsStore } from '../src/settings/store.js';

let app: FastifyInstance; let store: MemoryPostalStore; let provider: number; let service: number; let rate: number;
const svc = { formatId: 1, name: '2nd Class', serviceCode: 'STL2', isSignedFor: false, isTracked: false, isRecorded: false };
const rateBody = { minWeightG: 0, maxWeightG: 100, validFrom: '2026-01-01', validTo: null, cost: 0.6, sellPrice: 0.7 };
const post = (url: string, payload: unknown) => app.inject({ method: 'POST', url, payload: payload as object });
const put = (url: string, payload: unknown) => app.inject({ method: 'PUT', url, payload: payload as object });

beforeEach(async () => {
  store = new MemoryPostalStore(); store.today = () => '2026-11-21';
  app = await buildApp({ settings: new MemorySettingsStore(), customers: new MemoryCustomerStore(), costing: new MemoryCostingStore(), postal: store, recipients: new MemoryRecipientStore(), reports: new MemoryReportStore() });
  provider = (await post('/api/postal/providers', { name: 'Royal Mail' })).json().id;
  service = (await post(`/api/postal/providers/${provider}/services`, svc)).json().id;
  rate = (await post(`/api/postal/services/${service}/rates`, rateBody)).json().id;
});

describe('postal editor', () => {
  it('lists providers, services and rates with their status', async () => {
    const o = (await app.inject({ method: 'GET', url: '/api/postal' })).json();
    expect(o.today).toBe('2026-11-21');
    expect(o.providers[0].services[0].rates[0]).toMatchObject({ id: rate, status: 'current', cost: 0.6, usedBy: 0 });
  });
  it('rejects bad input field by field', async () => {
    const r = await post(`/api/postal/services/${service}/rates`, { ...rateBody, minWeightG: 50, maxWeightG: 10, cost: -1, sellPrice: 0.12345, validTo: '2025-01-01' });
    expect(r.statusCode).toBe(422);
    expect(Object.keys(r.json().fieldErrors ?? r.json().errors ?? {})).toEqual(expect.arrayContaining(['maxWeightG', 'cost', 'sellPrice', 'validTo']));
  });
  it('allows prices to be left empty', async () => {
    expect((await post(`/api/postal/services/${service}/rates`, { ...rateBody, minWeightG: 101, maxWeightG: 250, cost: null, sellPrice: null })).statusCode).toBe(201);
  });
  it('names must be unique', async () => {
    expect((await post('/api/postal/providers', { name: 'royal mail' })).statusCode).toBe(409);
    expect((await post(`/api/postal/providers/${provider}/services`, svc)).statusCode).toBe(409);
  });
  it('does not allow overlapping dates within a band', async () => {
    expect((await post(`/api/postal/services/${service}/rates`, { ...rateBody, validFrom: '2026-06-01' })).statusCode).toBe(409);
    expect((await post(`/api/postal/services/${service}/rates`, { ...rateBody, minWeightG: 101, maxWeightG: 250, validFrom: '2026-06-01' })).statusCode).toBe(201);
  });
  it('edits an unused price freely but only prices and last day of a used one', async () => {
    expect((await put(`/api/postal/rates/${rate}`, { ...rateBody, maxWeightG: 120 })).statusCode).toBe(204);
    store.rates.get(rate)!.usedBy = 3;
    expect((await put(`/api/postal/rates/${rate}`, { ...rateBody, maxWeightG: 130 })).statusCode).toBe(409);
    expect((await put(`/api/postal/rates/${rate}`, { ...rateBody, maxWeightG: 120, cost: 0.65, validTo: '2026-12-31' })).statusCode).toBe(204);
  });
  it('deletes a price only if nothing uses it', async () => {
    store.rates.get(rate)!.usedBy = 1;
    expect((await app.inject({ method: 'DELETE', url: `/api/postal/rates/${rate}` })).statusCode).toBe(409);
    store.rates.get(rate)!.usedBy = 0;
    expect((await app.inject({ method: 'DELETE', url: `/api/postal/rates/${rate}` })).statusCode).toBe(204);
  });
  it('deletes a service only without prices or batches, and a provider only without services', async () => {
    expect((await app.inject({ method: 'DELETE', url: `/api/postal/providers/${provider}` })).statusCode).toBe(409);
    expect((await app.inject({ method: 'DELETE', url: `/api/postal/services/${service}` })).statusCode).toBe(409);
    await app.inject({ method: 'DELETE', url: `/api/postal/rates/${rate}` });
    store.services.get(service)!.batches = 2;
    expect((await app.inject({ method: 'DELETE', url: `/api/postal/services/${service}` })).statusCode).toBe(409);
    store.services.get(service)!.batches = 0;
    expect((await app.inject({ method: 'DELETE', url: `/api/postal/services/${service}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/api/postal/providers/${provider}` })).statusCode).toBe(204);
  });
  it('a dated change ends the old row the day before and starts a new one', async () => {
    const r = await post(`/api/postal/services/${service}/price-change`, { effectiveFrom: '2027-01-01', changes: [{ rateId: rate, cost: 0.7, sellPrice: 0.8 }] });
    expect(r.json()).toEqual({ changed: 1 });
    const rows = (await app.inject({ method: 'GET', url: '/api/postal' })).json().providers[0].services[0].rates;
    expect(rows).toHaveLength(2);
    expect(rows.find((x: { validFrom: string }) => x.validFrom === '2027-01-01')).toMatchObject({ cost: 0.7, sellPrice: 0.8, status: 'planned', validTo: null });
    expect(rows.find((x: { id: number }) => x.id === rate)).toMatchObject({ validTo: '2026-12-31', cost: 0.6 });
  });
  it('a dated change keeps a future last day and refuses dates in the past or a second change on the same row', async () => {
    await put(`/api/postal/rates/${rate}`, { ...rateBody, validTo: '2027-12-31' });
    await post(`/api/postal/services/${service}/price-change`, { effectiveFrom: '2027-01-01', changes: [{ rateId: rate, cost: 1, sellPrice: 1 }] });
    const rows = (await app.inject({ method: 'GET', url: '/api/postal' })).json().providers[0].services[0].rates;
    expect(rows.find((x: { validFrom: string }) => x.validFrom === '2027-01-01').validTo).toBe('2027-12-31');
    expect((await post(`/api/postal/services/${service}/price-change`, { effectiveFrom: '2020-01-01', changes: [{ rateId: rate, cost: 1, sellPrice: 1 }] })).statusCode).toBe(422);
    expect((await post(`/api/postal/services/${service}/price-change`, { effectiveFrom: '2027-06-01', changes: [{ rateId: rate, cost: 1, sellPrice: 1 }] })).statusCode).toBe(409);
  });
  it('writes a change log', async () => {
    await put(`/api/postal/rates/${rate}`, { ...rateBody, cost: 0.62 });
    const h = (await app.inject({ method: 'GET', url: '/api/postal/history' })).json().rows;
    expect(h[0].summary).toMatch(/cost 0.6 → 0.62/);
  });
});
