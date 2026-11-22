import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FolderWatcher, type Outcome, type WatcherDirs } from '../src/watcher/folderWatcher.js';
import { makeProcessor, isTransient, decodeXml } from '../src/watcher/processor.js';
import { loadConfig, ConfigError } from '../src/watcher/config.js';
import { InMemoryRepository } from '../src/repository.js';
import { fixtureReference } from '../src/fixtureReference.js';
import { buildXml, FakePdf, type PackSpec } from './helpers.js';

let root: string; let dirs: WatcherDirs; let t: number; let logs: string[]; let calls: string[]; let next: Outcome;
const opts = { stableMs: 10_000, retryMs: 60_000, orphanWarnMs: 120_000 };
const mk = (dryRun = false): FolderWatcher => new FolderWatcher(dirs, {
  process: async (x) => { calls.push(x); if (next.kind === 'failed' && next.message === 'THROW') throw new Error('boom'); return next; },
  log: (l, m) => { logs.push(`${l}:${m}`); }, now: () => t,
}, { ...opts, dryRun });
const ls = async (d: string): Promise<string[]> => (await readdir(d)).sort();
const put = async (name: string, body = 'x'): Promise<void> => { await writeFile(join(dirs.inbox, name), body); await utimes(join(dirs.inbox, name), 1000, 1000); };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'idoc-watch-'));
  dirs = { inbox: join(root, 'inbox'), processing: join(root, 'processing'), processed: join(root, 'processed'), duplicates: join(root, 'duplicates'), failed: join(root, 'failed') };
  t = 1_000_000; logs = []; calls = []; next = { kind: 'processed', summary: { ok: 1 } };
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe('FolderWatcher', () => {
  it('waits until both files have been unchanged for stableMs, then processes and files the pair', async () => {
    const w = mk(); await w.init();
    await put('a.xml'); await put('a.pdf');
    expect(await w.scanOnce()).toBe(0);            // first sighting
    t += 5_000; expect(await w.scanOnce()).toBe(0); // not yet stable
    expect(calls).toHaveLength(0);
    t += 6_000; expect(await w.scanOnce()).toBe(1);
    expect(calls).toHaveLength(1);
    expect(await ls(dirs.inbox)).toEqual([]);
    expect(await ls(dirs.processed)).toEqual(['a.pdf', 'a.result.json', 'a.xml']);
    expect(JSON.parse(await readFile(join(dirs.processed, 'a.result.json'), 'utf8'))).toEqual({ ok: 1 });
    expect(await ls(dirs.processing)).toEqual([]);
  });
  it('handles the smallest XML first, whatever the names, and a lone PDF after the XML files', async () => {
    const w = mk(); await w.init();
    await put('a-big.xml', 'x'.repeat(500)); await put('a-big.pdf');
    await put('z-small.xml', 'x'.repeat(5)); await put('z-small.pdf');
    await put('m-mid.xml', 'x'.repeat(50)); await put('m-mid.pdf');
    await w.scanOnce(); t += 11_000;
    expect(await w.scanOnce()).toBe(3);
    expect(calls.map((c) => c.split(/[\\/]/).pop())).toEqual(['z-small.xml', 'm-mid.xml', 'a-big.xml']);
  });
  it('breaks a tie in XML size by name', async () => {
    const w = mk(); await w.init();
    await put('b.xml', 'xx'); await put('b.pdf'); await put('a.xml', 'xx'); await put('a.pdf');
    await w.scanOnce(); t += 11_000; await w.scanOnce();
    expect(calls.map((c) => c.split(/[\\/]/).pop())).toEqual(['a.xml', 'b.xml']);
  });
  it('a file that is still growing resets the clock', async () => {
    const w = mk(); await w.init();
    await put('a.xml'); await put('a.pdf');
    await w.scanOnce(); t += 9_000; await w.scanOnce();
    await writeFile(join(dirs.inbox, 'a.pdf'), 'longer now'); // copy still in progress
    t += 9_000; expect(await w.scanOnce()).toBe(0);
    t += 11_000; expect(await w.scanOnce()).toBe(1);
  });
  it('pairs by file stem ignoring case', async () => {
    const w = mk(); await w.init();
    await put('Job-1.XML'); await put('job-1.pdf');
    await w.scanOnce(); t += 11_000;
    expect(await w.scanOnce()).toBe(1);
    expect(await ls(dirs.processed)).toContain('Job-1.XML');
  });
  it('never processes a lone file, warns once it has waited long enough, and ignores other file types', async () => {
    const w = mk(); await w.init();
    await put('only.xml'); await put('notes.txt');
    await w.scanOnce(); t += 130_000; await w.scanOnce(); t += 1_000; await w.scanOnce();
    expect(calls).toHaveLength(0);
    expect(logs.filter((l) => /no matching PDF/.test(l))).toHaveLength(1);
    expect(await ls(dirs.inbox)).toEqual(['notes.txt', 'only.xml']);
    await put('only.pdf'); await w.scanOnce(); t += 11_000;
    expect(await w.scanOnce()).toBe(1);
  });
  it('failed outcome goes to failed/ with an error.txt; a thrown error does too', async () => {
    const w = mk(); await w.init();
    next = { kind: 'failed', summary: { packs: 0 }, message: '2 error(s), nothing was saved' };
    await put('a.xml'); await put('a.pdf'); await w.scanOnce(); t += 11_000; await w.scanOnce();
    expect(await ls(dirs.failed)).toEqual(['a.error.txt', 'a.pdf', 'a.xml']);
    expect(await readFile(join(dirs.failed, 'a.error.txt'), 'utf8')).toContain('nothing was saved');
    next = { kind: 'failed', summary: {}, message: 'THROW' };
    await put('b.xml'); await put('b.pdf'); await w.scanOnce(); t += 11_000; await w.scanOnce();
    expect(await readFile(join(dirs.failed, 'b.error.txt'), 'utf8')).toContain('boom');
  });
  it('duplicate outcome goes to duplicates/', async () => {
    const w = mk(); await w.init(); next = { kind: 'duplicate', summary: { d: 1 } };
    await put('a.xml'); await put('a.pdf'); await w.scanOnce(); t += 11_000; await w.scanOnce();
    expect(await ls(dirs.duplicates)).toEqual(['a.pdf', 'a.result.json', 'a.xml']);
  });
  it('retry outcome puts the files back and does not try again before retryMs', async () => {
    const w = mk(); await w.init(); next = { kind: 'retry', message: 'Database not available' };
    await put('a.xml'); await put('a.pdf'); await w.scanOnce(); t += 11_000; await w.scanOnce();
    expect(calls).toHaveLength(1);
    expect(await ls(dirs.inbox)).toEqual(['a.pdf', 'a.xml']);
    t += 30_000; await w.scanOnce(); t += 11_000; await w.scanOnce(); expect(calls).toHaveLength(1);
    next = { kind: 'processed', summary: {} };
    t += 30_000; await w.scanOnce(); t += 11_000; await w.scanOnce();
    expect(calls).toHaveLength(2);
    expect(await ls(dirs.processed)).toContain('a.xml');
  });
  it('init() returns files a crashed run left in processing/ to the inbox', async () => {
    const w = mk(); await w.init();
    await writeFile(join(dirs.processing, 'c.xml'), 'x'); await writeFile(join(dirs.processing, 'c.pdf'), 'x');
    await w.init();
    expect(await ls(dirs.inbox)).toEqual(['c.pdf', 'c.xml']); expect(await ls(dirs.processing)).toEqual([]);
  });
  it('a name clash in the destination never overwrites; the pair stays aligned', async () => {
    const w = mk(); await w.init();
    for (let i = 0; i < 2; i++) { await put('a.xml', `v${i}`); await put('a.pdf', `v${i}`); await w.scanOnce(); t += 11_000; await w.scanOnce(); }
    const files = await ls(dirs.processed);
    expect(files.filter((f) => f.endsWith('.xml'))).toHaveLength(2);
    const prefixed = files.filter((f) => f.endsWith('_a.xml'))[0]!;
    expect(files).toContain(prefixed.replace('.xml', '.pdf'));
    expect(files).toContain(prefixed.replace('.xml', '.result.json'));
  });
  it('dry run leaves files in the inbox and handles each pair once', async () => {
    const w = mk(true); await w.init();
    await put('a.xml'); await put('a.pdf'); await w.scanOnce(); t += 11_000;
    await w.scanOnce(); t += 11_000; await w.scanOnce();
    expect(calls).toHaveLength(1);
    expect(await ls(dirs.inbox)).toEqual(['a.pdf', 'a.xml']);
    expect(await ls(dirs.processed)).toEqual([]);
    expect(w.waiting()).toBe(0);
  });
  it('handles several pairs one at a time, in name order', async () => {
    const w = mk(); await w.init();
    for (const n of ['b', 'a', 'c']) { await put(`${n}.xml`); await put(`${n}.pdf`); }
    await w.scanOnce(); t += 11_000;
    expect(await w.scanOnce()).toBe(3);
    expect(calls.map((c) => c.split(/[\\/]/).pop())).toEqual(['a.xml', 'b.xml', 'c.xml']);
  });
});

describe('processor', () => {
  const person = (first: string, surname: string, extra: Partial<PackSpec> = {}): PackSpec => ({ first, surname, lines: [`${first} ${surname}`, '1 High Street', 'Town', 'AB1 2CD'], ...extra });
  async function runWith(specs: PackSpec[], opt: { repo?: InMemoryRepository; pdfPages?: number; bom?: boolean } = {}): Promise<Outcome> {
    const { xml, pages } = buildXml(specs);
    const f = join(root, 'p.xml'); await writeFile(f, opt.bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(xml)]) : xml);
    const repo = opt.repo ?? new InMemoryRepository();
    return makeProcessor({ loadReference: async () => fixtureReference(), repo, pdf: new FakePdf(opt.pdfPages ?? pages) })(f, join(root, 'p.pdf'));
  }
  it('processed: summary describes mailpieces and batches', async () => {
    const o = await runWith([person('A', 'B'), person('A', 'B'), person('C', 'D')]);
    expect(o.kind).toBe('processed');
    const s = (o as { summary: { mailpieces: number; mergedMailpieces: number; batches: unknown[] } }).summary;
    expect(s).toMatchObject({ mailpieces: 2, mergedMailpieces: 1 }); expect(s.batches).toHaveLength(1);
  });
  it('page mismatch fails with a readable message', async () => {
    const o = await runWith([person('A', 'B')], { pdfPages: 9 });
    expect(o.kind).toBe('failed'); expect((o as { message: string }).message).toMatch(/PDF has 9/);
  });
  it('every pack already stored => duplicate', async () => {
    const repo = new InMemoryRepository(); const spec = [person('A', 'B', { guid: '11111111-1111-4111-8111-111111111111' })];
    expect((await runWith(spec, { repo })).kind).toBe('processed');
    expect((await runWith(spec, { repo })).kind).toBe('duplicate');
  });
  it('database connection problems are retried, other errors are not', async () => {
    const { xml } = buildXml([person('A', 'B')]); const f = join(root, 'q.xml'); await writeFile(f, xml);
    const mkProc = (err: Error) => makeProcessor({ loadReference: async () => { throw err; }, repo: new InMemoryRepository(), pdf: new FakePdf(2) });
    expect((await mkProc(Object.assign(new Error('Failed to connect to host'), { code: 'ESOCKET' }))(f, 'x.pdf')).kind).toBe('retry');
    expect((await mkProc(new Error('Invalid column name'))(f, 'x.pdf')).kind).toBe('failed');
    expect(isTransient(Object.assign(new Error('x'), { code: 'ETIMEOUT' }))).toBe(true);
    expect(isTransient(new Error('Violation of UNIQUE KEY constraint'))).toBe(false);
  });
  it('a malformed or non-v6 file fails; a UTF-8 BOM is accepted', async () => {
    expect((await runWith([person('A', 'B')], { bom: true })).kind).toBe('processed');
    const f = join(root, 'bad.xml'); await writeFile(f, '<Packs xmlns="http://www.h-pod.co.uk/export/5" Version="5"/>');
    const o = await makeProcessor({ loadReference: async () => fixtureReference(), repo: new InMemoryRepository(), pdf: new FakePdf(1) })(f, 'x.pdf');
    expect(o.kind).toBe('failed');
    expect(decodeXml(Buffer.from('﻿<a/>', 'utf16le'))).toBe('<a/>');
  });
});

describe('config', () => {
  const env = { INTELLIDOC_DB: 'Server=x', WATCH_DIR: root ?? '/tmp/w' };
  it('reads settings and defaults', () => {
    const c = loadConfig({ ...env, STABLE_SECONDS: '3' }, ['--dry-run']);
    expect(c.stableMs).toBe(3000); expect(c.pollMs).toBe(5000); expect(c.dryRun).toBe(true); expect(c.pdfEngine).toBe('auto');
    expect(c.dirs.inbox.replace(/\\/g, '/')).toMatch(/\/inbox$/);
  });
  it('rejects missing or bad settings', () => {
    expect(() => loadConfig({ WATCH_DIR: '/x' }, [])).toThrow(ConfigError);
    expect(() => loadConfig({ ...env, PDF_ENGINE: 'nope' }, [])).toThrow(ConfigError);
    expect(() => loadConfig({ ...env, POLL_SECONDS: '-1' }, [])).toThrow(ConfigError);
  });
});
