import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { theme } from '../theme';
import { BatchesPage } from './BatchesPage';
import { resetBatchSearchSession } from './batchSearchSession';

const scopes = [{ id: 1, label: 'Odevo', isCustomer: true }];
const batch = (batchCode: number, over: Record<string, unknown> = {}) => ({
  batchId: batchCode, batchCode, status: 'Printed', job: `Statements ${batchCode}`, createdAt: '2026-11-18T09:30:00', department: 'Machine enclosing', service: 'Royal Mail 2nd Class (Letter)', envelope: 'C5 window',
  brand: null, invoicingCode: 'ODEVO', invoicingName: 'Odevo', mailpieces: 2, mailpiecesInBatch: 2, cancelled: 0, packs: 3, pages: 6, sheets: 4, priceSell: 2.5, unpriced: 0, ...over,
});
const piece = (mailpieceId: number, name: string, sequenceNumber: number | null) => ({
  mailpieceId, sequenceNumber, batchCode: 7001, batchStatus: 'Printed', job: 'job-9', releaseDate: '2026-11-18T09:30:00', addressLines: [name, '12 Mill Lane', 'Leeds'], postcode: 'LS1 4AB', isCancelled: false,
  accountCode: 'ODEVO', accountName: 'Odevo', accountPath: 'Odevo', invoicingCode: 'ODEVO', invoicingName: 'Odevo', brand: null, priceSell: 1.25 as number | null,
  packs: [{ packId: mailpieceId * 10, packGuid: `aaaaaaaa-0000-4000-8000-${String(mailpieceId).padStart(12, '0')}`, jobGuid: 'bbbbbbbb-0000-4000-8000-000000000001', position: 1, sequence: 1, startPage: 1, pageCount: 2, releaseDate: '2026-11-18T09:30:00', references: { 'Tenant Reference': `T-${mailpieceId}` } }],
});
let urls: string[];
let respond: (url: string) => { status: number; json: unknown };

beforeEach(() => {
  resetBatchSearchSession();
  urls = [];
  respond = (url) => {
    if (url.startsWith('/api/recipients/scopes')) return { status: 200, json: { rows: scopes } };
    if (url.startsWith('/api/batches/search')) return { status: 200, json: { scope: { id: 1, label: 'Odevo' }, rows: [batch(7001), batch(7002, { status: 'Created', mailpieces: 1, mailpiecesInBatch: 3, cancelled: 1, unpriced: 1 })], truncated: false } };
    if (url.startsWith('/api/recipients/search')) return { status: 200, json: { scope: { id: 1, label: 'Odevo' }, rows: [piece(5, 'Mrs A Patel', 1), piece(6, 'Mr J Smith', 2)], truncated: false } };
    return { status: 404, json: { error: 'x' } };
  };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { urls.push(url); const r = respond(url); return new Response(JSON.stringify(r.json), { status: r.status }); }));
});
afterEach(() => vi.unstubAllGlobals());
const show = () => render(<MantineProvider theme={theme}><MemoryRouter><BatchesPage /></MemoryRouter></MantineProvider>);
async function search() {
  await userEvent.click(screen.getByRole('combobox', { name: /Search in/ }));
  await userEvent.click(await screen.findByRole('option', { name: 'Odevo', hidden: true }));
  await userEvent.click(screen.getByRole('button', { name: 'Search' }));
  await screen.findByText('Batch 7001');
}
const piecesCalls = () => urls.filter((u) => u.startsWith('/api/recipients/search'));

describe('BatchesPage', () => {
  it('requires an account before searching', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText(/Choose the account to search in/)).toBeInTheDocument();
    expect(urls.some((u) => u.startsWith('/api/batches/search'))).toBe(false);
  });

  it('shows batches as header bands with their figures, collapsed, and loads nothing until one is opened', async () => {
    show(); await search();
    expect(urls.find((u) => u.startsWith('/api/batches/search'))).toBe('/api/batches/search?accountId=1');
    const first = screen.getByRole('button', { name: 'Show the mailpieces in batch 7001' });
    expect(first).toHaveAttribute('aria-expanded', 'false');
    expect(within(first).getByText('18/11/2026 09:30')).toBeInTheDocument();
    expect(within(first).getByText('£2.50')).toBeInTheDocument();
    const second = screen.getByRole('button', { name: 'Show the mailpieces in batch 7002' });
    expect(within(second).getByText('of 3 in the batch')).toBeInTheDocument();
    expect(within(second).getByText('1 cancelled')).toBeInTheDocument();
    expect(within(second).getByText('1 not priced')).toBeInTheDocument();
    expect(screen.queryAllByTestId('mailpiece')).toHaveLength(0);
    expect(piecesCalls()).toHaveLength(0);
  });

  it('opens a batch to show its mailpieces in print order, and hides them again', async () => {
    show(); await search();
    await userEvent.click(screen.getByRole('button', { name: 'Show the mailpieces in batch 7001' }));
    await screen.findByText('Mrs A Patel');
    expect(piecesCalls()).toEqual(['/api/recipients/search?accountId=1&batchId=7001&offset=0&limit=50']);
    expect(screen.getAllByTestId('mailpiece')).toHaveLength(2);
    expect(screen.getByLabelText('Print order 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hide the mailpieces in batch 7001' })).toHaveAttribute('aria-expanded', 'true');
    // the letters of a mailpiece stay hidden until its own band is clicked
    expect(screen.queryAllByTestId('pack')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Show the letters for Mrs A Patel' }));
    expect(screen.getAllByTestId('pack')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Hide the mailpieces in batch 7001' }));
    expect(screen.queryAllByTestId('mailpiece')).toHaveLength(0);
    // opening it again does not fetch again
    await userEvent.click(screen.getByRole('button', { name: 'Show the mailpieces in batch 7001' }));
    expect(await screen.findByText('Mrs A Patel')).toBeInTheDocument();
    expect(piecesCalls()).toHaveLength(1);
  });

  it('opens and closes a batch from the keyboard', async () => {
    show(); await search();
    screen.getByRole('button', { name: 'Show the mailpieces in batch 7001' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(await screen.findByText('Mr J Smith')).toBeInTheDocument();
    await userEvent.keyboard(' ');
    expect(screen.queryByText('Mr J Smith')).not.toBeInTheDocument();
  });

  it('pages a big batch with Show more', async () => {
    respond = ((inner) => (url: string) => {
      if (url.includes('batchId=7001') && url.includes('offset=0')) return { status: 200, json: { scope: { id: 1, label: 'Odevo' }, rows: [piece(5, 'Mrs A Patel', 1)], truncated: true } };
      if (url.includes('batchId=7001') && url.includes('offset=1')) return { status: 200, json: { scope: { id: 1, label: 'Odevo' }, rows: [piece(6, 'Mr J Smith', 2)], truncated: false } };
      return inner(url);
    })(respond);
    show(); await search();
    await userEvent.click(screen.getByRole('button', { name: 'Show the mailpieces in batch 7001' }));
    await screen.findByText('Mrs A Patel');
    await userEvent.click(screen.getByRole('button', { name: 'Show more mailpieces' }));
    await screen.findByText('Mr J Smith');
    expect(screen.getByText('Mrs A Patel')).toBeInTheDocument();
    expect(piecesCalls()[1]).toContain('offset=1');
    expect(screen.queryByRole('button', { name: 'Show more mailpieces' })).not.toBeInTheDocument();
  });

  it('says so when a batch has no mailpieces in scope, and when loading them fails', async () => {
    respond = ((inner) => (url: string) => url.includes('batchId=7001') ? { status: 200, json: { scope: { id: 1, label: 'Odevo' }, rows: [], truncated: false } } : url.includes('batchId=7002') ? { status: 500, json: { error: 'The database is down' } } : inner(url))(respond);
    show(); await search();
    await userEvent.click(screen.getByRole('button', { name: 'Show the mailpieces in batch 7001' }));
    expect(await screen.findByText('No mailpieces in this batch.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Show the mailpieces in batch 7002' }));
    expect(await screen.findByText(/The database is down/)).toBeInTheDocument();
  });

  it('opens the price of a mailpiece without opening or closing anything else', async () => {
    show(); await search();
    await userEvent.click(screen.getByRole('button', { name: 'Show the mailpieces in batch 7001' }));
    await screen.findByText('Mrs A Patel');
    await userEvent.click(screen.getByRole('button', { name: 'Price of the mailpiece to Mrs A Patel' }));
    await waitFor(() => expect(urls).toContain('/api/mailpieces/5/price'));
    expect(screen.getAllByTestId('mailpiece')).toHaveLength(2);
  });

  it('sends the other criteria', async () => {
    show();
    await userEvent.type(screen.getByLabelText('Batch code'), '7001');
    await userEvent.type(screen.getByLabelText(/^Job/), 'Statements');
    await userEvent.click(screen.getByRole('combobox', { name: /Search in/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Odevo', hidden: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Batch 7001');
    expect(urls.find((u) => u.startsWith('/api/batches/search'))).toBe('/api/batches/search?accountId=1&code=7001&job=Statements');
  });

  it('keeps the search, the opened batches and their mailpieces when you leave and come back, and Clear forgets them', async () => {
    const first = show(); await search();
    await userEvent.click(screen.getByRole('button', { name: 'Show the mailpieces in batch 7001' }));
    await screen.findByText('Mrs A Patel');
    await userEvent.click(screen.getByRole('button', { name: 'Show the letters for Mrs A Patel' }));
    first.unmount();
    const before = urls.length;
    show();
    expect(screen.getByText('Batch 7001')).toBeInTheDocument();
    expect(screen.getByText('Mrs A Patel')).toBeInTheDocument();
    expect(screen.getAllByTestId('pack')).toHaveLength(1);
    await waitFor(() => expect(screen.getByRole('combobox', { name: /Search in/ })).toHaveValue('Odevo'));
    expect(urls.slice(before).filter((u) => !u.startsWith('/api/recipients/scopes'))).toEqual([]); // shown as it was: nothing fetched again
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByText('Batch 7001')).not.toBeInTheDocument();
    cleanup(); show();
    expect(screen.queryByText('Batch 7001')).not.toBeInTheDocument();
  });
});
