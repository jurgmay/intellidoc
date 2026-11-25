import { access, readdir, rename, stat } from 'node:fs/promises';
import { join, parse, resolve } from 'node:path';
import { ConflictError } from '../errors.js';
import type { InboxItem, InboxReader } from './types.js';

/** Lists WATCH_DIR\inbox: the same folder the watcher reads, in the order it will take them (smallest XML first, then PDFs alone). */
export class FsInboxReader implements InboxReader {
  private readonly dir: string | null;
  private readonly failedDir: string | null;
  constructor(env: Record<string, string | undefined> = process.env) {
    this.dir = env['WATCH_DIR'] ? join(resolve(env['WATCH_DIR']), 'inbox') : null;
    this.failedDir = env['WATCH_DIR'] ? join(resolve(env['WATCH_DIR']), 'failed') : null;
  }
  unavailable(): string | null { return this.dir ? null : 'WATCH_DIR is not set on the API server, so it cannot show what is in the inbox. Set it in the API\'s .env and restart.'; }
  async list(): Promise<InboxItem[]> {
    if (!this.dir) return [];
    let names: string[];
    try { names = await readdir(this.dir); } catch { return []; }
    const stems = new Map<string, InboxItem>();
    for (const name of names) {
      const { name: stem, ext } = parse(name);
      const kind = ext.toLowerCase() === '.xml' ? 'xml' : ext.toLowerCase() === '.pdf' ? 'pdf' : null;
      if (!kind) continue;
      let st; try { st = await stat(join(this.dir, name)); } catch { continue; }
      if (!st.isFile()) continue;
      const key = stem.toLowerCase();
      const item = stems.get(key) ?? { stem, xmlName: null, xmlBytes: null, pdfName: null, pdfBytes: null, modifiedAt: new Date(0).toISOString() };
      if (kind === 'xml') { item.xmlName = name; item.xmlBytes = st.size; } else { item.pdfName = name; item.pdfBytes = st.size; }
      if (st.mtime.toISOString() > item.modifiedAt) item.modifiedAt = st.mtime.toISOString();
      stems.set(key, item);
    }
    return [...stems.values()].sort(inboxOrder);
  }
  async restoreFailed(name: string, withPartner: boolean): Promise<string[]> {
    if (!this.dir || !this.failedDir) throw new ConflictError('WATCH_DIR is not set on the API server, so it cannot reach the failed folder.');
    let names: string[];
    try { names = await readdir(this.failedDir); } catch { names = []; }
    const prefix = failedPrefix(names, name);
    if (prefix === null) throw new ConflictError(`${name} is not in the failed folder. It may already have been moved.`);
    const wanted = [name];
    if (withPartner) { const partner = `${parse(name).name}.pdf`; if (names.some((n) => n.toLowerCase() === `${prefix}${partner}`.toLowerCase())) wanted.push(partner); }
    for (const w of wanted) if (await exists(join(this.dir, w))) throw new ConflictError(`${w} is already in the inbox.`);
    const put: string[] = [];
    for (const w of wanted) {
      const from = names.find((n) => n.toLowerCase() === `${prefix}${w}`.toLowerCase())!;
      await rename(join(this.failedDir, from), join(this.dir, w));
      put.push(w);
    }
    return put;
  }
}

const exists = (p: string): Promise<boolean> => access(p).then(() => true, () => false);

/**
 * The timestamp prefix ('' for none) the newest failed copy of `name` carries. The watcher files a second failure of the same name as
 * 'yyyymmddhhmmss_name' (or 'yyyymmddhhmmss-1_name'), so the latest of those is the most recent failure. Null when there is no copy.
 */
export function failedPrefix(names: string[], name: string): string | null {
  const lower = name.toLowerCase();
  const found = names.map((n) => /^((\d{14})(?:-(\d+))?_)(.+)$/.exec(n)).filter((m): m is RegExpExecArray => m !== null && m[4]!.toLowerCase() === lower);
  // the same second can hold several (…_name, …-1_name, …-2_name): the higher number came later
  found.sort((x, y) => x[2]!.localeCompare(y[2]!) || Number(x[3] ?? 0) - Number(y[3] ?? 0));
  if (found.length > 0) return found[found.length - 1]![1]!;
  return names.some((n) => n.toLowerCase() === lower) ? '' : null;
}

/** The watcher's order: smallest XML first, ties by name; a PDF with no XML goes after them. */
export function inboxOrder(a: InboxItem, b: InboxItem): number {
  const sa = a.xmlBytes ?? Number.POSITIVE_INFINITY, sb = b.xmlBytes ?? Number.POSITIVE_INFINITY;
  return sa === sb ? a.stem.toLowerCase().localeCompare(b.stem.toLowerCase()) : sa < sb ? -1 : 1;
}
