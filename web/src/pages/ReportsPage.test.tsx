import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { theme } from '../theme';
import { ReportsPage } from './ReportsPage';

const report = {
  account: { id: 5, code: 'ODEVO', name: 'Odevo' }, from: '2026-11-01', to: '2026-11-02',
  days: [{ day: '2026-11-01', mailpieces: 0, packs: 0, sheets: 0, byBrand: {} }, { day: '2026-11-02', mailpieces: 15, packs: 17, sheets: 40, byBrand: { Home: 15 } }],
  brands: [{ brand: 'Home', mailpieces: 15, packs: 17, sheets: 40 }], postage: [{ format: 'Letter', service: '2nd Class', mailpieces: 15, packs: 17, sheets: 40 }],
  totals: { mailpieces: 15, packs: 17, sheets: 40 },
};
let urls: string[];
let respond: (url: string) => { status: number; json: unknown };
beforeEach(() => {
  urls = [];
  respond = (url) => url.startsWith('/api/reports/invoicing-accounts') ? { status: 200, json: { rows: [{ id: 5, code: 'ODEVO', name: 'Odevo' }] } } : { status: 200, json: report };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { urls.push(url); const r = respond(url); return new Response(JSON.stringify(r.json), { status: r.status }); }));
});
afterEach(() => vi.unstubAllGlobals());
const show = () => render(<MantineProvider theme={theme}><MemoryRouter><ReportsPage /></MemoryRouter></MantineProvider>);
const choose = async () => {
  await waitFor(() => expect(urls).toContain('/api/reports/invoicing-accounts'));
  await userEvent.click(screen.getByRole('combobox', { name: /Invoicing account/ }));
  await userEvent.click(await screen.findByRole('option', { name: 'Odevo (ODEVO)', hidden: true }));
};

describe('ReportsPage', () => {
  it('needs an invoicing account before it reports', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Show report' }));
    expect(await screen.findByText('Choose the invoicing account to report on.')).toBeInTheDocument();
    expect(urls.some((u) => u.startsWith('/api/reports/usage'))).toBe(false);
  });
  it('shows the totals and tables, and links the PDF for the same account and days', async () => {
    show();
    await choose();
    const from = screen.getByLabelText('From'); const to = screen.getByLabelText('To');
    await userEvent.clear(from); await userEvent.type(from, '2026-11-01');
    await userEvent.clear(to); await userEvent.type(to, '2026-11-02');
    await userEvent.click(screen.getByRole('button', { name: 'Show report' }));
    expect(await screen.findByText('Mailpieces per day')).toBeInTheDocument();
    expect(urls).toContain('/api/reports/usage?invoicingAccountId=5&from=2026-11-01&to=2026-11-02');
    expect(screen.getByText('02/11/2026')).toBeInTheDocument();
    expect(screen.getByText('2nd Class')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /PDF/ })).toHaveAttribute('href', '/api/reports/usage.pdf?invoicingAccountId=5&from=2026-11-01&to=2026-11-02');
  });
  it('shows the server\'s message next to the field', async () => {
    show();
    await choose();
    respond = () => ({ status: 422, json: { errors: { to: 'The last day is before the first day.' } } });
    await userEvent.click(screen.getByRole('button', { name: 'Show report' }));
    expect(await screen.findByText('The last day is before the first day.')).toBeInTheDocument();
  });
});
