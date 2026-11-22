import { stat } from 'node:fs/promises';
import type { ActivityKind, ActivityLog, Progress } from '../activity.js';
import type { Outcome } from './folderWatcher.js';

const words = (o: Outcome): { state: 'Done' | 'Failed'; detail: string } => {
  switch (o.kind) {
    case 'processed': return { state: 'Done', detail: 'Imported' };
    case 'duplicate': return { state: 'Done', detail: 'Already imported (duplicate)' };
    case 'failed': return { state: 'Failed', detail: o.message };
    case 'retry': return { state: 'Failed', detail: `Will try again: ${o.message}` };
  }
};

export interface TrackedOptions {
  /** The file whose size says how long this will take: the PDF when one is read, else the XML. */
  sizeOf?: string;
  /** A PDF is read as part of this work (a pair, or a PDF arriving for a waiting job). */
  withPdf?: boolean;
  /** Fewest milliseconds between progress writes to the database. */
  everyMs?: number;
  now?: () => number;
}

/**
 * Records a unit of watcher work (an import, a PDF check) for the Activity screen: started when it begins, kept up to date through `report`
 * (written at most once a second), finished with its outcome. A result of 'unmatched' (a lone PDF no job was waiting for) leaves no trace.
 * Never changes what `run` returns or throws.
 */
export async function tracked<R extends Outcome | { kind: 'unmatched' }>(activity: ActivityLog, kind: ActivityKind, path: string, run: (report: Progress) => Promise<R>, o: TrackedOptions = {}): Promise<R> {
  const now = o.now ?? Date.now;
  let bytes: number | null = null;
  try { bytes = (await stat(o.sizeOf ?? path)).size; } catch { /* gone or unreadable: no size, so no estimate from it */ }
  const id = await activity.start(kind, path.split(/[\\/]/).pop() ?? path, null, null, { bytes, withPdf: o.withPdf ?? kind === 'PDF check' });
  let last = 0;
  const report: Progress = (done, total, detail) => {
    if (id === null || now() - last < (o.everyMs ?? 1000)) return;
    last = now();
    void activity.step(id, done, total, detail);
  };
  try {
    const r = await run(report);
    if (r.kind === 'unmatched') await activity.drop(id);
    else { const w = words(r); await activity.finish(id, w.state, w.detail); }
    return r;
  } catch (e) { await activity.finish(id, 'Failed', (e as Error).message); throw e; }
}
