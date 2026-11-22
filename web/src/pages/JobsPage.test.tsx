import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { theme } from '../theme';
import { JobsPage, printFilesLabel } from './JobsPage';

const job = (id: number, over: object = {}) => ({
  id, customerCode: 'ACME', customerName: 'Acme Energy Ltd', baseName: `ACME_${id}`, pdfFileName: `ACME_${id}.pdf`, receivedAt: '2026-11-20T09:30:00.000Z', status: 'Received',
  packCount: 10, pageCount: 30, pdfError: null, batchCount: 2, composedBatchCount: 0, ...over,
});
const detail = (id: number) => ({ ...job(id), batches: [
  { id: 1, batchCode: 7001, status: 'Created', mailpieceCount: 6, files: [{ fileName: '7001_1.pdf', segment: 1, mailpieces: 6, pages: 20 }] },
  { id: 2, batchCode: 7002, status: 'Created', mailpieceCount: 4, files: [] }] });

let calls: { url: string; method: string; body?: any }[]; // eslint-disable-line @typescript-eslint/no-explicit-any
let rows: object[]; let canCompose: boolean; let composeFails: string | null;
beforeEach(() => {
  calls = []; canCompose = true; composeFails = null;
  rows = [job(3), job(2, { composedBatchCount: 2 }), job(1, { status: 'PDF Rejected', pdfError: 'Pack 12 is past the end', composedBatchCount: 0 })];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body ? JSON.parse(init.body) : undefined });
    if (method === 'POST') return composeFails
      ? new Response(JSON.stringify({ error: composeFails }), { status: 409 })
      : new Response(JSON.stringify({ batches: [{ batchCode: 7001, files: ['7001_1.pdf'], mrdfFile: null, skipped: null }, { batchCode: 7002, files: [], mrdfFile: null, skipped: 'already composed' }] }), { status: 200 });
    if (/^\/api\/jobs\/\d+$/.test(url)) return new Response(JSON.stringify(detail(Number(url.split('/').pop()))), { status: 200 });
    return new Response(JSON.stringify({ rows, canCompose, composeUnavailable: canCompose ? null : 'COMPOSE_OUT_DIR is not set on the API server.' }), { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());
const show = () => render(<MantineProvider theme={theme}><Notifications /><MemoryRouter><JobsPage /></MemoryRouter></MantineProvider>);
const rowOf = async (id: number) => (await screen.findAllByRole('row')).find((r) => within(r).queryByText(`ACME_${id}.pdf`))!;

describe('printFilesLabel', () => {
  it('says none, all or some', () => {
    expect(printFilesLabel(job(1, { batchCount: 0 }) as never)).toBe('No batches');
    expect(printFilesLabel(job(1) as never)).toBe('Not made');
    expect(printFilesLabel(job(1, { composedBatchCount: 2 }) as never)).toBe('Made (2 batches)');
    expect(printFilesLabel(job(1, { composedBatchCount: 1 }) as never)).toBe('1 of 2 batches');
  });
});

describe('JobsPage', () => {
  it('lists the jobs with their status and print files, and offers the button only where it applies', async () => {
    show();
    const r3 = await rowOf(3);
    expect(within(r3).getByText('Not made')).toBeInTheDocument();
    expect(within(r3).getByRole('button', { name: 'Make print files' })).toBeEnabled();
    expect(within(await rowOf(2)).getByRole('button', { name: 'Make again' })).toBeInTheDocument();
    const r1 = await rowOf(1);
    expect(within(r1).getByText('PDF Rejected')).toBeInTheDocument();
    expect(within(r1).queryByRole('button', { name: /Make/ })).toBeNull();
  });
  it('makes the print files with one click and refreshes the list', async () => {
    show();
    await userEvent.click(within(await rowOf(3)).getByRole('button', { name: 'Make print files' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')).toMatchObject({ url: '/api/jobs/3/compose', body: { onlyNew: false } }));
    expect(await screen.findByText('Print files made for job 3')).toBeInTheDocument();
    expect(screen.getByText('1 batch, 1 file; 1 left alone.')).toBeInTheDocument();
    await waitFor(() => expect(calls.filter((c) => c.method === 'GET' && c.url === '/api/jobs').length).toBeGreaterThan(1));
  });
  it('asks before making them again, and can leave the batches that have files', async () => {
    rows = [job(4, { composedBatchCount: 1 })];
    show();
    await userEvent.click(within(await rowOf(4)).getByRole('button', { name: 'Make again' }));
    expect(await screen.findByText('Make the print files for job 4 again?')).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'Only the batches without files' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ onlyNew: true }));
  });
  it('shows the server\'s reason when it cannot make them', async () => {
    composeFails = 'Could not make the print files for job 3: The PDF "ACME_3.pdf" is not in D:\\processed';
    show();
    await userEvent.click(within(await rowOf(3)).getByRole('button', { name: 'Make print files' }));
    expect(await screen.findByText(/The PDF "ACME_3.pdf" is not in/)).toBeInTheDocument();
  });
  it('disables the buttons and says why when the server has no print folder', async () => {
    canCompose = false;
    show();
    expect(await screen.findByText('COMPOSE_OUT_DIR is not set on the API server.')).toBeInTheDocument();
    expect(within(await rowOf(3)).getByRole('button', { name: 'Make print files' })).toBeDisabled();
  });
  it('searches and filters on the server', async () => {
    show();
    await userEvent.type(await screen.findByLabelText('Search'), 'odevo');
    await waitFor(() => expect(calls.some((c) => c.url === '/api/jobs?search=odevo')).toBe(true));
  });
  it('opens the details with each batch\'s files', async () => {
    show();
    await userEvent.click(within(await rowOf(3)).getByRole('button', { name: 'Details' }));
    expect(await screen.findByText('Job 3: ACME_3.pdf')).toBeInTheDocument();
    expect(screen.getByText('7001_1.pdf')).toBeInTheDocument();
    expect(screen.getByText('None yet')).toBeInTheDocument();
  });
});
