import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ActivityRow } from '../src/activity/types.js';
import { estimator, itemSeconds, queueEstimate, remainingSeconds } from '../src/activity/estimate.js';
import { MemoryActivityStore, MemoryInboxReader } from '../src/activity/memoryStore.js';
import { FsInboxReader } from '../src/activity/inbox.js';
import { buildApp } from '../src/app.js';
import { MemoryCostingStore } from '../src/costing/memoryStore.js';
import { MemoryCustomerStore } from '../src/customers/memoryStore.js';
import { MemoryJobComposer, MemoryJobStore } from '../src/jobs/memoryStore.js';
import { MemoryPostalStore } from '../src/postal/memoryStore.js';
import { MemoryRecipientStore } from '../src/recipients/memoryStore.js';
import { MemoryReferenceStore } from '../src/reference/memoryStore.js';
import { MemoryReportStore } from '../src/reports/memoryStore.js';
import { MemoryRepriceStore } from '../src/reprice/memoryStore.js';
import { MemorySettingsStore } from '../src/settings/store.js';

let app: FastifyInstance; let settings: MemorySettingsStore; let store: MemoryActivityStore; let inbox: MemoryInboxReader; let jobs: MemoryJobStore;
const row = (id: number, o: Partial<ActivityRow> = {}): ActivityRow => ({ id, kind: 'Import' as const, label: `f${id}.xml`, jobId: null, state: 'Done' as const, detail: 'Imported', done: null, total: null, startedAt: '2026-11-22T21:00:00.000Z', updatedAt: '2026-11-22T21:00:20.000Z', finishedAt: '2026-11-22T21:00:20.000Z', stalled: false, bytes: null, withPdf: false, ...o });

beforeEach(async () => {
  store = new MemoryActivityStore(); inbox = new MemoryInboxReader(); jobs = new MemoryJobStore();
  app = await buildApp({ settings: (settings = new MemorySettingsStore()), customers: new MemoryCustomerStore(), costing: new MemoryCostingStore(), postal: new MemoryPostalStore(), reprice: new MemoryRepriceStore(),
    recipients: new MemoryRecipientStore(), reports: new MemoryReportStore(), reference: new MemoryReferenceStore(), jobs: { store: jobs, composer: new MemoryJobComposer() }, activity: { store, inbox } });
});

describe('GET /api/activity', () => {
  it('lists as many finished tasks as the setting says', async () => {
    store.rows = Array.from({ length: 60 }, (_, i) => row(i + 1));
    expect((await app.inject({ method: 'GET', url: '/api/activity' })).json().recent).toHaveLength(30);
    settings.values.activityRowsShown = 45;
    expect((await app.inject({ method: 'GET', url: '/api/activity' })).json().recent).toHaveLength(45);
  });
  it('keeps the rows that give a listed job its times even when they are older than the rows shown', async () => {
    jobs.jobs = [{ id: 9, baseName: 'old-job', status: 'Received' } as never];
    store.rows = [row(1, { label: 'old-job.xml' }), ...Array.from({ length: 40 }, (_, i) => row(i + 2, { label: `other${i}.xml` }))];
    const ids = (await app.inject({ method: 'GET', url: '/api/activity' })).json().recent.map((r: { id: number }) => r.id);
    expect(ids).toHaveLength(31);
    expect(ids).toContain(1); // the old import row is kept for the listed job; the other old rows are not
    expect(ids).not.toContain(5);
  });
  it('returns the inbox, what is running, what finished lately and the newest jobs', async () => {
    inbox.items = [{ stem: 'a', xmlName: 'a.xml', xmlBytes: 10, pdfName: null, pdfBytes: null, modifiedAt: '2026-11-22T21:00:00.000Z' }];
    store.rows = [row(1), row(2, { kind: 'Print files', state: 'Running', detail: 'Batch 7 (1 of 3): file 2 of 5 built', done: 0, total: 3 }), row(3, { state: 'Failed', detail: 'Bad XML' })];
    const r = (await app.inject({ method: 'GET', url: '/api/activity' })).json();
    expect(r.inbox).toHaveLength(1);
    expect(r.inboxUnavailable).toBeNull();
    expect(r.running.map((x: { id: number }) => x.id)).toEqual([2]);
    expect(r.recent.map((x: { id: number }) => x.id)).toEqual([3, 1]);   // newest first, running excluded
    expect(r.jobs).toEqual([]);
  });
  it('says whether "Make print files automatically" is on', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/activity' })).json().autoCompose).toBe(false);
    settings.values.autoCompose = true;
    expect((await app.inject({ method: 'GET', url: '/api/activity' })).json().autoCompose).toBe(true);
  });
  it('says why the inbox is missing when WATCH_DIR is not set', async () => {
    inbox.reason = 'WATCH_DIR is not set on the API server';
    expect((await app.inject({ method: 'GET', url: '/api/activity' })).json().inboxUnavailable).toBe('WATCH_DIR is not set on the API server');
  });
});

describe('FsInboxReader', () => {
  const make = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), 'idoc-inbox-')); mkdirSync(join(dir, 'inbox'));
    for (const [n, body] of Object.entries(files)) writeFileSync(join(dir, 'inbox', n), body);
    return new FsInboxReader({ WATCH_DIR: dir });
  };
  it('pairs the XML and PDF of a name, ignoring case and other files, in the watcher\'s order', async () => {
    const r = make({ 'big.xml': 'x'.repeat(100), 'big.pdf': 'p', 'Small.XML': 'x', 'small.pdf': 'p', 'mid.xml': 'x'.repeat(10), 'only.pdf': 'p', 'notes.txt': 'n' });
    const items = await r.list();
    expect(items.map((i) => i.stem.toLowerCase())).toEqual(['small', 'mid', 'big', 'only']);
    expect(items[0]).toMatchObject({ xmlName: 'Small.XML', pdfName: 'small.pdf', xmlBytes: 1 });
    expect(items[1]).toMatchObject({ xmlName: 'mid.xml', pdfName: null });
    expect(items[3]).toMatchObject({ xmlName: null, pdfName: 'only.pdf' });
  });
  it('is empty for an empty or missing inbox, and unavailable without WATCH_DIR', async () => {
    expect(await new FsInboxReader({ WATCH_DIR: join(tmpdir(), 'idoc-does-not-exist') }).list()).toEqual([]);
    const none = new FsInboxReader({});
    expect(none.unavailable()).toMatch(/WATCH_DIR/); expect(await none.list()).toEqual([]);
  });
});

describe('time estimate', () => {
  const sample = (withPdf: boolean, bytes: number, seconds: number) => ({ withPdf, bytes, seconds });
  const item = (stem: string, xml: number | null, pdf: number | null) => ({ stem, xmlName: xml === null ? null : `${stem}.xml`, xmlBytes: xml, pdfName: pdf === null ? null : `${stem}.pdf`, pdfBytes: pdf, modifiedAt: '2026-11-22T21:00:00.000Z' });

  it('says nothing without enough history', () => {
    const e = estimator([sample(true, 1000, 1), sample(true, 1000, 1)]);
    expect(e).toMatchObject({ basedOn: 2, secondsPerByte: null, xmlOnlySeconds: null });
    expect(itemSeconds(e, item('a', 10, 1000))).toBeNull();
    expect(queueEstimate(e, [null, null], [])).toEqual({ basedOn: 2, seconds: null, partial: true });
  });
  it('prices a pair by PDF size and an XML on its own by the average, from the recent jobs', () => {
    const e = estimator([sample(true, 10_000_000, 20), sample(true, 30_000_000, 60), sample(true, 20_000_000, 40), sample(false, 5000, 2), sample(false, 5000, 4), sample(false, 5000, 3)]);
    expect(e.secondsPerByte).toBeCloseTo(2e-6, 9);
    expect(itemSeconds(e, item('p', 100, 50_000_000))).toBe(100);
    expect(itemSeconds(e, item('x', 100, null))).toBe(3);
    expect(itemSeconds(e, item('l', null, 5_000_000))).toBe(10);
  });
  it('estimates what is left of running work from its progress, else from its size, never below zero', () => {
    const e = estimator([sample(true, 10_000_000, 20), sample(true, 30_000_000, 60), sample(true, 20_000_000, 40)]);
    const now = Date.parse('2026-11-22T21:01:00.000Z');
    const run = (o: Partial<ActivityRow>): ActivityRow => ({ ...row(1), state: 'Running', kind: 'PDF check', startedAt: '2026-11-22T21:00:00.000Z', ...o });
    expect(remainingSeconds(e, run({ done: 100, total: 400 }), now)).toBe(180);              // 60 s for a quarter: 180 s more
    expect(remainingSeconds(e, run({ bytes: 50_000_000, withPdf: true }), now)).toBe(40);    // 100 s expected, 60 s gone
    expect(remainingSeconds(e, run({ bytes: 5_000_000, withPdf: true }), now)).toBe(0);      // already over
    expect(remainingSeconds(e, run({ kind: 'Print files' }), now)).toBeNull();
    expect(remainingSeconds(e, run({ stalled: true }), now)).toBeNull();
  });
  it('adds up the queue and says when it is only a minimum', () => {
    const e = estimator([]);
    expect(queueEstimate(e, [30, 90], [20])).toEqual({ basedOn: 0, seconds: 140, partial: false });
    expect(queueEstimate(e, [30, null], [])).toEqual({ basedOn: 0, seconds: 30, partial: true });
    expect(queueEstimate(e, [], [])).toEqual({ basedOn: 0, seconds: 0, partial: false });
  });
  it('puts the estimates in the response', async () => {
    store.sampleRows = [sample(true, 10_000_000, 20), sample(true, 30_000_000, 60), sample(true, 20_000_000, 40), sample(false, 5000, 2), sample(false, 5000, 4), sample(false, 5000, 3)];
    inbox.items = [item('p', 100, 50_000_000), item('x', 100, null)];
    const r = (await app.inject({ method: 'GET', url: '/api/activity' })).json();
    expect(r.inbox.map((f: { estimateSeconds: number }) => f.estimateSeconds)).toEqual([100, 3]);
    expect(r.queue).toEqual({ basedOn: 6, seconds: 103, partial: false });
  });
});
