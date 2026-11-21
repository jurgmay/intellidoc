import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { theme } from '../theme';
import { RecipientSearchPage } from './RecipientSearchPage';

const scopes = [{ id: 1, label: 'Odevo', isCustomer: true }, { id: 2, label: 'Odevo > Highline Solicitors', isCustomer: false }];
const hit = {
  packId: 9, mailpieceId: 5, batchCode: 7001, batchStatus: 'Printed', job: 'job-9', releaseDate: '2026-11-18T09:30:00', addressLines: ['Mrs A Patel', '12 Mill Lane', 'Leeds'], postcode: 'LS1 4AB',
  accountCode: 'ODEVO_HIGHLINE', accountName: 'Highline Solicitors', accountPath: 'Odevo > Highline Solicitors', invoicingCode: 'ODEVO', invoicingName: 'Odevo', brand: 'Home', references: { 'Tenant Reference': 'T-1001' },
};
let urls: string[];
let respond: (url: string) => { status: number; json: unknown };

beforeEach(() => {
  urls = [];
  respond = (url) => url.startsWith('/api/recipients/scopes') ? { status: 200, json: { rows: scopes } } : { status: 200, json: { scope: { id: 1, label: 'Odevo' }, rows: [hit], truncated: false } };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { urls.push(url); const r = respond(url); return new Response(JSON.stringify(r.json), { status: r.status }); }));
});
afterEach(() => vi.unstubAllGlobals());
const show = () => render(<MantineProvider theme={theme}><MemoryRouter><RecipientSearchPage /></MemoryRouter></MantineProvider>);

describe('RecipientSearchPage', () => {
  it('will not search until an account is chosen', async () => {
    show();
    await userEvent.type(screen.getByLabelText('Name'), 'patel');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText(/Choose the account to search in/)).toBeInTheDocument();
    expect(urls.some((u) => u.startsWith('/api/recipients/search'))).toBe(false);
  });

  it('searches the chosen account with the terms entered and shows the hit', async () => {
    show();
    await waitFor(() => expect(urls).toContain('/api/recipients/scopes'));
    await userEvent.click(screen.getByRole('combobox', { name: /Search in/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Odevo', hidden: true }));
    await userEvent.type(screen.getByLabelText('Name'), ' patel ');
    await userEvent.type(screen.getByLabelText('Reference'), 'T-10*');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    const row = await screen.findByText('Mrs A Patel');
    const search = urls.find((u) => u.startsWith('/api/recipients/search'))!;
    expect(new URLSearchParams(search.split('?')[1])).toEqual(new URLSearchParams({ accountId: '1', name: 'patel', reference: 'T-10*' }));
    const tr = row.closest('tr')!;
    expect(within(tr).getByText('Odevo > Highline Solicitors')).toBeInTheDocument();
    expect(within(tr).getByText('7001')).toBeInTheDocument();
    expect(within(tr).getByText('T-1001')).toBeInTheDocument();
    expect(screen.getByText(/1 found in Odevo and below/)).toBeInTheDocument();
  });

  it('shows the server\'s message next to the field, and says when there are more results', async () => {
    show();
    await waitFor(() => expect(urls).toContain('/api/recipients/scopes'));
    await userEvent.click(screen.getByRole('combobox', { name: /Search in/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Odevo', hidden: true }));
    respond = () => ({ status: 422, json: { errors: { name: 'Enter a name, address, reference or date range to search for.' } } });
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText(/Enter a name, address, reference/)).toBeInTheDocument();
    respond = () => ({ status: 200, json: { scope: { id: 1, label: 'Odevo' }, rows: [hit], truncated: true } });
    await userEvent.type(screen.getByLabelText('Name'), 'patel');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText(/Narrow the search/)).toBeInTheDocument();
  });
});
