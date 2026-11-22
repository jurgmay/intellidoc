import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { MemoryCostingStore } from '../src/costing/memoryStore.js';
import { MemoryCustomerStore } from '../src/customers/memoryStore.js';
import { MemoryJobComposer, MemoryJobStore } from '../src/jobs/memoryStore.js';
import type { JobDetail } from '../src/jobs/types.js';
import { MemoryPostalStore } from '../src/postal/memoryStore.js';
import { MemoryRecipientStore } from '../src/recipients/memoryStore.js';
import { MemoryReferenceStore } from '../src/reference/memoryStore.js';
import { MemoryReportStore } from '../src/reports/memoryStore.js';
import { MemoryRepriceStore } from '../src/reprice/memoryStore.js';
import { MemorySettingsStore } from '../src/settings/store.js';

const job = (id: number, over: Partial<JobDetail> = {}): JobDetail => ({
  id, customerCode: 'ACME', customerName: 'Acme Energy Ltd', baseName: `ACME_${id}`, pdfFileName: `ACME_${id}.pdf`, receivedAt: '2026-11-20T09:30:00.000Z', status: 'Received',
  packCount: 10, pageCount: 30, pdfError: null, batchCount: 1, composedBatchCount: 0, batches: [{ id: id * 10, batchCode: 7000 + id, status: 'Created', mailpieceCount: 10, files: [] }], ...over,
});
let app: FastifyInstance; let store: MemoryJobStore; let composer: MemoryJobComposer;

beforeEach(async () => {
  store = new MemoryJobStore(); composer = new MemoryJobComposer();
  store.jobs = [job(1), job(2, { customerCode: 'ODEVO', customerName: 'Odevo', baseName: 'ODEVO_2', status: 'Awaiting PDF' }), job(3, { status: 'PDF Rejected', pdfError: 'Pack 2 is past the end' })];
  composer.result = [{ batchCode: 7001, files: ['7001_1.pdf'], mrdfFile: null, skipped: null }];
  app = await buildApp({ settings: new MemorySettingsStore(), customers: new MemoryCustomerStore(), costing: new MemoryCostingStore(), postal: new MemoryPostalStore(), reprice: new MemoryRepriceStore(),
    recipients: new MemoryRecipientStore(), reports: new MemoryReportStore(), reference: new MemoryReferenceStore(), jobs: { store, composer } });
});
const get = (url: string) => app.inject({ method: 'GET', url });
const post = (url: string, body?: unknown) => app.inject({ method: 'POST', url, payload: body as object | undefined });

describe('jobs API', () => {
  it('lists newest first and says whether print files can be made here', async () => {
    const r = (await get('/api/jobs')).json();
    expect(r.rows.map((j: JobDetail) => j.id)).toEqual([3, 2, 1]);
    expect(r).toMatchObject({ canCompose: true, composeUnavailable: null });
    composer.reason = 'COMPOSE_OUT_DIR is not set';
    expect((await get('/api/jobs')).json()).toMatchObject({ canCompose: false, composeUnavailable: 'COMPOSE_OUT_DIR is not set' });
  });
  it('searches customer and file name, and filters by status', async () => {
    expect((await get('/api/jobs?search=odevo')).json().rows.map((j: JobDetail) => j.id)).toEqual([2]);
    expect((await get('/api/jobs?status=PDF%20Rejected')).json().rows.map((j: JobDetail) => j.id)).toEqual([3]);
    expect((await get('/api/jobs?limit=1')).json().rows).toHaveLength(1);
  });
  it('refuses a bad status or limit', async () => {
    const a = await get('/api/jobs?status=Done'); expect(a.statusCode).toBe(422); expect(a.json().errors.status).toBeDefined();
    const b = await get('/api/jobs?limit=0'); expect(b.statusCode).toBe(422); expect(b.json().errors.limit).toBeDefined();
  });
  it('gets one job with its batches, or 404', async () => {
    expect((await get('/api/jobs/1')).json()).toMatchObject({ id: 1, batches: [{ batchCode: 7001 }] });
    expect((await get('/api/jobs/99')).statusCode).toBe(404);
    expect((await get('/api/jobs/abc')).statusCode).toBe(404);
  });
});

describe('making print files', () => {
  it('composes a Received job and returns what was made; onlyNew defaults to off', async () => {
    const r = await post('/api/jobs/1/compose');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ batches: [{ batchCode: 7001, files: ['7001_1.pdf'], mrdfFile: null, skipped: null }] });
    expect(composer.calls).toEqual([{ jobId: 1, onlyNew: false }]);
    await post('/api/jobs/1/compose', { onlyNew: true });
    expect(composer.calls[1]).toEqual({ jobId: 1, onlyNew: true });
  });
  it('refuses a job that is not Received, and says why', async () => {
    const r = await post('/api/jobs/2/compose');
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toMatch(/"Awaiting PDF"/);
    expect(composer.calls).toEqual([]);
  });
  it('refuses when the server has no print folder, before touching the job', async () => {
    composer.reason = 'COMPOSE_OUT_DIR is not set';
    const r = await post('/api/jobs/1/compose');
    expect(r.statusCode).toBe(409); expect(r.json().error).toBe('COMPOSE_OUT_DIR is not set'); expect(composer.calls).toEqual([]);
  });
  it('404 for a job that does not exist; 422 for a bad body', async () => {
    expect((await post('/api/jobs/99/compose')).statusCode).toBe(404);
    expect((await post('/api/jobs/1/compose', { onlyNew: 'yes' })).statusCode).toBe(422);
  });
  it('turns a failure into a message the user can read', async () => {
    composer.failWith = 'The PDF "ACME_1.pdf" is not in D:\\processed';
    const r = await post('/api/jobs/1/compose');
    expect(r.statusCode).toBe(409);
    expect(r.json().error).toBe('Could not make the print files for job 1: The PDF "ACME_1.pdf" is not in D:\\processed');
  });
  it('does not run the same job twice at once, and lets it run again afterwards', async () => {
    let release!: () => void;
    composer.gate = new Promise<void>((r) => { release = r; });
    const first = post('/api/jobs/1/compose');
    await new Promise((r) => setTimeout(r, 20));
    const second = await post('/api/jobs/1/compose');
    expect(second.statusCode).toBe(409); expect(second.json().error).toMatch(/already being made/);
    release();
    expect((await first).statusCode).toBe(200);
    expect((await post('/api/jobs/1/compose')).statusCode).toBe(200);
  });
});
