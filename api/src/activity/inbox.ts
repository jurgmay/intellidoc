import { readdir, stat } from 'node:fs/promises';
import { join, parse, resolve } from 'node:path';
import type { InboxItem, InboxReader } from './types.js';

/** Lists WATCH_DIR\inbox: the same folder the watcher reads, in the order it will take them (smallest XML first, then PDFs alone). */
export class FsInboxReader implements InboxReader {
  private readonly dir: string | null;
  constructor(env: Record<string, string | undefined> = process.env) { this.dir = env['WATCH_DIR'] ? join(resolve(env['WATCH_DIR']), 'inbox') : null; }
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
}

/** The watcher's order: smallest XML first, ties by name; a PDF with no XML goes after them. */
export function inboxOrder(a: InboxItem, b: InboxItem): number {
  const sa = a.xmlBytes ?? Number.POSITIVE_INFINITY, sb = b.xmlBytes ?? Number.POSITIVE_INFINITY;
  return sa === sb ? a.stem.toLowerCase().localeCompare(b.stem.toLowerCase()) : sa < sb ? -1 : 1;
}
