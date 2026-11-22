import type { ActivityKind, ActivityLog } from '../activity.js';
import type { Outcome } from './folderWatcher.js';

const words = (o: Outcome): { state: 'Done' | 'Failed'; detail: string } => {
  switch (o.kind) {
    case 'processed': return { state: 'Done', detail: 'Imported' };
    case 'duplicate': return { state: 'Done', detail: 'Already imported (duplicate)' };
    case 'failed': return { state: 'Failed', detail: o.message };
    case 'retry': return { state: 'Failed', detail: `Will try again: ${o.message}` };
  }
};

/**
 * Records a unit of watcher work (an import, a PDF check) for the Activity screen: started when it begins, finished with its outcome.
 * A result of 'unmatched' (a lone PDF no job was waiting for) leaves no trace. Never changes what `run` returns or throws.
 */
export async function tracked<R extends Outcome | { kind: 'unmatched' }>(activity: ActivityLog, kind: ActivityKind, path: string, run: () => Promise<R>): Promise<R> {
  const id = await activity.start(kind, path.split(/[\\/]/).pop() ?? path);
  try {
    const r = await run();
    if (r.kind === 'unmatched') await activity.drop(id);
    else { const w = words(r); await activity.finish(id, w.state, w.detail); }
    return r;
  } catch (e) { await activity.finish(id, 'Failed', (e as Error).message); throw e; }
}
