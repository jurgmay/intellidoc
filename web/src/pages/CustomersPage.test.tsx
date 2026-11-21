import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { theme } from '../theme';
import { CustomerPage } from './CustomerPage';
import { CustomersPage } from './CustomersPage';

const flags = { isAddressMatching: true, isArchiveMailpieces: false, isCreateOutputFiles: false, isCreateSeparateBatches: false, isNhs: false, isSso: false, isSameDayService: false, isUseMrdf: false, isTesting: false, isDeleted: false };
const detail = () => ({
  id: 7, code: 'ACME', name: 'Acme Energy Ltd', misJobNumber: '24518', returnAddress: 'PO Box 1', colourMode: null, flags, batchingKey: 'Department', packSequenceKey: null,
  parent: null, children: [{ id: 9, code: 'ACME-HL', name: 'Highline Solicitors', isDeleted: false }],
  accounts: [{ id: 8, code: 'ACME-SC', name: 'Acme Scotland', isDeleted: false }],
  brands: [{ id: 21, name: 'Home', usage: 1 }, { id: 22, name: 'Business', usage: 0 }],
  envelopes: [{ id: 31, brandId: 21, brandName: 'Home', deliveryBand: '2nd Class', postalRateId: 1, rateLabel: 'Royal Mail – 2nd Class (Letter), up to 100g', stockItemId: 10, stockCode: 'WH0101', stockDescription: 'C5 white window', reference: null, externalName: null, isOversticker: false }],
  matchRules: [], sequenceRules: [], emails: ['print@acme.example'],
});
const lookups = {
  passthroughKeys: ['Department'], customers: [{ id: 7, code: 'ACME', name: 'Acme Energy Ltd' }, { id: 5, code: 'ODEVO', name: 'Odevo' }], deliveryBands: ['1st Class', '2nd Class'], flagLabels: Object.fromEntries(Object.keys(flags).map((k) => [k, k])),
  postalRates: [{ id: 1, label: 'Royal Mail – 2nd Class (Letter), up to 100g', format: 'Letter' }, { id: 2, label: 'Royal Mail – 1st Class (Letter), up to 100g', format: 'Letter' }],
  envelopeStock: [{ id: 10, code: 'WH0101', description: 'C5 white window', size: 'C5' }],
};
const row = { id: 7, code: 'ACME', name: 'Acme Energy Ltd', misJobNumber: '24518', parentId: null as number | null, parentCode: null as string | null, isAddressMatching: true, isTesting: false, isDeleted: false, accountCount: 1, brandCount: 2, envelopeCount: 1 };

let calls: { url: string; method: string; body?: any }[];
let respond: (url: string, method: string, body: any) => { status: number; json?: unknown };

const json = (r: { status: number; json?: unknown }) => new Response(r.status === 204 ? null : JSON.stringify(r.json ?? {}), { status: r.status });
beforeEach(() => {
  calls = [];
  respond = (url, method) => {
    if (url.startsWith('/api/customers?')) return { status: 200, json: { rows: [row] } };
    if (url === '/api/customers/lookups') return { status: 200, json: lookups };
    if (url === '/api/customers/7' && method === 'GET') return { status: 200, json: detail() };
    if (url === '/api/customers/7' && method === 'PUT') return { status: 200, json: detail() };
    if (url.startsWith('/api/customers/7/history')) return { status: 200, json: { rows: [{ id: 1, changedAt: '2026-11-20T10:00:00Z', changedBy: 'system', summary: 'Address matching: off → on' }] } };
    return { status: 204 };
  };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const call = { url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    return json(respond(call.url, call.method, call.body));
  }));
});
afterEach(() => vi.unstubAllGlobals());

const wrap = (path: string) => render(
  <MantineProvider theme={theme}><Notifications />
    <MemoryRouter initialEntries={[path]}><Routes><Route path="/customers" element={<CustomersPage />} /><Route path="/customers/:id" element={<CustomerPage />} /></Routes></MemoryRouter>
  </MantineProvider>,
);

describe('Customers list', () => {
  it('lists customers with their counts and searches as you type', async () => {
    wrap('/customers');
    expect(await screen.findByText('Acme Energy Ltd')).toBeInTheDocument();
    expect(screen.getByText('Matching')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Search customers'), 'acme');
    await waitFor(() => expect(calls.some((c) => c.url === '/api/customers?search=acme')).toBe(true));
  });

  it('creates a customer and opens it', async () => {
    respond = ((prev) => (url, method, body) => (url === '/api/customers' && method === 'POST' ? { status: 201, json: { id: 7 } } : prev(url, method, body)))(respond);
    wrap('/customers');
    await userEvent.click(await screen.findByRole('button', { name: /new customer/i }));
    await userEvent.type(await screen.findByLabelText('Account code'), ' NEW1 ');
    await userEvent.type(screen.getByLabelText('Name'), 'New Co');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ code: 'NEW1', name: 'New Co' }));
    expect(await screen.findByRole('heading', { name: 'Acme Energy Ltd' })).toBeInTheDocument();
  });

  it('shows the server’s message for a duplicate code and stays open', async () => {
    respond = ((prev) => (url, method, body) => (url === '/api/customers' && method === 'POST' ? { status: 409, json: { error: 'Account code "NEW1" is already in use' } } : prev(url, method, body)))(respond);
    wrap('/customers');
    await userEvent.click(await screen.findByRole('button', { name: /new customer/i }));
    await userEvent.type(await screen.findByLabelText('Account code'), 'NEW1');
    await userEvent.type(screen.getByLabelText('Name'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findAllByText(/already in use/)).not.toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
  });
});

describe('Hierarchy', () => {
  it('lists a child customer directly under its parent', async () => {
    const child = { ...row, id: 9, code: 'ACME-HL', name: 'Highline Solicitors', parentId: 7, parentCode: 'ACME' };
    const other = { ...row, id: 3, code: 'ZED', name: 'Zed Ltd' };
    respond = ((prev) => (url, method, body) => (url.startsWith('/api/customers?') ? { status: 200, json: { rows: [row, other, child].sort((a, b) => (a.name < b.name ? -1 : 1)) } } : prev(url, method, body)))(respond);
    wrap('/customers');
    await screen.findByText('Highline Solicitors');
    const names = screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[1]!.textContent);
    expect(names).toEqual(['Acme Energy Ltd', 'Highline Solicitors', 'Zed Ltd']);
  });
  it('says which parent a child belongs to when the parent is filtered out of the list', async () => {
    const child = { ...row, id: 9, code: 'ACME-HL', name: 'Highline Solicitors', parentId: 7, parentCode: 'ACME' };
    respond = ((prev) => (url, method, body) => (url.startsWith('/api/customers?') ? { status: 200, json: { rows: [child] } } : prev(url, method, body)))(respond);
    wrap('/customers');
    expect(await screen.findByText(/part of ACME/)).toBeInTheDocument();
  });
  it('shows the parent on the child and the children on the parent', async () => {
    respond = ((prev) => (url, method, body) => (url === '/api/customers/7' && method === 'GET' ? { status: 200, json: { ...detail(), parent: { id: 5, code: 'ODEVO', name: 'Odevo' }, children: [] } } : prev(url, method, body)))(respond);
    wrap('/customers/7');
    expect(await screen.findByRole('link', { name: 'Odevo' })).toHaveAttribute('href', '/customers/5');
  });
  it('lists child customers on the Accounts tab', async () => {
    wrap('/customers/7');
    await userEvent.click(await screen.findByRole('tab', { name: /Accounts/ }));
    expect(await screen.findByRole('link', { name: 'Highline Solicitors' })).toHaveAttribute('href', '/customers/9');
  });
  it('saves a chosen parent', async () => {
    wrap('/customers/7');
    await userEvent.click(await screen.findByRole('combobox', { name: /Parent customer/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Odevo (ODEVO)', hidden: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ parentId: 5 }));
  });
  it('never offers the customer itself as its own parent', async () => {
    wrap('/customers/7');
    await userEvent.click(await screen.findByRole('combobox', { name: /Parent customer/ }));
    await screen.findByRole('option', { name: 'Odevo (ODEVO)', hidden: true });
    expect(screen.queryByRole('option', { name: 'Acme Energy Ltd (ACME)', hidden: true })).toBeNull();
  });
});

describe('Customer page', () => {
  it('saves changed details, sending the unchanged fields too, and only enables Save once something changed', async () => {
    wrap('/customers/7');
    const save = await screen.findByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    const mis = screen.getByLabelText(/MIS job number/);
    await userEvent.clear(mis); await userEvent.type(mis, '999');
    await userEvent.click(save);
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ code: 'ACME', name: 'Acme Energy Ltd', misJobNumber: '999', batchingKey: 'Department', parentId: null, flags: { isAddressMatching: true } }));
  });

  it('shows the envelope settings and adds one with the chosen values', async () => {
    wrap('/customers/7');
    await userEvent.click(await screen.findByRole('tab', { name: /Envelopes/ }));
    expect(await screen.findByText(/WH0101 – C5 white window/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add envelope' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByLabelText(/^Brand/));
    await userEvent.click(await screen.findByRole('option', { name: 'Business', hidden: true }));
    await userEvent.type(within(dialog).getByLabelText(/Delivery band/), '1st Class');
    await userEvent.click(within(dialog).getByLabelText(/^Postal service/));
    await userEvent.click(await screen.findByRole('option', { name: /1st Class \(Letter\)/, hidden: true }));
    await userEvent.click(within(dialog).getByLabelText('Envelope'));
    await userEvent.click(await screen.findByRole('option', { name: /WH0101/, hidden: true }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.url === '/api/customers/7/envelopes')?.body).toEqual({
      brandId: 22, deliveryBand: '1st Class', postalRateId: 2, stockItemId: 10, reference: null, externalName: null, isOversticker: false,
    }));
  });

  it('keeps the envelope form open and shows the message when the server refuses a duplicate', async () => {
    respond = ((prev) => (url, method, body) => (url === '/api/customers/7/envelopes' ? { status: 409, json: { error: 'There is already an envelope setting for this brand' } } : prev(url, method, body)))(respond);
    wrap('/customers/7');
    await userEvent.click(await screen.findByRole('tab', { name: /Envelopes/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    respond = ((prev) => (url, method, body) => (url === '/api/envelopes/31' ? { status: 409, json: { error: 'There is already an envelope setting for this brand' } } : prev(url, method, body)))(respond);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText(/already an envelope setting/)).toBeInTheDocument();
  });

  it('will not offer to delete a brand that is in use', async () => {
    wrap('/customers/7');
    await userEvent.click(await screen.findByRole('tab', { name: /Brands/ }));
    const rows = await screen.findAllByRole('row');
    const home = rows.find((r) => within(r).queryByText('Home'))!;
    const business = rows.find((r) => within(r).queryByText('Business'))!;
    expect(within(home).getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(within(business).getByRole('button', { name: 'Delete' })).toBeEnabled();
  });

  it('saves an include matching rule without a value', async () => {
    wrap('/customers/7');
    await userEvent.click(await screen.findByRole('tab', { name: /Matching/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add rule' }));
    await userEvent.type(screen.getByRole('combobox', { name: 'Rule 1 passthrough key' }), 'Department');
    await userEvent.click(screen.getByRole('button', { name: 'Save rules' }));
    await waitFor(() => expect(calls.find((c) => c.url === '/api/customers/7/match-rules')?.body).toEqual({ rules: [{ isInclude: true, key: 'Department', value: null }] }));
  });

  it('shows the server’s rule error next to the rule', async () => {
    respond = ((prev) => (url, method, body) => (url === '/api/customers/7/sequence-rules' ? { status: 422, json: { errors: { 'rules.0': 'Row 1: the value is required' } } } : prev(url, method, body)))(respond);
    wrap('/customers/7');
    await userEvent.click(await screen.findByRole('tab', { name: /Matching/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add row' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save order' }));
    expect(await screen.findAllByText('Row 1: the value is required')).not.toHaveLength(0);
  });

  it('saves notification e-mails one per line', async () => {
    wrap('/customers/7');
    await userEvent.click(await screen.findByRole('tab', { name: /Notifications/ }));
    const box = await screen.findByLabelText('Notification e-mail addresses');
    await userEvent.type(box, '{enter}ops@acme.example');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.url === '/api/customers/7/emails')?.body).toEqual({ emails: ['print@acme.example', 'ops@acme.example'] }));
  });

  it('shows the history', async () => {
    wrap('/customers/7');
    await userEvent.click(await screen.findByRole('tab', { name: 'History' }));
    expect(await screen.findByText('Address matching: off → on')).toBeInTheDocument();
  });
});
