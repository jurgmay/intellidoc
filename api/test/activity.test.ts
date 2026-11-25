import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ActivityRow } from '../src/activity/types.js';
import { MemoryActivityStore, MemoryInboxReader } from '../src/activity/memoryStore.js';
import { FsInboxReader, failedPrefix } from '../src/activity/inbox.js';
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
    store.rows = [row(1), row(2, { kind: 'Print files', state: 'Running', detail: 'Processing batch 1 of 3. Built file 2 of 5', done: 0, total: 3 }), row(3, { state: 'Failed', detail: 'Bad XML' })];
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

describe('retrying a failed row', () => {
  const failed = (id: number, o: Partial<ActivityRow> = {}) => row(id, { state: 'Failed', detail: 'Bad XML', ...o });
  const post = (id: number | string, what: 'retry' | 'dismiss') => app.inject({ method: 'POST', url: `/api/activity/${id}/${what}` });

  it('puts a failed import back with its PDF and takes the failed row off the list', async () => {
    store.rows = [failed(3, { label: 'a.xml' })]; inbox.failedHas = ['a.xml'];
    const r = await post(3, 'retry');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ restored: ['a.xml'] });
    expect(inbox.restored).toEqual([{ name: 'a.xml', withPartner: true }]);
    expect(store.rows[0]!.state).toBe('Abandoned');
    expect((await app.inject({ method: 'GET', url: '/api/activity' })).json().recent.find((x: { id: number }) => x.id === 3).state).toBe('Abandoned');
  });
  it('puts only the PDF back for a failed PDF check', async () => {
    store.rows = [failed(4, { kind: 'PDF check', label: 'b.pdf' })]; inbox.failedHas = ['b.pdf'];
    expect((await post(4, 'retry')).statusCode).toBe(200);
    expect(inbox.restored).toEqual([{ name: 'b.pdf', withPartner: false }]);
  });
  it('leaves the row alone when the files cannot be found', async () => {
    store.rows = [failed(5, { label: 'gone.xml' })];
    const r = await post(5, 'retry');
    expect(r.statusCode).toBe(409);
    expect(r.json().error ?? r.json().message).toMatch(/not in the failed folder/);
    expect(store.rows[0]!.state).toBe('Failed');
  });
  it('says why when the watch folder is not set', async () => {
    store.rows = [failed(6)]; inbox.reason = 'WATCH_DIR is not set';
    expect((await post(6, 'retry')).statusCode).toBe(409);
    expect(store.rows[0]!.state).toBe('Failed');
  });
  it('refuses rows that are not failed, print files rows and unknown rows', async () => {
    store.rows = [row(1), failed(2, { kind: 'Print files', label: 'Job 7: j7.pdf', jobId: 7 })];
    expect((await post(1, 'retry')).statusCode).toBe(409);
    expect((await post(2, 'retry')).statusCode).toBe(409);
    expect((await post(99, 'retry')).statusCode).toBe(404);
    expect((await post('x', 'retry')).statusCode).toBe(404);
    expect((await post(1, 'dismiss')).statusCode).toBe(409);
  });
  it('dismisses a failed print files row once its print files are made again', async () => {
    store.rows = [failed(2, { kind: 'Print files', label: 'Job 7: j7.pdf', jobId: 7 })];
    expect((await post(2, 'dismiss')).statusCode).toBe(200);
    expect(store.rows[0]!.state).toBe('Abandoned');
  });
});

describe('FsInboxReader.restoreFailed', () => {
  const make = (failedFiles: string[], inboxFiles: string[] = []) => {
    const dir = mkdtempSync(join(tmpdir(), 'idoc-failed-')); mkdirSync(join(dir, 'inbox')); mkdirSync(join(dir, 'failed'));
    for (const n of failedFiles) writeFileSync(join(dir, 'failed', n), n);
    for (const n of inboxFiles) writeFileSync(join(dir, 'inbox', n), n);
    return { dir, reader: new FsInboxReader({ WATCH_DIR: dir }) };
  };
  it('moves the XML and the PDF filed with it back to the inbox under their own names, leaving the error note', async () => {
    const { dir, reader } = make(['job.xml', 'job.pdf', 'job.error.txt']);
    expect(await reader.restoreFailed('job.xml', true)).toEqual(['job.xml', 'job.pdf']);
    expect(existsSync(join(dir, 'inbox', 'job.xml')) && existsSync(join(dir, 'inbox', 'job.pdf'))).toBe(true);
    expect(existsSync(join(dir, 'failed', 'job.xml'))).toBe(false);
    expect(existsSync(join(dir, 'failed', 'job.error.txt'))).toBe(true);
  });
  it('takes the newest failure when the name has failed before, with the PDF from the same failure', async () => {
    const { dir, reader } = make(['job.xml', 'job.pdf', '20261124101010_job.xml', '20261124101010_job.pdf', '20261125090000_job.xml', '20261125090000_job.pdf']);
    expect(await reader.restoreFailed('job.xml', true)).toEqual(['job.xml', 'job.pdf']);
    expect(existsSync(join(dir, 'failed', '20261125090000_job.xml'))).toBe(false);
    expect(existsSync(join(dir, 'failed', '20261124101010_job.xml'))).toBe(true);
    expect(existsSync(join(dir, 'failed', 'job.xml'))).toBe(true);
  });
  it('returns only the XML when there is no PDF, and only the PDF for a PDF check', async () => {
    const a = make(['solo.xml']);
    expect(await a.reader.restoreFailed('solo.xml', true)).toEqual(['solo.xml']);
    const b = make(['p.xml', 'p.pdf']);
    expect(await b.reader.restoreFailed('p.pdf', false)).toEqual(['p.pdf']);
    expect(existsSync(join(b.dir, 'failed', 'p.xml'))).toBe(true);
  });
  it('refuses when nothing is there or the inbox already has the name, and moves nothing', async () => {
    await expect(make([]).reader.restoreFailed('x.xml', true)).rejects.toThrow(/not in the failed folder/);
    const { dir, reader } = make(['job.xml', 'job.pdf'], ['job.pdf']);
    await expect(reader.restoreFailed('job.xml', true)).rejects.toThrow(/job\.pdf is already in the inbox/);
    expect(existsSync(join(dir, 'failed', 'job.xml'))).toBe(true);
    await expect(new FsInboxReader({}).restoreFailed('x.xml', true)).rejects.toThrow(/WATCH_DIR/);
  });
  it('finds the newest prefixed copy, ignoring case', () => {
    expect(failedPrefix(['A.XML'], 'a.xml')).toBe('');
    expect(failedPrefix(['A.XML', '20261125090000-1_a.xml', '20261125090000_a.xml'], 'a.xml')).toBe('20261125090000-1_');
    expect(failedPrefix(['other.xml'], 'a.xml')).toBeNull();
  });
});

describe('no time estimates', () => {
  it('the response carries no estimate of how long the inbox or running work will take', async () => {
    inbox.items = [{ stem: 'p', xmlName: 'p.xml', xmlBytes: 100, pdfName: 'p.pdf', pdfBytes: 50_000_000, modifiedAt: '2026-11-22T21:00:00.000Z' }];
    store.rows = [row(1, { kind: 'PDF check', state: 'Running', done: 100, total: 400, finishedAt: null })];
    const r = (await app.inject({ method: 'GET', url: '/api/activity' })).json();
    expect(r).not.toHaveProperty('queue');
    expect(r.inbox[0]).not.toHaveProperty('estimateSeconds');
    expect(r.running[0]).not.toHaveProperty('remainingSeconds');
  });
});
