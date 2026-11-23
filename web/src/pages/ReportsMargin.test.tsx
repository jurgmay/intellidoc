import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { theme } from '../theme';
import { ReportsPage } from './ReportsPage';

const c = (mailpieces: number, sell: number, cost: number, unpriced = 0) => ({
  mailpieces, unpriced, productionSell: sell / 2, productionCost: cost / 2, postageSell: sell / 2, postageCost: cost / 2, sell, cost, margin: Math.round((sell - cost) * 100) / 100, marginPct: sell > 0 ? Math.round(((sell - cost) / sell) * 1000) / 10 : null,
});
const report = {
  account: { id: 5, code: 'ODEVO', name: 'Odevo' }, from: '2026-11-01', to: '2026-11-02',
  days: [{ day: '2026-11-01', ...c(0, 0, 0) }, { day: '2026-11-02', ...c(15, 20, 16.5, 2) }],
  brands: [{ brand: 'Home', ...c(15, 20, 16.5, 2) }], postage: [{ format: 'Letter', service: '2nd Class', ...c(15, 20, 16.5, 2) }],
  totals: c(15, 20, 16.5, 2),
};
let urls: string[];
let respond: (url: string) => { status: number; json: unknown };
beforeEach(() => {
  urls = [];
  respond = (url) => url.startsWith('/api/reports/invoicing-accounts') ? { status: 200, json: { rows: [{ id: 5, code: 'ODEVO', name: 'Odevo' }] } } : { status: 200, json: report };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { urls.push(url); const r = respond(url); return new Response(JSON.stringify(r.json), { status: r.status }); }));
});
afterEach(() => vi.unstubAllGlobals());
const choose = async () => {
  render(<MantineProvider theme={theme}><MemoryRouter><ReportsPage /></MemoryRouter></MantineProvider>);
  await waitFor(() => expect(urls).toContain('/api/reports/invoicing-accounts'));
  await userEvent.click(screen.getByRole('combobox', { name: /Invoicing account/ }));
  await userEvent.click(await screen.findByRole('option', { name: 'Odevo (ODEVO)', hidden: true }));
  await chooseMargin();
};
const chooseMargin = async () => {
  await userEvent.click(screen.getByRole('combobox', { name: 'Report' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Margin report', hidden: true }));
};

describe('Reports page: margin report', () => {
  it('is one module: the usage report is the default, and the same form drives both', async () => {
    render(<MantineProvider theme={theme}><MemoryRouter><ReportsPage /></MemoryRouter></MantineProvider>);
    expect(screen.getByRole('heading', { name: 'Reports' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Report' })).toHaveValue('Usage report');
    expect(screen.getByText('PDF')).toBeInTheDocument();
    await chooseMargin();
    expect(screen.queryByText('PDF')).toBeNull();   // the margin report is screen only
    expect(screen.getByText(/Internal: shows costs/)).toBeInTheDocument();
  });
  it('clears the report on screen when the type is changed', async () => {
    await choose();
    await userEvent.click(screen.getByRole('button', { name: 'Show report' }));
    expect(await screen.findByRole('table', { name: 'By day' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('combobox', { name: 'Report' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Usage report', hidden: true }));
    expect(screen.queryByRole('table', { name: 'By day' })).toBeNull();
  });
  it('needs an invoicing account before it reports', async () => {
    render(<MantineProvider theme={theme}><MemoryRouter><ReportsPage /></MemoryRouter></MantineProvider>);
    await chooseMargin();
    await userEvent.click(screen.getByRole('button', { name: 'Show report' }));
    expect(await screen.findByText('Choose the invoicing account to report on.')).toBeInTheDocument();
    expect(urls.some((u) => u.startsWith('/api/reports/margin'))).toBe(false);
  });
  it('shows sell, cost, margin and margin %, and warns about unpriced mail', async () => {
    await choose();
    const from = screen.getByLabelText('From'); const to = screen.getByLabelText('To');
    await userEvent.clear(from); await userEvent.type(from, '2026-11-01');
    await userEvent.clear(to); await userEvent.type(to, '2026-11-02');
    await userEvent.click(screen.getByRole('button', { name: 'Show report' }));
    expect(await screen.findByRole('table', { name: 'By day' })).toBeInTheDocument();
    expect(urls).toContain('/api/reports/margin?invoicingAccountId=5&from=2026-11-01&to=2026-11-02');
    const days = within(screen.getByRole('table', { name: 'By day' }));
    expect(days.getByText('02/11/2026')).toBeInTheDocument();
    expect(days.getByText('£20.00')).toBeInTheDocument();
    expect(days.getByText('£16.50')).toBeInTheDocument();
    expect(days.getByText('£3.50')).toBeInTheDocument();
    expect(days.getByText('17.5%')).toBeInTheDocument();
    expect(screen.getByText(/2 of 15 mailpieces have no price/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /PDF/ })).toBeNull();     // internal, screen only
  });
  it('shows a loss in red and no percentage when nothing was sold', async () => {
    respond = (url) => url.startsWith('/api/reports/invoicing-accounts') ? { status: 200, json: { rows: [{ id: 5, code: 'ODEVO', name: 'Odevo' }] } }
      : { status: 200, json: { ...report, days: [{ day: '2026-11-02', ...c(3, 10, 12) }, { day: '2026-11-03', ...c(1, 0, 1) }] } };
    await choose();
    await userEvent.click(screen.getByRole('button', { name: 'Show report' }));
    const days = within(await screen.findByRole('table', { name: 'By day' }));
    expect(days.getByText('-£2.00')).toBeInTheDocument();
    expect(days.getByText('-20.0%')).toBeInTheDocument();
    expect(days.getByText('–')).toBeInTheDocument();
  });
});
