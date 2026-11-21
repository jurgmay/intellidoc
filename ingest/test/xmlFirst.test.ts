import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readdir, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ingest } from '../src/ingest.js';
import { InMemoryRepository } from '../src/repository.js';
import { fixtureReference } from '../src/fixtureReference.js';
import { FolderWatcher, type Outcome, type WatcherDirs } from '../src/watcher/folderWatcher.js';
import { makeAttachProcessor, makeProcessor } from '../src/watcher/processor.js';
import { PdfWatchdog } from '../src/watcher/pdfWatchdog.js';
import { loadConfig } from '../src/watcher/config.js';
import type { Mailer } from '../src/mail.js';
import { buildXml, FakePdf, type PackSpec } from './helpers.js';

const person = (first: string, surname: string, extra: Partial<PackSpec> = {}): PackSpec => ({ first, surname, lines: [`${first} ${surname}`, '1 High Street', 'Town', 'AB1 2CD'], ...extra });

describe('ingest without a PDF', () => {
  it('saves the job as awaiting its PDF, with the pages the packs expect', async () => {
    const repo = new InMemoryRepository();
    const { xml } = buildXml([person('A', 'B'), person('C', 'D')]);
    const r = await ingest(xml, 'job-1.xml', null, { ref: fixtureReference(), pdf: new FakePdf(0), repo });
    expect(r.persisted).toBe(true);
    expect(r.pdfReceived).toBe(false);
    expect(r.pdfName).toBe('job-1.pdf');
    expect(r.pdfPages).toBe(4);
    expect(repo.tracked[0]!.status).toBe('Awaiting PDF');
  });
  it('still rejects page ranges that overlap or leave gaps', async () => {
    const { xml } = buildXml([person('A', 'B'), person('C', 'D')]);
    const r = await ingest(xml.replace('StartPage="3"', 'StartPage="4"'), 'bad.xml', null, { ref: fixtureReference(), pdf: new FakePdf(0), repo: new InMemoryRepository() });
    expect(r.persisted).toBe(false);
    expect(r.issues.some((i) => /expected 3/.test(i.message))).toBe(true);
  });
});

describe('attaching the PDF later', () => {
  async function setup(pdfPages: number | null = null) {
    const repo = new InMemoryRepository();
    const { xml, pages } = buildXml([person('A', 'B'), person('C', 'D')]);
    await ingest(xml, 'Job-1.xml', null, { ref: fixtureReference(), pdf: new FakePdf(0), repo });
    const sent: string[] = [];
    const attach = makeAttachProcessor({ repo, pdf: new FakePdf(pdfPages ?? pages), notify: async (_t, subject) => { sent.push(subject); } });
    return { repo, attach, sent };
  }
  it('a matching PDF (any case) completes the job', async () => {
    const { repo, attach } = await setup();
    const o = await attach('/in/job-1.PDF');
    expect(o.kind).toBe('processed');
    expect(repo.tracked[0]!.status).toBe('Received');
  });
  it('a PDF with the wrong number of pages is rejected and the job is blocked', async () => {
    const { repo, attach, sent } = await setup(7);
    const o = await attach('/in/job-1.pdf');
    expect(o.kind).toBe('failed');
    expect(repo.tracked[0]!.status).toBe('PDF Rejected');
    expect(sent).toEqual(['IntelliDoc: PDF rejected for job-1']);
  });
  it('a PDF for no waiting job is "unmatched"', async () => {
    const { attach } = await setup();
    expect((await attach('/in/other.pdf')).kind).toBe('unmatched');
  });
  it('tells people when a PDF arrives after an alert', async () => {
    const { repo, attach, sent } = await setup();
    await repo.markAlerted(1);
    await attach('/in/job-1.pdf');
    expect(sent).toEqual(['IntelliDoc: PDF received for job-1']);
  });
});

describe('PdfWatchdog', () => {
  const minute = 60_000;
  async function setup() {
    const repo = new InMemoryRepository(); let t = 1_000_000_000; repo.now = () => t;
    const { xml } = buildXml([person('A', 'B')]);
    await ingest(xml, 'late.xml', null, { ref: fixtureReference(), pdf: new FakePdf(0), repo });
    const mails: { to: string[]; subject: string; text: string }[] = []; let fail = false;
    const mailer: Mailer = { send: async (to, subject, text) => { if (fail) throw new Error('smtp down'); mails.push({ to, subject, text }); } };
    const logs: string[] = [];
    const dog = new PdfWatchdog(repo, mailer, { waitMinutes: 30, reminderMinutes: 30, to: ['ops@example.com'], inbox: '/watch/inbox' }, (l, m) => logs.push(`${l}:${m}`));
    return { repo, dog, mails, logs, advance: (m: number) => { t += m * minute; }, setFail: (f: boolean) => { fail = f; } };
  }
  it('stays quiet before the wait is over, alerts once, then reminds every 30 minutes', async () => {
    const { dog, mails, advance } = await setup();
    advance(29); expect(await dog.check()).toBe(0);
    advance(1); expect(await dog.check()).toBe(1);
    expect(mails[0]!.to).toEqual(['ops@example.com']);
    expect(mails[0]!.subject).toBe('IntelliDoc: PDF missing for late');
    expect(mails[0]!.text).toContain('late.pdf');
    advance(10); expect(await dog.check()).toBe(0);
    advance(20); expect(await dog.check()).toBe(1);
    expect(mails[1]!.subject).toContain('reminder 1');
  });
  it('stops once the PDF has arrived', async () => {
    const { repo, dog, advance } = await setup();
    advance(31); await dog.check();
    await repo.markPdfReceived(1, 2);
    advance(60); expect(await dog.check()).toBe(0);
  });
  it('does not mark a job alerted when the e-mail failed, so it is retried', async () => {
    const { dog, advance, setFail, logs, mails } = await setup();
    advance(31); setFail(true); expect(await dog.check()).toBe(0);
    expect(logs.some((l) => /Could not send/.test(l))).toBe(true);
    setFail(false); expect(await dog.check()).toBe(1); expect(mails).toHaveLength(1);
  });
});

describe('FolderWatcher with XML-first', () => {
  let root: string; let dirs: WatcherDirs; let t: number; let calls: string[];
  const put = async (name: string): Promise<void> => { await writeFile(join(dirs.inbox, name), 'x'); await utimes(join(dirs.inbox, name), 1000, 1000); };
  const ls = async (d: string): Promise<string[]> => (await readdir(d)).sort();
  let attachResult: Outcome | { kind: 'unmatched' };
  const mk = (): FolderWatcher => new FolderWatcher(dirs, {
    process: async (x) => { calls.push(`pair:${x.split(/[\\/]/).pop()}`); return { kind: 'processed', summary: {} }; },
    processXmlOnly: async (x) => { calls.push(`xml:${x.split(/[\\/]/).pop()}`); return { kind: 'processed', summary: { awaitingPdf: true } }; },
    attachPdf: async (p) => { calls.push(`pdf:${p.split(/[\\/]/).pop()}`); return attachResult; },
    log: () => undefined, now: () => t,
  }, { stableMs: 10_000, retryMs: 60_000, orphanWarnMs: 120_000 });
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'idoc-xf-'));
    dirs = { inbox: join(root, 'inbox'), processing: join(root, 'processing'), processed: join(root, 'processed'), duplicates: join(root, 'duplicates'), failed: join(root, 'failed') };
    t = 1_000_000; calls = []; attachResult = { kind: 'processed', summary: { attached: true } };
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });

  it('imports an XML on its own once it has settled, and files it', async () => {
    const w = mk(); await w.init(); await put('a.xml');
    await w.scanOnce(); t += 5_000; await w.scanOnce(); expect(calls).toEqual([]);
    t += 6_000; expect(await w.scanOnce()).toBe(1);
    expect(calls).toEqual(['xml:a.xml']);
    expect(await ls(dirs.inbox)).toEqual([]);
    expect(await ls(dirs.processed)).toEqual(['a.result.json', 'a.xml']);
  });
  it('a late PDF is attached and filed next to the XML', async () => {
    const w = mk(); await w.init(); await put('a.xml');
    await w.scanOnce(); t += 11_000; await w.scanOnce();
    await put('a.pdf'); await w.scanOnce(); t += 11_000; await w.scanOnce();
    expect(calls).toEqual(['xml:a.xml', 'pdf:a.pdf']);
    expect(await ls(dirs.processed)).toEqual(['a.pdf', 'a.pdf.result.json', 'a.result.json', 'a.xml']);
  });
  it('a PDF that fails the check goes to failed/ with the reason', async () => {
    const w = mk(); await w.init(); attachResult = { kind: 'failed', summary: {}, message: 'wrong pages' };
    await put('a.pdf'); await w.scanOnce(); t += 11_000; await w.scanOnce();
    expect(await ls(dirs.failed)).toEqual(['a.pdf', 'a.pdf.error.txt']);
  });
  it('a PDF with no waiting job stays in the inbox and is asked again later, not on every pass', async () => {
    const w = mk(); await w.init(); attachResult = { kind: 'unmatched' };
    await put('a.pdf'); await w.scanOnce(); t += 11_000; await w.scanOnce();
    expect(calls).toEqual(['pdf:a.pdf']); expect(await ls(dirs.inbox)).toEqual(['a.pdf']);
    t += 11_000; await w.scanOnce(); expect(calls).toHaveLength(1);
    t += 60_000; await w.scanOnce(); t += 11_000; await w.scanOnce(); expect(calls).toHaveLength(2);
  });
  it('when the PDF arrives first and the XML follows, they are handled as a pair', async () => {
    const w = mk(); await w.init(); attachResult = { kind: 'unmatched' };
    await put('a.pdf'); await w.scanOnce(); t += 11_000; await w.scanOnce();
    await put('a.xml'); await w.scanOnce(); t += 11_000; await w.scanOnce();
    expect(calls.at(-1)).toBe('pair:a.xml');
    expect(await ls(dirs.processed)).toContain('a.pdf');
  });
  it('both files present at once is still processed as a pair', async () => {
    const w = mk(); await w.init(); await put('a.xml'); await put('a.pdf');
    await w.scanOnce(); t += 11_000; await w.scanOnce();
    expect(calls).toEqual(['pair:a.xml']);
  });
});

describe('XML-first settings', () => {
  const env = { INTELLIDOC_DB: 'Server=x', WATCH_DIR: '/w' };
  it('defaults: on, 30 minutes, reminders as often as the wait, no SMTP', () => {
    const c = loadConfig(env, []);
    expect(c.xmlFirst).toBe(true); expect(c.pdfWaitMinutes).toBe(30); expect(c.pdfReminderMinutes).toBe(30); expect(c.smtp).toBeUndefined(); expect(c.alertTo).toEqual([]);
  });
  it('reads the SMTP and alert settings', () => {
    const c = loadConfig({ ...env, XML_FIRST: '0', PDF_WAIT_MINUTES: '45', SMTP_HOST: 'smtp.office365.com', SMTP_USER: 'a@b.com', SMTP_PASS: 'p', ALERT_TO: 'x@y.com; z@y.com' }, []);
    expect(c.xmlFirst).toBe(false); expect(c.pdfReminderMinutes).toBe(45);
    expect(c.smtp).toMatchObject({ host: 'smtp.office365.com', port: 587, secure: false, from: 'a@b.com' });
    expect(c.alertTo).toEqual(['x@y.com', 'z@y.com']);
  });
});

describe('processor without a PDF', () => {
  it('imports from the XML alone', async () => {
    const root2 = await mkdtemp(join(tmpdir(), 'idoc-xf2-'));
    const f = join(root2, 'p.xml'); await writeFile(f, buildXml([person('A', 'B')]).xml);
    const repo = new InMemoryRepository();
    const o = await makeProcessor({ loadReference: async () => fixtureReference(), repo, pdf: new FakePdf(0) })(f, null);
    expect(o.kind).toBe('processed'); expect(repo.tracked[0]!.status).toBe('Awaiting PDF');
    await rm(root2, { recursive: true, force: true });
  });
});
