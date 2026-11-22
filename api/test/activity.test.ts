import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ActivityRow } from '../src/activity/types.js';
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

let app: FastifyInstance; let store: MemoryActivityStore; let inbox: MemoryInboxReader; let jobs: MemoryJobStore;
const row = (id: number, o: Partial<ActivityRow> = {}): ActivityRow => ({ id, kind: 'Import' as const, label: `f${id}.xml`, jobId: null, state: 'Done' as const, detail: 'Imported', done: null, total: null, startedAt: '2026-11-22T21:00:00.000Z', updatedAt: '2026-11-22T21:00:20.000Z', finishedAt: '2026-11-22T21:00:20.000Z', stalled: false, ...o });

beforeEach(async () => {
  store = new MemoryActivityStore(); inbox = new MemoryInboxReader(); jobs = new MemoryJobStore();
  app = await buildApp({ settings: new MemorySettingsStore(), customers: new MemoryCustomerStore(), costing: new MemoryCostingStore(), postal: new MemoryPostalStore(), reprice: new MemoryRepriceStore(),
    recipients: new MemoryRecipientStore(), reports: new MemoryReportStore(), reference: new MemoryReferenceStore(), jobs: { store: jobs, composer: new MemoryJobComposer() }, activity: { store, inbox } });
});

describe('GET /api/activity', () => {
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
