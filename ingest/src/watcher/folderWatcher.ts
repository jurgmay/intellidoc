import { mkdir, readdir, rename, stat, writeFile, access } from 'node:fs/promises';
import { basename, join, parse } from 'node:path';

export interface WatcherDirs { inbox: string; processing: string; processed: string; duplicates: string; failed: string }

export type Outcome =
  | { kind: 'processed' | 'duplicate'; summary: unknown }
  | { kind: 'failed'; summary: unknown; message: string }
  /** Temporary problem (e.g. database unreachable): the files go back to the inbox and are retried later. */
  | { kind: 'retry'; message: string };

export interface WatcherDeps {
  process(xmlPath: string, pdfPath: string): Promise<Outcome>;
  /** XML-first import: when given, an XML whose PDF has not arrived is imported on its own (job status 'Awaiting PDF'). */
  processXmlOnly?(xmlPath: string): Promise<Outcome>;
  /** XML-first import: when given, a PDF with no XML beside it is offered to jobs waiting for their PDF. 'unmatched' = no such job (yet). */
  attachPdf?(pdfPath: string): Promise<Outcome | { kind: 'unmatched' }>;
  /** Checked on every pass; false = wait for the pair even if processXmlOnly/attachPdf are given. Defaults to true. */
  xmlFirstEnabled?(): boolean;
  log(level: 'info' | 'warn' | 'error', msg: string): void;
  now(): number;
}
export interface WatcherOptions {
  /** A pair is only picked up when both files have been unchanged for this long (copy finished). */
  stableMs: number;
  retryMs: number;
  orphanWarnMs: number;
  /** Process files where they are, move nothing, and handle each pair only once. */
  dryRun?: boolean;
}

interface Seen { sig: string; since: number }

const exists = async (p: string): Promise<boolean> => access(p).then(() => true, () => false);

/**
 * Watches an inbox for <name>.xml + <name>.pdf pairs (same file stem, any case).
 * Polling is deliberate: fs.watch is unreliable on network shares and while large files are still being copied.
 * Folders: inbox -> processing (claimed) -> processed | duplicates | failed. Nothing is ever deleted.
 */
export class FolderWatcher {
  private seen = new Map<string, Seen>();
  private notBefore = new Map<string, number>();
  /** A lone PDF no waiting job wanted: ask again after this time (does not delay a pair if the XML turns up). */
  private unmatchedUntil = new Map<string, number>();
  private orphanLogged = new Map<string, number>();
  private orphanSince = new Map<string, number>();
  private handledDry = new Set<string>();

  constructor(readonly dirs: WatcherDirs, private readonly deps: WatcherDeps, private readonly opts: WatcherOptions) {}

  /** Create folders and put back anything a crashed run left in processing/ (the DB save is transactional, so retrying is safe). */
  async init(): Promise<void> {
    for (const d of Object.values(this.dirs)) await mkdir(d, { recursive: true });
    for (const f of await readdir(this.dirs.processing)) {
      await rename(join(this.dirs.processing, f), await this.freeName(this.dirs.inbox, f));
      this.deps.log('warn', `Recovered ${f} from processing/ back to inbox`);
    }
  }

  /** One pass over the inbox. Returns the number of pairs handled. Files are handled strictly one pair at a time, smallest XML first. */
  async scanOnce(): Promise<number> {
    const now = this.deps.now();
    const entries = await readdir(this.dirs.inbox, { withFileTypes: true });
    const stems = new Map<string, { xml?: string; pdf?: string }>();
    for (const e of entries) {
      if (!e.isFile()) continue;
      const { name, ext } = parse(e.name);
      const kind = ext.toLowerCase() === '.xml' ? 'xml' : ext.toLowerCase() === '.pdf' ? 'pdf' : null;
      if (!kind) continue;
      const k = name.toLowerCase();
      const s = stems.get(k) ?? {};
      s[kind] = e.name;
      stems.set(k, s);
    }
    for (const k of [...this.seen.keys()]) if (!stems.has(k)) this.seen.delete(k);

    let handled = 0;
    for (const k of [...this.orphanSince.keys()]) { const f = stems.get(k); if (!f || (f.xml && f.pdf)) this.orphanSince.delete(k); }
    // Smallest XML first: a small XML usually means a small PDF, so the quickest jobs reach production first and one huge PDF does not hold
    // the rest up. Ties go by name. A lone PDF (waiting for its XML, or attaching to a job already imported) goes after the XML files.
    const size = new Map<string, number>();
    for (const [stem, f] of stems) {
      let n = Number.POSITIVE_INFINITY;
      if (f.xml) { try { n = (await stat(join(this.dirs.inbox, f.xml))).size; } catch { /* vanished: it sorts last and is skipped below */ } }
      size.set(stem, n);
    }
    for (const [stem, f] of [...stems].sort((a, b) => (size.get(a[0])! === size.get(b[0])! ? a[0].localeCompare(b[0]) : size.get(a[0])! < size.get(b[0])! ? -1 : 1))) {
      if (!f.xml || !f.pdf) {
        const lone = f.xml ?? f.pdf!;
        const on = this.deps.xmlFirstEnabled ? this.deps.xmlFirstEnabled() : true;
        const single = !on ? undefined : f.xml ? this.deps.processXmlOnly : this.opts.dryRun ? undefined : this.deps.attachPdf;
        if (!single) { this.noteOrphan(stem, lone, now); continue; }
        if ((this.notBefore.get(stem) ?? 0) > now || (this.unmatchedUntil.get(stem) ?? 0) > now) continue;
        let sig1: string;
        try { const st = await stat(join(this.dirs.inbox, lone)); sig1 = `${st.size}:${st.mtimeMs}`; } catch { continue; }
        const prev1 = this.seen.get(stem);
        if (!prev1 || prev1.sig !== sig1) { this.seen.set(stem, { sig: sig1, since: now }); continue; }
        if (now - prev1.since < this.opts.stableMs) continue;
        if (this.opts.dryRun) {
          if (this.handledDry.has(`${stem}|${sig1}`)) continue;
          this.handledDry.add(`${stem}|${sig1}`);
          const o = await this.runXmlOnlySafely(join(this.dirs.inbox, lone));
          this.deps.log(o.kind === 'failed' ? 'error' : 'info', `[dry-run] ${lone} (no PDF yet): ${o.kind}${'message' in o ? ` - ${o.message}` : ''}`);
          handled++;
          continue;
        }
        if (await this.handleSingle(stem, lone, f.xml ? 'xml' : 'pdf')) handled++;
        continue;
      }
      if ((this.notBefore.get(stem) ?? 0) > now) continue;
      const xmlPath = join(this.dirs.inbox, f.xml);
      const pdfPath = join(this.dirs.inbox, f.pdf);
      let sig: string;
      try {
        const [sx, sp] = await Promise.all([stat(xmlPath), stat(pdfPath)]);
        sig = `${sx.size}:${sx.mtimeMs}|${sp.size}:${sp.mtimeMs}`;
      } catch { continue; } // vanished between readdir and stat
      const prev = this.seen.get(stem);
      if (!prev || prev.sig !== sig) { this.seen.set(stem, { sig, since: now }); continue; }
      if (now - prev.since < this.opts.stableMs) continue;
      if (this.opts.dryRun) {
        if (this.handledDry.has(`${stem}|${sig}`)) continue;
        this.handledDry.add(`${stem}|${sig}`);
        this.deps.log('info', `[dry-run] ${f.xml}`);
        const o = await this.runSafely(xmlPath, pdfPath);
        this.deps.log(o.kind === 'failed' ? 'error' : 'info', `[dry-run] ${f.xml}: ${o.kind}${'message' in o ? ` - ${o.message}` : ''}`);
        this.deps.log('info', JSON.stringify('summary' in o ? o.summary : {}));
        handled++;
        continue;
      }
      if (await this.handlePair(stem, f.xml, f.pdf)) handled++;
    }
    return handled;
  }

  /** Pairs seen but not yet handled (still settling). Used by --once to know when to stop. */
  waiting(): number {
    let n = 0;
    for (const [stem, v] of this.seen) if (!(this.opts.dryRun && this.handledDry.has(`${stem}|${v.sig}`))) n++;
    return n;
  }

  /** Poll until aborted. Errors in one pass never stop the loop. */
  async run(intervalMs: number, signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try { await this.scanOnce(); } catch (e) { this.deps.log('error', `Scan failed: ${(e as Error).message}`); }
      await new Promise<void>((res) => {
        const t = setTimeout(res, intervalMs);
        signal.addEventListener('abort', () => { clearTimeout(t); res(); }, { once: true });
      });
    }
  }

  private noteOrphan(stem: string, file: string, now: number): void {
    const prev = this.orphanSince.get(stem);
    if (prev === undefined) { this.orphanSince.set(stem, now); return; }
    const last = this.orphanLogged.get(stem) ?? 0;
    if (now - prev >= this.opts.orphanWarnMs && now - last >= this.opts.orphanWarnMs) {
      this.orphanLogged.set(stem, now);
      this.deps.log('warn', `${file} has no matching ${file.toLowerCase().endsWith('.xml') ? 'PDF' : 'XML'}; waiting`);
    }
  }

  private async runSafely(xmlPath: string, pdfPath: string): Promise<Outcome> {
    try { return await this.deps.process(xmlPath, pdfPath); } catch (e) {
      return { kind: 'failed', summary: {}, message: `Unexpected error: ${(e as Error).stack ?? (e as Error).message}` };
    }
  }

  private async runXmlOnlySafely(xmlPath: string): Promise<Outcome> {
    try { return await this.deps.processXmlOnly!(xmlPath); } catch (e) {
      return { kind: 'failed', summary: {}, message: `Unexpected error: ${(e as Error).stack ?? (e as Error).message}` };
    }
  }

  /** A file on its own: an XML (imported without its PDF) or a PDF (attached to a job that is waiting for it). */
  private async handleSingle(stem: string, name: string, kind: 'xml' | 'pdf'): Promise<boolean> {
    const claimed = join(this.dirs.processing, name);
    if (await exists(claimed)) { this.deps.log('warn', `${name}: name clash in processing/, skipping`); return false; }
    try { await rename(join(this.dirs.inbox, name), claimed); } catch (e) {
      this.deps.log('info', `${name} not ready (${(e as NodeJS.ErrnoException).code ?? 'busy'})`); this.seen.delete(stem); return false;
    }
    this.deps.log('info', kind === 'xml' ? `Processing ${name} (no PDF yet)` : `Checking ${name} against the job waiting for it`);
    let outcome: Outcome | { kind: 'unmatched' };
    try { outcome = kind === 'xml' ? await this.deps.processXmlOnly!(claimed) : await this.deps.attachPdf!(claimed); } catch (e) {
      outcome = { kind: 'failed', summary: {}, message: `Unexpected error: ${(e as Error).stack ?? (e as Error).message}` };
    }
    this.seen.delete(stem);
    if (outcome.kind === 'retry' || outcome.kind === 'unmatched') {
      await rename(claimed, await this.freeName(this.dirs.inbox, name));
      (outcome.kind === 'retry' ? this.notBefore : this.unmatchedUntil).set(stem, this.deps.now() + this.opts.retryMs);
      if (outcome.kind === 'retry') this.deps.log('warn', `${name}: ${outcome.message}; will retry in ${Math.round(this.opts.retryMs / 1000)}s`);
      else this.noteOrphan(stem, name, this.deps.now());
      return outcome.kind === 'retry';
    }
    const dest = outcome.kind === 'processed' ? this.dirs.processed : outcome.kind === 'duplicate' ? this.dirs.duplicates : this.dirs.failed;
    const final = await this.freeName(dest, name);
    await rename(claimed, final);
    const prefix = basename(final).slice(0, basename(final).length - name.length);
    const label = kind === 'pdf' ? 'pdf' : '';
    const note = join(dest, `${prefix}${parse(name).name}${label ? '.pdf' : ''}.${outcome.kind === 'failed' ? 'error.txt' : 'result.json'}`);
    await writeFile(note, outcome.kind === 'failed'
      ? `${outcome.message}\n\n${JSON.stringify(outcome.summary, null, 2)}\n`
      : `${JSON.stringify(outcome.summary, null, 2)}\n`, 'utf8');
    this.deps.log(outcome.kind === 'failed' ? 'error' : 'info', `${name}: ${outcome.kind}${outcome.kind === 'failed' ? ` - ${outcome.message.split('\n')[0]}` : ''}`);
    return true;
  }

  private async handlePair(stem: string, xml: string, pdf: string): Promise<boolean> {
    // Claim by renaming into processing/. A rename fails while another program still holds the file open (Windows),
    // which doubles as a "copy finished" check.
    const claimedXml = join(this.dirs.processing, xml);
    const claimedPdf = join(this.dirs.processing, pdf);
    if (await exists(claimedXml) || await exists(claimedPdf)) { this.deps.log('warn', `${xml}: name clash in processing/, skipping`); return false; }
    try {
      await rename(join(this.dirs.inbox, xml), claimedXml);
    } catch (e) { this.deps.log('info', `${xml} not ready (${(e as NodeJS.ErrnoException).code ?? 'busy'})`); this.seen.delete(stem); return false; }
    try {
      await rename(join(this.dirs.inbox, pdf), claimedPdf);
    } catch (e) {
      await rename(claimedXml, join(this.dirs.inbox, xml));
      this.deps.log('info', `${pdf} not ready (${(e as NodeJS.ErrnoException).code ?? 'busy'})`);
      this.seen.delete(stem);
      return false;
    }

    this.deps.log('info', `Processing ${xml}`);
    const outcome = await this.runSafely(claimedXml, claimedPdf);

    if (outcome.kind === 'retry') {
      await rename(claimedXml, await this.freeName(this.dirs.inbox, xml));
      await rename(claimedPdf, await this.freeName(this.dirs.inbox, pdf));
      this.notBefore.set(stem, this.deps.now() + this.opts.retryMs);
      this.seen.delete(stem);
      this.deps.log('warn', `${xml}: ${outcome.message}; will retry in ${Math.round(this.opts.retryMs / 1000)}s`);
      return true;
    }
    const dest = outcome.kind === 'processed' ? this.dirs.processed : outcome.kind === 'duplicate' ? this.dirs.duplicates : this.dirs.failed;
    const finalXml = await this.freeName(dest, xml);
    // keep the pair's names aligned when a clash forced a timestamp prefix
    const finalName = basename(finalXml);
    const prefix = finalName.slice(0, finalName.length - xml.length);
    await rename(claimedXml, finalXml);
    await rename(claimedPdf, join(dest, `${prefix}${pdf}`));
    const note = join(dest, `${prefix}${parse(xml).name}.${outcome.kind === 'failed' ? 'error.txt' : 'result.json'}`);
    await writeFile(note, outcome.kind === 'failed'
      ? `${outcome.message}\n\n${JSON.stringify(outcome.summary, null, 2)}\n`
      : `${JSON.stringify(outcome.summary, null, 2)}\n`, 'utf8');
    this.deps.log(outcome.kind === 'failed' ? 'error' : 'info', `${xml}: ${outcome.kind}${outcome.kind === 'failed' ? ` - ${outcome.message.split('\n')[0]}` : ''}`);
    this.seen.delete(stem);
    return true;
  }

  /** A path in dir for file name `name` that does not exist yet (adds a timestamp prefix on clash). */
  private async freeName(dir: string, name: string): Promise<string> {
    let p = join(dir, name);
    if (!(await exists(p))) return p;
    const t = new Date(this.deps.now()).toISOString().replace(/[-:T]/g, '').slice(0, 14);
    for (let i = 0; ; i++) {
      p = join(dir, `${t}${i ? `-${i}` : ''}_${name}`);
      if (!(await exists(p))) return p;
    }
  }
}
