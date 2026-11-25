import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ActivityKind, ActivityLog } from '../src/activity.js';
import { tracked } from '../src/watcher/tracked.js';

class Rec implements ActivityLog {
  events: string[] = [];
  meta: { bytes?: number | null; withPdf?: boolean } = {};
  async start(kind: ActivityKind, label: string, _j?: number | null, _t?: number | null, meta: { bytes?: number | null; withPdf?: boolean } = {}): Promise<number | null> { this.meta = meta; this.events.push(`start ${kind} ${label}`); return 1; }
  async step(_id: number | null, done: number, total: number | null, detail: string): Promise<void> { this.events.push(`step ${done}/${total} ${detail}`); }
  async finish(_id: number | null, state: 'Done' | 'Failed', detail?: string): Promise<void> { this.events.push(`finish ${state} ${detail}`); }
  async drop(): Promise<void> { this.events.push('drop'); }
}

describe('tracked', () => {
  it('records an import from start to its outcome and returns the outcome unchanged', async () => {
    const a = new Rec(); const out = { kind: 'processed' as const, summary: {} };
    expect(await tracked(a, 'Import', 'C:\\inbox\\job-1.xml', async () => out)).toBe(out);
    expect(a.events).toEqual(['start Import job-1.xml', 'finish Done Imported']);
  });
  it('says so for a duplicate and a failure', async () => {
    for (const [o, want] of [[{ kind: 'duplicate' as const, summary: {} }, 'finish Done Already imported (duplicate)'], [{ kind: 'failed' as const, summary: {}, message: 'Bad XML' }, 'finish Failed Bad XML']] as const) {
      const a = new Rec(); await tracked(a, 'Import', 'x.xml', async () => o); expect(a.events[1]).toBe(want);
    }
  });
  it('leaves no Failed row for work that will be tried again', async () => {
    const a = new Rec(); await tracked(a, 'Import', 'x.xml', async () => ({ kind: 'retry' as const, message: 'database down' }));
    expect(a.events).toEqual(['start Import x.xml', 'drop']);
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
  it('passes on progress at most once per interval, and records the size of the file and whether a PDF is read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'idoc-tracked-')); const f = join(dir, 'big.pdf'); writeFileSync(f, 'x'.repeat(1234));
    const a = new Rec(); let t = 1_000_000;
    await tracked(a, 'PDF check', f, async (report) => {
      report(1, 100, 'a'); t += 400; report(2, 100, 'b'); t += 700; report(3, 100, 'c'); t += 1500; report(4, 100, 'd');
      return { kind: 'processed' as const, summary: {} };
    }, { now: () => t, withPdf: true });
    expect(a.events.filter((e) => e.startsWith('step'))).toEqual(['step 1/100 a', 'step 3/100 c', 'step 4/100 d']);
    expect(a.meta).toEqual({ bytes: 1234, withPdf: true });
  });
  it('sizes an import by the file named, and an XML-only import is not a PDF read', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'idoc-tracked-')); const x = join(dir, 'a.xml'); writeFileSync(x, 'xx');
    const a = new Rec(); await tracked(a, 'Import', x, async () => ({ kind: 'processed' as const, summary: {} }));
    expect(a.meta).toEqual({ bytes: 2, withPdf: false });
  });
});
