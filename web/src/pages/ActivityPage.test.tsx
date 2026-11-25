import { StrictMode } from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivityData } from '../api/activity';
import { theme } from '../theme';
import { buildLines, durationText, elapsed } from './activityLines';
import { ActivityPage, ACTIVE_REFRESH_MS, IDLE_REFRESH_MS, isBusy } from './ActivityPage';

const job = (id: number, over: object = {}) => ({ id, customerCode: 'ACME', customerName: 'Acme', baseName: `j${id}`, pdfFileName: `j${id}.pdf`, receivedAt: `2026-11-22T10:0${id}:00.000Z`, status: 'Received',
  packCount: 1, pageCount: 2, pdfError: null, batchCount: 2, composedBatchCount: 2, runSheetsEmailedAt: null, ...over });
const act = (id: number, over: object = {}) => ({ id, kind: 'Import', label: `f${id}.xml`, jobId: null, state: 'Done', detail: 'Imported', done: null, total: null,
  startedAt: '2026-11-22T21:00:00.000Z', updatedAt: '2026-11-22T21:00:20.000Z', finishedAt: '2026-11-22T21:00:20.000Z', stalled: false, ...over });
const data = (o: { inbox?: unknown[]; inboxUnavailable?: string | null; running?: unknown[]; recent?: unknown[]; jobs?: unknown[]; autoCompose?: boolean } = {}): ActivityData => ({ inbox: [], inboxUnavailable: null, running: [], recent: [], jobs: [], autoCompose: true, ...o } as ActivityData);
const NOW = Date.parse('2026-11-22T21:05:00.000Z');

describe('buildLines', () => {
  it('lists running work first, then the inbox in order, jobs awaiting a PDF, failures, and finished jobs newest first at the bottom', () => {
    const d = data({
      running: [act(9, { kind: 'Print files', state: 'Running', label: 'Job 7: j7.pdf', detail: 'Processing batch 2 of 5. Built file 3 of 13', done: 120, total: 5000 }), act(10, { state: 'Running', label: 'a.xml', detail: null })],
      inbox: [{ stem: 'small', xmlName: 'small.xml', xmlBytes: 10, pdfName: 'small.pdf', pdfBytes: 5, modifiedAt: '2026-11-22T21:04:00.000Z' }, { stem: 'big', xmlName: 'big.xml', xmlBytes: 900, pdfName: null, pdfBytes: null, modifiedAt: '2026-11-22T21:04:30.000Z' }],
      jobs: [job(1), job(2, { status: 'Awaiting PDF', composedBatchCount: 0 }), job(3, { composedBatchCount: 0 }), job(4, { status: 'PDF Rejected', pdfError: 'Pack 12 is past the end', composedBatchCount: 0 })],
      recent: [act(5, { state: 'Failed', detail: 'Bad XML', label: 'bad.xml' })],
    });
    const l = buildLines(d, NOW);
    expect(l.map((x) => `${x.stage}:${x.name}`)).toEqual(['Making print files:j7.pdf', 'Processing:a.xml', 'Waiting:small.xml', 'Waiting:big.xml', 'Awaiting PDF:j2.pdf',
      'Failed:bad.xml', 'Failed:j4.pdf', 'Completed:j3.pdf', 'Completed:j1.pdf']);
    expect(l[0]!.progress).toEqual({ done: 120, total: 5000, unit: 'mailpieces' });
    expect(l[2]).toMatchObject({ detail: 'Ready.', bytes: 10 });
    expect(l[3]).toMatchObject({ detail: 'Waiting for the PDF.' });
    expect(l[7]!.detail).toMatch(/^Waiting to create print files\./);
    expect(l[8]!.detail).toMatch(/^Print files created\./);
  });
  it('does not list a file twice while it is being imported, and drops old failures', () => {
    const d = data({ running: [act(1, { state: 'Running', label: 'a.xml' })], inbox: [{ stem: 'a', xmlName: 'a.xml', xmlBytes: 1, pdfName: 'a.pdf', pdfBytes: 1, modifiedAt: '2026-11-22T21:00:00.000Z' }],
      recent: [act(2, { state: 'Failed', finishedAt: '2026-11-22T08:00:00.000Z' })] });
    expect(buildLines(d, NOW).map((x) => x.name)).toEqual(['a.xml']);
  });
  it('flags work that has stopped moving', () => {
    const l = buildLines(data({ running: [act(1, { state: 'Running', stalled: true })] }), NOW);
    expect(l[0]).toMatchObject({ stalled: true }); expect(l[0]!.detail).toMatch(/may have stopped/);
  });
});

describe('times', () => {
  it('gives each line a start, an end and a duration', () => {
    const l = buildLines(data({
      running: [act(1, { state: 'Running', label: 'run.xml', startedAt: '2026-11-22T21:03:00.000Z', finishedAt: null })],
      inbox: [{ stem: 'w', xmlName: 'w.xml', xmlBytes: 1, pdfName: null, pdfBytes: null, modifiedAt: '2026-11-22T21:04:30.000Z' }],
      jobs: [job(1, { baseName: 'done', pdfFileName: 'done.pdf' })],
      recent: [act(2, { label: 'done.xml', startedAt: '2026-11-22T21:00:00.000Z', finishedAt: '2026-11-22T21:00:10.000Z' }), act(3, { kind: 'PDF check', label: 'DONE.pdf', startedAt: '2026-11-22T21:00:10.000Z', finishedAt: '2026-11-22T21:02:40.000Z' }),
        act(4, { kind: 'Print files', label: 'Job 1: done.pdf', jobId: 1, startedAt: '2026-11-22T21:03:00.000Z', finishedAt: '2026-11-22T21:03:30.000Z', detail: '2 of 2 batches made' })],
    }), NOW);
    expect(durationText(l[0]!, NOW)).toBe('2m 0s');
    expect(l[0]).toMatchObject({ start: '2026-11-22T21:03:00.000Z', end: null });
    expect(durationText(l[1]!, NOW)).toBe('waiting 30s'); expect(l[1]).toMatchObject({ start: null, end: null });
    const job1 = l.find((x) => x.name === 'done.pdf')!;
    // one row for the file: from the start of the import to the end of the print files
    expect(l.filter((x) => x.name === 'done.pdf')).toHaveLength(1);
    expect(job1).toMatchObject({ start: '2026-11-22T21:00:00.000Z', end: '2026-11-22T21:03:30.000Z' });
    expect(durationText(job1, NOW)).toBe('3m 30s');
    expect(l.filter((x) => x.detail?.startsWith('Print files:'))).toHaveLength(0);
  });
  it('shows Start time, End time and Duration columns instead of Time, and no Size column', async () => {
    show();
    expect(await screen.findByRole('columnheader', { name: 'Start time' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'End time' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Duration' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Time' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'Size' })).toBeNull();
  });
});

describe('automatic print files warning', () => {
  it('warns, with a link to Settings, when "Make print files automatically" is off, and not when it is on', async () => {
    current = data({ autoCompose: false });
    const { unmount } = show();
    expect(await screen.findByText('Print files are not made automatically')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
    unmount();
    current = data({ autoCompose: true });
    show(); await screen.findByText('Nothing in the inbox and nothing running.');
    expect(screen.queryByText('Print files are not made automatically')).toBeNull();
  });
});

describe('accounts and file names', () => {
  it('shows the account where it is known, and puts the status before the file name without job numbers', () => {
    const l = buildLines(data({
      running: [act(9, { kind: 'Print files', state: 'Running', label: 'Job 3: j3.pdf', jobId: 3, detail: 'Processing batch 1 of 4. Built file 2 of 3', done: 1, total: 9 })],
      inbox: [{ stem: 'new', xmlName: 'new.xml', xmlBytes: 1, pdfName: null, pdfBytes: null, modifiedAt: '2026-11-22T21:00:00.000Z' }],
      jobs: [job(1, { customerName: 'Uinsure' }), job(2, { status: 'Awaiting PDF', composedBatchCount: 0, customerName: 'Zurich' }), job(3, { customerName: 'Acme', composedBatchCount: 0 }), job(5, { composedBatchCount: 1, customerName: 'Aviva' })],
    }), NOW);
    const by = (n: string) => l.find((x) => x.name === n)!;
    expect(by('j3.pdf')).toMatchObject({ stage: 'Making print files', account: 'Acme' });
    expect(by('new.xml').account).toBeNull();
    expect(by('j2.pdf')).toMatchObject({ account: 'Zurich', detail: 'Data imported; waiting for the PDF file.' });
    expect(by('j1.pdf')).toMatchObject({ account: 'Uinsure', detail: 'Print files created.' });
    expect(by('j5.pdf').detail).toBe('Print files created for 1 of 2 batches.');
    expect(l.map((x) => x.detail).join('|')).not.toMatch(/Job \d|Acme|Zurich|Uinsure/);
  });
  it('shows the account column, with the file name under the status in the Progress column', async () => {
    current = data({ jobs: [job(1, { customerName: 'Uinsure', pdfFileName: 'statements.pdf' })] });
    show();
    await screen.findByText('statements.pdf');
    const row = screen.getAllByRole('row').find((r) => within(r).queryByText('statements.pdf'))!;
    expect(within(row).getByText('Uinsure')).toBeInTheDocument();
    expect(within(row).getByText('Print files created.')).toBeInTheDocument();
  });
});

describe('PDF check progress', () => {
  it('shows pages for an import or PDF check, and no estimate for a waiting file', () => {
    const l = buildLines(data({
      running: [act(1, { kind: 'PDF check', state: 'Running', label: 'big.pdf', detail: 'Inspecting page 1,200 of 54,000', done: 1200, total: 54000 })],
      inbox: [{ stem: 'a', xmlName: 'a.xml', xmlBytes: 1, pdfName: 'a.pdf', pdfBytes: 1, modifiedAt: '2026-11-22T21:00:00.000Z' }] }), NOW);
    expect(l[0]).toMatchObject({ stage: 'Processing', progress: { done: 1200, total: 54000, unit: 'pages' } });
    expect(l[0]).not.toHaveProperty('seconds');
    expect(l[1]).toMatchObject({ stage: 'Waiting', detail: 'Ready.' });
  });
});

describe('formatting', () => {
  it('elapsed times', () => {
    expect(elapsed('2026-11-22T21:04:30.000Z', NOW)).toBe('30s'); expect(elapsed('2026-11-22T21:02:00.000Z', NOW)).toBe('3m 0s'); expect(elapsed('2026-11-22T19:00:00.000Z', NOW)).toBe('2h 5m');
  });
});

let current: ActivityData; let fetches: number; let fail: boolean;
beforeEach(() => {
  fetches = 0; fail = false; current = data();
  vi.stubGlobal('fetch', vi.fn(async () => { fetches++; return fail ? new Response(JSON.stringify({ error: 'Database down' }), { status: 500 }) : new Response(JSON.stringify(current), { status: 200 }); }));
});
afterEach(() => vi.unstubAllGlobals());
const show = (ms = 40) => render(<MantineProvider theme={theme}><MemoryRouter><ActivityPage refreshMs={ms} /></MemoryRouter></MantineProvider>);

describe('ActivityPage while loading', () => {
  it('shows the table with a loading row straight away, before the first answer arrives', async () => {
    let release!: () => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { release = () => resolve(new Response(JSON.stringify(data()), { status: 200 })); })));
    show(1000);
    expect(screen.getByRole('columnheader', { name: 'Account' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading…');
    expect(screen.queryByText('Nothing in the inbox and nothing running.')).toBeNull();
    release();
    expect(await screen.findByText('Nothing in the inbox and nothing running.')).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).toBeNull();
  });
  it('drops the loading row and shows the error when the first request fails', async () => {
    fail = true; show();
    expect(await screen.findByText('Database down')).toBeInTheDocument();
    expect(screen.queryByText('Loading…')).toBeNull();
  });
});

describe('ActivityPage first load', () => {
  it('shows the first answer at once, not at the first refresh, even when React runs the effect twice (as it does in development)', async () => {
    current = data({ inbox: [{ stem: 'a', xmlName: 'a.xml', xmlBytes: 1, pdfName: null, pdfBytes: null, modifiedAt: new Date().toISOString() }] });
    render(<StrictMode><MantineProvider theme={theme}><MemoryRouter><ActivityPage refreshMs={60_000} /></MemoryRouter></MantineProvider></StrictMode>);
    expect(await screen.findByText('a.xml', undefined, { timeout: 1500 })).toBeInTheDocument();
  });
});

describe('ActivityPage progress', () => {
  it('shows the pages checked so far, with no estimate of the time left or of the inbox', async () => {
    current = data({
      running: [act(1, { kind: 'PDF check', state: 'Running', label: 'big.pdf', detail: 'Inspecting page 1,200 of 54,000', done: 1200, total: 54000 })],
      inbox: [{ stem: 'a', xmlName: 'a.xml', xmlBytes: 1, pdfName: 'a.pdf', pdfBytes: 1, modifiedAt: new Date().toISOString() }] });
    show();
    expect(await screen.findByText('Inspecting page 1,200 of 54,000')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '1200 of 54000 pages' })).toBeInTheDocument();
    expect(screen.queryByText(/to clear the inbox/)).toBeNull();
    expect(screen.queryByText(/left/)).toBeNull();
    expect(screen.getByText('Ready.')).toBeInTheDocument();
  });
});

describe('ActivityPage', () => {
  it('shows the inbox with whether each PDF has arrived, and print file progress', async () => {
    current = data({ inbox: [{ stem: 'a', xmlName: 'a.xml', xmlBytes: 2048, pdfName: 'a.pdf', pdfBytes: 5, modifiedAt: new Date().toISOString() }, { stem: 'b', xmlName: 'b.xml', xmlBytes: 9000, pdfName: null, pdfBytes: null, modifiedAt: new Date().toISOString() }],
      running: [act(1, { kind: 'Print files', state: 'Running', label: 'Job 3: j3.pdf', detail: 'Processing batch 1 of 4. Built file 2 of 3', done: 300, total: 9000 })] });
    show();
    await screen.findByText('a.xml');   // the table is there from the start; wait for its first rows
    const ra = (await screen.findAllByRole('row')).find((r) => within(r).queryByText('a.xml'))!;
    expect(within(ra).getByText('Ready.')).toBeInTheDocument(); expect(within(ra).queryByText('2 KB')).toBeNull();
    const rb = (await screen.findAllByRole('row')).find((r) => within(r).queryByText('b.xml'))!;
    expect(within(rb).getByText('Waiting for the PDF.')).toBeInTheDocument(); expect(screen.queryByRole('columnheader', { name: 'PDF' })).toBeNull();
    expect(await screen.findByText(/Processing batch 1 of 4\. Built file 2 of 3/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '300 of 9000 mailpieces' })).toBeInTheDocument();
  });
  it('refreshes itself and shows a file moving to completed', async () => {
    current = data({ inbox: [{ stem: 'a', xmlName: 'a.xml', xmlBytes: 1, pdfName: 'a.pdf', pdfBytes: 1, modifiedAt: new Date().toISOString() }] });
    show();
    expect(await screen.findByText('a.xml')).toBeInTheDocument();
    current = data({ jobs: [job(1, { pdfFileName: 'a.pdf' })] });
    await waitFor(() => expect(screen.queryByText('a.xml')).toBeNull());
    expect(await screen.findByText('a.pdf')).toBeInTheDocument();
    expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);
    expect(fetches).toBeGreaterThan(1);
  });
  it('says why the inbox is missing, and shows an error from the server', async () => {
    current = data({ inboxUnavailable: 'WATCH_DIR is not set on the API server.' });
    show();
    expect(await screen.findByText('WATCH_DIR is not set on the API server.')).toBeInTheDocument();
    fail = true;
    expect(await screen.findByText('Database down')).toBeInTheDocument();
  });
  it('says so when there is nothing to show', async () => {
    show();
    expect(await screen.findByText('Nothing in the inbox and nothing running.')).toBeInTheDocument();
  });
});

describe('ActivityPage refresh rate', () => {
  it('is 1.5 seconds while something is waiting or running and 3 seconds when idle', () => {
    expect([ACTIVE_REFRESH_MS, IDLE_REFRESH_MS]).toEqual([1500, 3000]);
    expect(isBusy(null)).toBe(false);
    expect(isBusy(data())).toBe(false);
    expect(isBusy(data({ running: [act(1, { state: 'Running' })] }))).toBe(true);
    expect(isBusy(data({ inbox: [{ stem: 'a', xmlName: 'a.xml', xmlBytes: 1, pdfName: null, pdfBytes: null, modifiedAt: '2026-11-22T21:00:00.000Z' }] }))).toBe(true);
  });
  const countAfter = async (d: ActivityData, ms: number) => {
    vi.useFakeTimers({ shouldAdvanceTime: false });
    try {
      current = d; fetches = 0;
      render(<MantineProvider theme={theme}><MemoryRouter><ActivityPage /></MemoryRouter></MantineProvider>);
      await vi.advanceTimersByTimeAsync(0);
      const first = fetches;
      await vi.advanceTimersByTimeAsync(ms);
      return fetches - first;
    } finally { vi.useRealTimers(); }
  };
  it('asks again after 1.5 seconds while busy', async () => {
    expect(await countAfter(data({ running: [act(1, { state: 'Running' })] }), 1600)).toBe(1);
  });
  it('waits the full 3 seconds when idle', async () => {
    expect(await countAfter(data(), 1600)).toBe(0);
    cleanup();
    expect(await countAfter(data(), 3100)).toBe(1);
  });
});

describe('ActivityPage retry', () => {
  const failedRow = (id: number, o: object = {}) => act(id, { state: 'Failed', detail: 'Bad XML', finishedAt: new Date().toISOString(), ...o });
  let posts: { url: string; body: unknown }[]; let reply: (url: string) => { status: number; json: unknown };
  beforeEach(() => {
    posts = []; reply = () => ({ status: 200, json: { ok: true, restored: ['f1.xml'] } });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === 'POST') { posts.push({ url, body: init.body ? JSON.parse(init.body) : undefined }); const r = reply(url); return new Response(JSON.stringify(r.json), { status: r.status }); }
      return new Response(JSON.stringify(current), { status: 200 });
    }));
  });
  const page = () => render(<MantineProvider theme={theme}><Notifications /><MemoryRouter><ActivityPage refreshMs={60_000} /></MemoryRouter></MantineProvider>);

  it('offers a retry only on failed rows that can be tried again', () => {
    const l = buildLines(data({ recent: [failedRow(5, { label: 'f1.xml' })], jobs: [job(1, { status: 'PDF Rejected', pdfError: 'Wrong pages' }), job(2)] }), Date.now());
    expect(l.filter((x) => x.retry).map((x) => [x.name, x.retry])).toEqual([['f1.xml', { id: 5, kind: 'Import', jobId: null }]]);
    expect(l.some((x) => x.stage === 'Failed' && !x.retry)).toBe(true);   // the rejected job has no activity row to retry
    expect(l.filter((x) => x.stage === 'Completed').every((x) => !x.retry)).toBe(true);
  });
  it('puts a failed import back in the inbox and the failed row goes at once', async () => {
    current = data({ recent: [failedRow(5, { label: 'f1.xml' })] });
    reply = () => { current = data({ recent: [act(5, { label: 'f1.xml', state: 'Abandoned', detail: 'Bad XML' })] }); return { status: 200, json: { restored: ['f1.xml'] } }; };   // the server has dismissed the row by the time the page asks again
    page();
    await userEvent.click(await screen.findByRole('button', { name: 'Retry f1.xml' }));
    await waitFor(() => expect(posts).toEqual([{ url: '/api/activity/5/retry', body: undefined }]));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry f1.xml' })).toBeNull());
    expect(await screen.findByText('Back in the inbox')).toBeInTheDocument();
  });
  it('makes failed print files again for the job (only batches without files), then clears the failed row', async () => {
    current = data({ jobs: [job(7)], recent: [failedRow(9, { kind: 'Print files', label: 'Job 7: j7.pdf', jobId: 7, detail: 'Out of memory' })] });
    page();
    await userEvent.click(await screen.findByRole('button', { name: 'Retry j7.pdf' }));
    await waitFor(() => expect(posts.map((p) => p.url)).toEqual(['/api/jobs/7/compose', '/api/activity/9/dismiss']));
    expect(posts[0]!.body).toEqual({ onlyNew: true });
  });
  it('shows why it could not retry and leaves the row', async () => {
    current = data({ recent: [failedRow(5, { label: 'f1.xml' })] });
    reply = () => ({ status: 409, json: { error: 'f1.xml is not in the failed folder. It may already have been moved.' } });
    page();
    await userEvent.click(await screen.findByRole('button', { name: 'Retry f1.xml' }));
    expect(await screen.findByText(/not in the failed folder/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry f1.xml' })).toBeInTheDocument();
  });
});
