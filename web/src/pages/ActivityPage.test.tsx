import { StrictMode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivityData } from '../api/activity';
import { theme } from '../theme';
import { ActivityPage, buildLines, duration, durationText, elapsed, size } from './ActivityPage';

const job = (id: number, over: object = {}) => ({ id, customerCode: 'ACME', customerName: 'Acme', baseName: `j${id}`, pdfFileName: `j${id}.pdf`, receivedAt: `2026-11-22T10:0${id}:00.000Z`, status: 'Received',
  packCount: 1, pageCount: 2, pdfError: null, batchCount: 2, composedBatchCount: 2, runSheetsEmailedAt: null, ...over });
const act = (id: number, over: object = {}) => ({ id, kind: 'Import', label: `f${id}.xml`, jobId: null, state: 'Done', detail: 'Imported', done: null, total: null,
  startedAt: '2026-11-22T21:00:00.000Z', updatedAt: '2026-11-22T21:00:20.000Z', finishedAt: '2026-11-22T21:00:20.000Z', stalled: false, ...over });
const data = (o: { inbox?: unknown[]; inboxUnavailable?: string | null; running?: unknown[]; recent?: unknown[]; jobs?: unknown[]; queue?: unknown; autoCompose?: boolean } = {}): ActivityData => ({ inbox: [], inboxUnavailable: null, running: [], recent: [], jobs: [], queue: { basedOn: 0, seconds: null, partial: false }, autoCompose: true, ...o } as ActivityData);
const NOW = Date.parse('2026-11-22T21:05:00.000Z');

describe('buildLines', () => {
  it('lists running work first, then the inbox in order, jobs awaiting a PDF, failures, and finished jobs newest first at the bottom', () => {
    const d = data({
      running: [act(9, { kind: 'Print files', state: 'Running', label: 'Job 7: j7.pdf', detail: 'Batch 81899 (2 of 5): file 3 of 13 built', done: 120, total: 5000 }), act(10, { state: 'Running', label: 'a.xml', detail: null })],
      inbox: [{ stem: 'small', xmlName: 'small.xml', xmlBytes: 10, pdfName: 'small.pdf', pdfBytes: 5, modifiedAt: '2026-11-22T21:04:00.000Z' }, { stem: 'big', xmlName: 'big.xml', xmlBytes: 900, pdfName: null, pdfBytes: null, modifiedAt: '2026-11-22T21:04:30.000Z' }],
      jobs: [job(1), job(2, { status: 'Awaiting PDF', composedBatchCount: 0 }), job(3, { composedBatchCount: 0 }), job(4, { status: 'PDF Rejected', pdfError: 'Pack 12 is past the end', composedBatchCount: 0 })],
      recent: [act(5, { state: 'Failed', detail: 'Bad XML', label: 'bad.xml' })],
    });
    const l = buildLines(d, NOW);
    expect(l.map((x) => `${x.stage}:${x.name}`)).toEqual(['Making print files:Job 7: j7.pdf', 'Processing:a.xml', 'Waiting:small.xml', 'Waiting:big.xml', 'Awaiting PDF:j2.pdf',
      'Failed:bad.xml', 'Failed:j4.pdf', 'Completed:j3.pdf', 'Completed:j1.pdf']);
    expect(l[0]!.progress).toEqual({ done: 120, total: 5000, unit: 'mailpieces' });
    expect(l[2]).toMatchObject({ pdf: 'arrived', bytes: 10 });
    expect(l[3]).toMatchObject({ pdf: 'waiting' });
    expect(l[7]!.detail).toMatch(/ready; print files not made yet/);
    expect(l[8]!.detail).toMatch(/print files made/);
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
      running: [act(1, { state: 'Running', label: 'run.xml', startedAt: '2026-11-22T21:03:00.000Z', finishedAt: null, remainingSeconds: 120 })],
      inbox: [{ stem: 'w', xmlName: 'w.xml', xmlBytes: 1, pdfName: null, pdfBytes: null, modifiedAt: '2026-11-22T21:04:30.000Z' }],
      jobs: [job(1, { baseName: 'done', pdfFileName: 'done.pdf' })],
      recent: [act(2, { label: 'done.xml', startedAt: '2026-11-22T21:00:00.000Z', finishedAt: '2026-11-22T21:00:10.000Z' }), act(3, { kind: 'PDF check', label: 'DONE.pdf', startedAt: '2026-11-22T21:00:10.000Z', finishedAt: '2026-11-22T21:02:40.000Z' }),
        act(4, { kind: 'Print files', label: 'Job 1: done.pdf', startedAt: '2026-11-22T21:01:00.000Z', finishedAt: '2026-11-22T21:01:30.000Z', detail: '2 of 2 batches made' })],
    }), NOW);
    expect(durationText(l[0]!, NOW)).toBe('2m 0s, about 2 min left');
    expect(l[0]).toMatchObject({ start: '2026-11-22T21:03:00.000Z', end: null });
    expect(durationText(l[1]!, NOW)).toBe('waiting 30s'); expect(l[1]).toMatchObject({ start: null, end: null });
    const job1 = l.find((x) => x.name === 'done.pdf')!;
    expect(job1).toMatchObject({ start: '2026-11-22T21:00:00.000Z', end: '2026-11-22T21:02:40.000Z' });
    expect(durationText(job1, NOW)).toBe('2m 40s');
    const print = l.find((x) => x.name === 'Job 1: done.pdf')!;
    expect(print).toMatchObject({ stage: 'Completed' }); expect(durationText(print, NOW)).toBe('30s');
  });
  it('shows Start time, End time and Duration columns instead of Time', async () => {
    show();
    expect(await screen.findByRole('columnheader', { name: 'Start time' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'End time' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Duration' })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Time' })).toBeNull();
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

describe('PDF check progress and estimates', () => {
  it('shows pages for an import or PDF check, with the time left, and the estimate for each waiting file', () => {
    const l = buildLines(data({
      running: [act(1, { kind: 'PDF check', state: 'Running', label: 'big.pdf', detail: 'Checking the colour of page 1,200 of 54,000', done: 1200, total: 54000, remainingSeconds: 540 })],
      inbox: [{ stem: 'a', xmlName: 'a.xml', xmlBytes: 1, pdfName: 'a.pdf', pdfBytes: 1, modifiedAt: '2026-11-22T21:00:00.000Z', estimateSeconds: 95 }] }), NOW);
    expect(l[0]).toMatchObject({ stage: 'Processing', progress: { done: 1200, total: 54000, unit: 'pages' }, seconds: 540 });
    expect(l[1]).toMatchObject({ stage: 'Waiting', seconds: 95 });
  });
  it('words a length of time roughly', () => {
    expect([0.2, 45, 59.6, 90, 840, 3600, 4800, 7200].map(duration)).toEqual(['1 s', '45 s', '60 s', '2 min', '14 min', '1 h', '1 h 20 min', '2 h']);
  });
});

describe('formatting', () => {
  it('sizes and elapsed times', () => {
    expect(size(512)).toBe('512 B'); expect(size(2048)).toBe('2 KB'); expect(size(5 * 1_048_576)).toBe('5.0 MB'); expect(size(null)).toBe('');
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
    expect(screen.getByRole('columnheader', { name: 'File' })).toBeInTheDocument();
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

describe('ActivityPage estimates', () => {
  it('shows how long the inbox should take, and what is left of the file being checked', async () => {
    current = data({ queue: { basedOn: 40, seconds: 840, partial: false },
      running: [act(1, { kind: 'PDF check', state: 'Running', label: 'big.pdf', detail: 'Checking the colour of page 1,200 of 54,000', done: 1200, total: 54000, remainingSeconds: 540 })],
      inbox: [{ stem: 'a', xmlName: 'a.xml', xmlBytes: 1, pdfName: 'a.pdf', pdfBytes: 1, modifiedAt: new Date().toISOString(), estimateSeconds: 95 }] });
    show();
    expect(await screen.findByText('14 min')).toBeInTheDocument();
    expect(screen.getByText(/from the last 40 imports and PDF checks/)).toBeInTheDocument();
    expect(screen.getByText('Checking the colour of page 1,200 of 54,000')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: '1200 of 54000 pages' })).toBeInTheDocument();
    expect(screen.getByText(/about 9 min left/)).toBeInTheDocument();
    expect(screen.getByText(/\(about 2 min\)/)).toBeInTheDocument();
  });
  it('says "at least" when some files could not be estimated, and shows nothing when there is no estimate', async () => {
    current = data({ queue: { basedOn: 2, seconds: 120, partial: true } });
    const { unmount } = show();
    expect(await screen.findByText(/At least/)).toBeInTheDocument(); expect(screen.getByText(/too new to estimate/)).toBeInTheDocument();
    unmount();
    current = data({ queue: { basedOn: 0, seconds: null, partial: true } });
    show(); await screen.findByText('Nothing in the inbox and nothing running.');
    expect(screen.queryByText(/to clear the inbox/)).toBeNull();
  });
});

describe('ActivityPage', () => {
  it('shows the inbox with whether each PDF has arrived, and print file progress', async () => {
    current = data({ inbox: [{ stem: 'a', xmlName: 'a.xml', xmlBytes: 2048, pdfName: 'a.pdf', pdfBytes: 5, modifiedAt: new Date().toISOString() }, { stem: 'b', xmlName: 'b.xml', xmlBytes: 9000, pdfName: null, pdfBytes: null, modifiedAt: new Date().toISOString() }],
      running: [act(1, { kind: 'Print files', state: 'Running', label: 'Job 3: j3.pdf', detail: '0 of 4 batches. Batch 70 (1 of 4): file 2 of 3 built', done: 300, total: 9000 })] });
    show();
    await screen.findByText('a.xml');   // the table is there from the start; wait for its first rows
    const ra = (await screen.findAllByRole('row')).find((r) => within(r).queryByText('a.xml'))!;
    expect(within(ra).getByText('Arrived')).toBeInTheDocument(); expect(within(ra).getByText('2 KB')).toBeInTheDocument();
    const rb = (await screen.findAllByRole('row')).find((r) => within(r).queryByText('b.xml'))!;
    expect(within(rb).getByText('Not yet')).toBeInTheDocument();
    expect(await screen.findByText(/0 of 4 batches\. Batch 70 \(1 of 4\): file 2 of 3 built/)).toBeInTheDocument();
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
