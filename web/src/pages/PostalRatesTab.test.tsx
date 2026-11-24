import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { theme } from '../theme';
import { PostalRatesTab } from './PostalRatesTab';

const rate = (id: number, over: object = {}) => ({ id, minWeightG: 0, maxWeightG: 100, validFrom: '2026-04-01', validTo: null, cost: 0.61, sellPrice: 0.66, usedBy: 0, status: 'current', ...over });
const overview = () => ({
  today: '2026-11-21', formats: [{ id: 1, name: 'Letter' }],
  providers: [{ id: 1, name: 'Royal Mail', services: [{ id: 5, name: '2nd Class', formatId: 1, formatName: 'Letter', serviceCode: 'STL2', isSignedFor: false, isTracked: false, isRecorded: false,
    rates: [rate(11, { usedBy: 3 }), rate(10, { validFrom: '2025-04-01', validTo: '2026-03-31', cost: 0.5, sellPrice: 0.55, status: 'ended', usedBy: 9 })] }] }],
});
let calls: { url: string; method: string; body?: any }[]; // eslint-disable-line @typescript-eslint/no-explicit-any
let failNext: Response | null;

const wrap = () => render(<MantineProvider theme={theme}><Notifications /><PostalRatesTab /></MantineProvider>);
beforeEach(() => {
  calls = []; failNext = null;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : undefined });
    if (failNext && init?.method) { const r = failNext; failNext = null; return r; }
    if (url === '/api/postal/history') return new Response(JSON.stringify({ rows: [{ id: 1, changedAt: '2026-11-20T10:00:00Z', changedBy: 'sam', summary: 'Postal: added provider "Royal Mail"' }] }), { status: 200 });
    if (url === '/api/postal') return new Response(JSON.stringify(overview()), { status: 200 });
    if (url.endsWith('/price-change')) return new Response(JSON.stringify({ changed: 1 }), { status: 200 });
    return new Response(init?.method === 'POST' ? JSON.stringify({ id: 99 }) : null, { status: init?.method === 'POST' ? 201 : 204 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('PostalRatesTab', () => {
  it('shows current prices, hides ended ones until asked, and lists the change log', async () => {
    wrap();
    expect(await screen.findByText('2nd Class')).toBeInTheDocument();
    expect(screen.getByText('up to 100g')).toBeInTheDocument();
    expect(screen.queryByText('0.50')).not.toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Show ended prices'));
    expect(screen.getByText('0.50')).toBeInTheDocument();
    expect(screen.getByText(/added provider "Royal Mail"/)).toBeInTheDocument();
  });
  it('will not delete a price that is in use', async () => {
    wrap(); await screen.findByText('2nd Class');
    const row = screen.getByText('up to 100g').closest('tr')!;
    expect(within(row).getByRole('button', { name: 'Delete' })).toBeDisabled();
  });
  it('changes prices from a date, sending only the rows that changed', async () => {
    wrap(); await screen.findByText('2nd Class');
    await userEvent.click(screen.getByRole('button', { name: 'Change prices from a date' }));
    const dlg = await screen.findByRole('dialog');
    const inputs = within(dlg).getAllByRole('textbox');
    // [0] is the date box (type=date has no textbox role in jsdom? it does), so find the cost and sell boxes by value.
    const cost = inputs.find((i) => (i as HTMLInputElement).value === '0.61')!;
    await userEvent.clear(cost); await userEvent.type(cost, '0.7');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save new prices' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/postal/services/5/price-change')).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/price-change'))!.body).toEqual({ effectiveFrom: '2026-11-21', changes: [{ rateId: 11, cost: 0.7, sellPrice: 0.66 }] });
  });
  it('adds a weight band and shows the server\'s field errors', async () => {
    wrap(); await screen.findByText('2nd Class');
    await userEvent.click(screen.getByRole('button', { name: 'Add weight band' }));
    const dlg = await screen.findByRole('dialog');
    failNext = new Response(JSON.stringify({ errors: { maxWeightG: 'The highest weight cannot be below the lowest' } }), { status: 422 });
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    expect(await within(dlg).findByText('The highest weight cannot be below the lowest')).toBeInTheDocument();
    await userEvent.type(within(dlg).getByLabelText('Up to weight (g)'), '250');
    await userEvent.click(within(dlg).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url === '/api/postal/services/5/rates' && c.body.maxWeightG === 250)).toBe(true));
  });
  it('locks the weights of a used price in the edit form', async () => {
    wrap(); await screen.findByText('2nd Class');
    const row = screen.getByText('up to 100g').closest('tr')!;
    await userEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByLabelText('Up to weight (g)')).toBeDisabled();
    expect(within(dlg).getByLabelText('Last day')).not.toBeDisabled();
  });
  it('imports a price list: check first, then import', async () => {
    const plan = { startDate: '2027-01-01', endDate: null, fileRows: 2, newProviders: [], services: [], errors: [], warnings: [{ row: null, message: '1 price has more than 4 decimal places. They are stored rounded to 4.' }], canImport: true,
      counts: { newProviders: 0, newServices: 1, newBands: 1, changedBands: 1, updatedBands: 0, unchangedBands: 0, blockedBands: 0, skippedRows: 0 },
      bands: [{ key: 'a', provider: 'Royal Mail', service: '2nd Class', format: 'Letter', minWeightG: 0, maxWeightG: 100, cost: 0.7, sellPrice: 0.8, action: 'change', row: 2, before: { rateId: 11, cost: 0.61, sellPrice: 0.66, validFrom: '2026-04-01', validTo: null }, message: null }] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fetchMock = vi.mocked(fetch) as any;
    const base = fetchMock.getMockImplementation()!;
    const imports: string[] = [];
    fetchMock.mockImplementation(async (url: string, init?: { method?: string; body?: unknown }) => {
      if (url.startsWith('/api/postal/import')) { imports.push(url); return new Response(JSON.stringify({ plan, result: url.includes('apply=1') ? { newProviders: 0, newServices: 1, newBands: 1, changedBands: 1, updatedBands: 0, unchangedBands: 0 } : null }), { status: 200 }); }
      return base(url, init);
    });
    wrap(); await screen.findByText('2nd Class');
    await userEvent.click(screen.getByRole('button', { name: /Import prices/ }));
    const dlg = await screen.findByRole('dialog');
    expect(within(dlg).getByRole('button', { name: 'Check file' })).toBeDisabled();
    await userEvent.upload(dlg.querySelector('input[type="file"]') as HTMLInputElement, new File(['x'], 'rates.csv', { type: 'text/csv' }));
    await userEvent.click(within(dlg).getByRole('button', { name: 'Check file' }));
    expect(await within(dlg).findByText(/0.61 → 0.7/)).toBeInTheDocument();
    expect(within(dlg).getByText(/more than 4 decimal places/)).toBeInTheDocument();
    expect(imports[0]).toMatch(/start=2026-11-21&apply=0&name=rates\.csv/);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Import prices' }));
    await waitFor(() => expect(imports[1]).toContain('apply=1'));
  });
});
