import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type sql from 'mssql';
import { AutoComposer } from '../src/compose/auto.js';
import { findSourcePdf } from '../src/compose/job.js';
import { loadConfig } from '../src/watcher/config.js';

const make = (o: { enabled?: boolean; jobs?: number[]; compose?: (id: number) => Promise<{ batchCode: number; files: string[] }[]> }) => {
  const clock = { t: 0 };
  const logs: string[] = [], mails: string[] = [], composed: number[] = [];
  const c = new AutoComposer({
    pool: {} as sql.ConnectionPool, pdfDir: '', outDir: '', grey: null, now: () => clock.t,
    log: (l, m) => logs.push(`${l} ${m}`), notify: async (s) => { mails.push(s); },
    isEnabled: async () => o.enabled ?? true, listJobs: async () => o.jobs ?? [7],
    compose: o.compose ?? (async (id) => { composed.push(id); return [{ batchCode: 1, files: ['1_1.pdf'] }]; }),
  });
  return { c, clock, logs, mails, composed };
};

describe('AutoComposer', () => {
  it('does nothing while the setting is off', async () => {
    const t = make({ enabled: false });
    expect(await t.c.run()).toBe(0);
    expect(t.composed).toEqual([]);
  });
  it('composes each job it is given and logs it', async () => {
    const t = make({ jobs: [7, 8] });
    expect(await t.c.run()).toBe(2);
    expect(t.composed).toEqual([7, 8]);
    expect(t.logs[0]).toMatch(/Job 7: print files made/);
  });
  it('retries a failed job after a growing wait, e-mails once after three failures, and recovers', async () => {
    let fail = true; let calls = 0;
    const t = make({ compose: async () => { calls++; if (fail) throw new Error('The PDF is not there'); return [{ batchCode: 1, files: ['a.pdf'] }]; } });
    await t.c.run(); expect(calls).toBe(1);
    await t.c.run(); expect(calls).toBe(1);                       // inside the 1 minute wait
    t.clock.t += 60_000; await t.c.run(); expect(calls).toBe(2);  // 2nd failure: wait 2 minutes
    t.clock.t += 120_000; await t.c.run(); expect(calls).toBe(3); // 3rd failure
    expect(t.mails).toEqual(['IntelliDoc: print files not made for job 7']);
    t.clock.t += 5 * 60_000; await t.c.run(); expect(calls).toBe(4);
    expect(t.mails).toHaveLength(1);                              // only once
    fail = false; t.clock.t += 10 * 60_000;
    expect(await t.c.run()).toBe(1);
    expect(t.logs.at(-1)).toMatch(/print files made/);
  });
  it('one failing job does not stop the next', async () => {
    const t = make({ jobs: [1, 2], compose: async (id) => { if (id === 1) throw new Error('boom'); return [{ batchCode: 2, files: ['x.pdf'] }]; } });
    expect(await t.c.run()).toBe(1);
  });
});

describe('findSourcePdf', () => {
  it('finds the name itself or the watcher clash prefix, and nothing else that merely ends the same', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'idoc-find-'));
    for (const f of ['job.pdf', 'ajob.pdf', 'x_job.pdf', '20260101120000_other.pdf']) writeFileSync(join(dir, f), 'x');
    expect(await findSourcePdf(dir, 'job.pdf')).toBe(join(dir, 'job.pdf'));
    writeFileSync(join(dir, '20260101120000-1_job.pdf'), 'x');
    expect((await findSourcePdf(dir, 'job.pdf')).endsWith('job.pdf')).toBe(true);
    await expect(findSourcePdf(dir, 'ob.pdf')).rejects.toThrow(/not in/);
    await expect(findSourcePdf(dir, 'other.pdf')).resolves.toContain('20260101120000_other.pdf');
  });
});

describe('watcher config', () => {
  it('reads COMPOSE_OUT_DIR, and leaves it unset otherwise', () => {
    const base = { INTELLIDOC_DB: 'x', WATCH_DIR: '/w' };
    expect(loadConfig(base, []).composeOutDir).toBeUndefined();
    expect(loadConfig({ ...base, COMPOSE_OUT_DIR: '/out' }, []).composeOutDir).toMatch(/out$/);
  });
});
