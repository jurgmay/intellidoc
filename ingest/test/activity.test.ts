import { describe, expect, it } from 'vitest';
import type { ActivityKind, ActivityLog } from '../src/activity.js';
import { tracked } from '../src/watcher/tracked.js';

class Rec implements ActivityLog {
  events: string[] = [];
  async start(kind: ActivityKind, label: string): Promise<number | null> { this.events.push(`start ${kind} ${label}`); return 1; }
  async step(): Promise<void> { /* not used here */ }
  async finish(_id: number | null, state: 'Done' | 'Failed', detail?: string): Promise<void> { this.events.push(`finish ${state} ${detail}`); }
  async drop(): Promise<void> { this.events.push('drop'); }
}

describe('tracked', () => {
  it('records an import from start to its outcome and returns the outcome unchanged', async () => {
    const a = new Rec(); const out = { kind: 'processed' as const, summary: {} };
    expect(await tracked(a, 'Import', 'C:\\inbox\\job-1.xml', async () => out)).toBe(out);
    expect(a.events).toEqual(['start Import job-1.xml', 'finish Done Imported']);
  });
  it('says so for a duplicate, a failure and a retry', async () => {
    for (const [o, want] of [[{ kind: 'duplicate' as const, summary: {} }, 'finish Done Already imported (duplicate)'], [{ kind: 'failed' as const, summary: {}, message: 'Bad XML' }, 'finish Failed Bad XML'],
      [{ kind: 'retry' as const, message: 'database down' }, 'finish Failed Will try again: database down']] as const) {
      const a = new Rec(); await tracked(a, 'Import', 'x.xml', async () => o); expect(a.events[1]).toBe(want);
    }
  });
  it('leaves no trace of a lone PDF that no job was waiting for', async () => {
    const a = new Rec(); await tracked(a, 'PDF check', 'x.pdf', async () => ({ kind: 'unmatched' as const }));
    expect(a.events).toEqual(['start PDF check x.pdf', 'drop']);
  });
  it('records a crash as a failure and still throws it', async () => {
    const a = new Rec();
    await expect(tracked(a, 'Import', 'x.xml', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(a.events[1]).toBe('finish Failed boom');
  });
});
