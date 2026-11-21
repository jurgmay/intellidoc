import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { theme } from '../theme';
import { CostingTab } from './customer/CostingTab';
import type { TabProps } from './customer/shared';
import type { CostingOverview, ModelDetail } from '../api/costing';

const summary = { id: 5, name: '2026 prices', validFrom: '2026-01-01', validTo: null, isActive: true, mailpieceCount: 0 };
const overview = (over: Partial<CostingOverview> = {}): CostingOverview => ({ customerId: 7, mode: 'OWN', inheritsAll: false, source: null, models: [summary], sourceModels: [], inForceId: 5, ...over });
const model = (over: Partial<ModelDetail> = {}): ModelDetail => ({
  ...summary, customerId: 7, comments: null, copiedFrom: null, ...over,
  charges: [
    { code: 'HPOD', label: 'H-POD processing', group: 'Print', cost: 0.1, sellPrice: 0.2, adjustment: 0 },
    { code: 'MONO_PAGE', label: 'Mono page', group: 'Print', cost: 0.02, sellPrice: 0.04, adjustment: 0.01 },
    { code: 'ADJUSTMENT', label: 'General adjustment (sell price only)', group: 'Adjustments', cost: 0, sellPrice: 0.5, adjustment: 0 },
  ],
  envelopes: [{ stockItemId: 10, stockCode: 'C5', description: 'C5 window', size: 'C5', cost: 0.02, sellPrice: 0.04, adjustment: 0 }],
  postage: [{ postalRateId: 1, label: 'RM 2nd letter', format: 'Letter', suggestedCost: 0.6, suggestedSell: 0.65, adjustment: 0.05 }],
});
const props = (parent: boolean): TabProps => ({
  detail: { id: 7, parent: parent ? { id: 3, code: 'ODEVO', name: 'Odevo' } : null } as never, lookups: {} as never, reload: async () => {}, patchDetails: async () => {},
});

let calls: { url: string; method: string; body?: any }[];
let respond: (url: string, method: string, body: any) => { status: number; json?: unknown };
const json = (r: { status: number; json?: unknown }) => new Response(r.status === 204 ? null : JSON.stringify(r.json ?? {}), { status: r.status });
beforeEach(() => {
  calls = [];
  respond = (url, method) => {
    if (url === '/api/customers/7/costing') return { status: 200, json: overview() };
    if (url === '/api/costing-models/5' && method === 'GET') return { status: 200, json: model() };
    if (url === '/api/costing/lookups') return { status: 200, json: { envelopeStock: [{ id: 10, code: 'C5', description: 'C5 window', size: 'C5' }, { id: 11, code: 'C4', description: 'C4 window', size: 'C4' }] } };
    return { status: 204 };
  };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const call = { url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    return json(respond(call.url, call.method, call.body));
  }));
});
afterEach(() => vi.unstubAllGlobals());

const wrap = (p: TabProps) => render(<MantineProvider theme={theme}><Notifications /><MemoryRouter><Routes><Route path="/" element={<CostingTab {...p} />} /></Routes></MemoryRouter></MantineProvider>);

describe('Costing tab', () => {
  it('lists the models with their dates and status', async () => {
    wrap(props(true));
    expect(await screen.findByText('2026 prices')).toBeInTheDocument();
    expect(screen.getByText('2026-01-01 to until replaced')).toBeInTheDocument();
    expect(screen.getByText('In force')).toBeInTheDocument();
  });

  it('warns when nothing prices today’s mail', async () => {
    respond = ((prev) => (url, m, b) => (url === '/api/customers/7/costing' ? { status: 200, json: overview({ inForceId: null }) } : prev(url, m, b)))(respond);
    wrap(props(true));
    expect(await screen.findByText(/no model prices today/i)).toBeInTheDocument();
  });

  it('shows the parent’s models, read only, when the prices are inherited', async () => {
    respond = ((prev) => (url, m, b) => (url === '/api/customers/7/costing' ? { status: 200, json: overview({ mode: 'INHERIT', models: [], source: { id: 3, code: 'ODEVO', name: 'Odevo' }, sourceModels: [{ ...summary, id: 9, name: 'Odevo prices' }], inForceId: 9 }) } : prev(url, m, b)))(respond);
    wrap(props(true));
    expect(await screen.findByText('Odevo prices')).toBeInTheDocument();
    expect(screen.getByText(/prices come from odevo/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /new model/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open' })).not.toBeInTheDocument();
  });

  it('changes where the prices come from', async () => {
    respond = ((prev) => (url, m, b) => (url === '/api/customers/7/costing-mode' ? { status: 200, json: overview({ mode: 'INHERIT' }) } : prev(url, m, b)))(respond);
    wrap(props(true));
    await userEvent.click(await screen.findByRole('combobox', { name: 'Where the prices come from' }));
    await userEvent.click(await screen.findByRole('option', { name: "The parent's price lists", hidden: true }));
    await waitFor(() => expect(calls.find((c) => c.url === '/api/customers/7/costing-mode')?.body).toEqual({ mode: 'INHERIT' }));
  });

  it('cannot choose when the customer has no parent', async () => {
    wrap(props(false));
    expect(await screen.findByRole('combobox', { name: 'Where the prices come from' })).toBeDisabled();
  });

  it('creates a model from a copy and opens it', async () => {
    respond = ((prev) => (url, m, b) => (url === '/api/customers/7/costing-models' && m === 'POST' ? { status: 201, json: { id: 5 } } : prev(url, m, b)))(respond);
    wrap(props(true));
    await userEvent.click(await screen.findByRole('button', { name: /new model/i }));
    await userEvent.type(await screen.findByLabelText('Name'), '2027 prices');
    await userEvent.click(screen.getByRole('combobox', { name: /start from/i }));
    await userEvent.click(await screen.findByRole('option', { name: '2026 prices (2026-01-01)', hidden: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST')?.body).toMatchObject({ name: '2027 prices', copyFromId: 5, isActive: true }));
    expect(await screen.findByRole('heading', { name: '2026 prices' })).toBeInTheDocument();
  });

  it('shows the server’s message when a model already starts that day', async () => {
    respond = ((prev) => (url, m, b) => (url === '/api/customers/7/costing-models' && m === 'POST' ? { status: 409, json: { error: 'This customer already has a costing model starting on that day.' } } : prev(url, m, b)))(respond);
    wrap(props(true));
    await userEvent.click(await screen.findByRole('button', { name: /new model/i }));
    await userEvent.type(await screen.findByLabelText('Name'), 'Dup');
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect((await screen.findAllByText(/already has a costing model starting on that day/i)).length).toBeGreaterThan(0);
  });
});

describe('Costing model editor', () => {
  const open = async () => { wrap(props(true)); await userEvent.click(await screen.findByRole('button', { name: 'Open' })); await screen.findByRole('heading', { name: '2026 prices' }); };

  it('shows every price and what the customer pays', async () => {
    await open();
    expect(screen.getByLabelText('H-POD processing sell price')).toHaveValue('0.2000');
    expect(screen.getByText('0.0500')).toBeInTheDocument(); // mono page: sell 0.04 + adjustment 0.01
    expect(screen.getByText('0.7000')).toBeInTheDocument(); // postage: suggested 0.65 + adjustment 0.05
    expect(screen.getByText('0.5000')).toBeInTheDocument(); // sell-only adjustment
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('saves changed prices in one request and marks nothing as unsaved afterwards', async () => {
    respond = ((prev) => (url, m, b) => (url === '/api/costing-models/5' && m === 'PUT' ? { status: 200, json: model({ name: 'Revised' }) } : prev(url, m, b)))(respond);
    await open();
    const sell = screen.getByLabelText('H-POD processing sell price');
    await userEvent.clear(sell); await userEvent.type(sell, '0.25');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')).toBeTruthy());
    const body = calls.find((c) => c.method === 'PUT')!.body;
    expect(body.charges.find((c: { code: string }) => c.code === 'HPOD')).toEqual({ code: 'HPOD', cost: 0.1, sellPrice: 0.25, adjustment: 0 });
    expect(body.envelopes).toEqual([{ stockItemId: 10, cost: 0.02, sellPrice: 0.04, adjustment: 0 }]);
    expect(body.postage).toEqual([{ postalRateId: 1, adjustment: 0.05 }]);
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument());
  });

  it('adds and removes envelope prices', async () => {
    await open();
    await userEvent.click(screen.getByPlaceholderText('Add an envelope…'));
    await userEvent.click(await screen.findByRole('option', { name: /C4 – C4 window/, hidden: true }));
    expect(await screen.findByLabelText('C4 sell price')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove C5' }));
    expect(screen.queryByLabelText('C5 cost')).not.toBeInTheDocument();
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
  });

  it('shows the server’s field errors against the price', async () => {
    respond = ((prev) => (url, m, b) => (url === '/api/costing-models/5' && m === 'PUT' ? { status: 422, json: { errors: { 'charges.0.sellPrice': 'Sell price can have at most 4 decimal places' } } } : prev(url, m, b)))(respond);
    await open();
    const sell = screen.getByLabelText('H-POD processing sell price');
    await userEvent.clear(sell); await userEvent.type(sell, '0.3');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findAllByText(/at most 4 decimal places/i)).length).toBeGreaterThan(0);
    expect(screen.getByText(/some values need fixing/i)).toBeInTheDocument();
  });

  it('explains that used models keep their old prices, and cannot be deleted', async () => {
    respond = ((prev) => (url, m, b) => (url === '/api/costing-models/5' ? { status: 200, json: model({ mailpieceCount: 1200 }) } : prev(url, m, b)))(respond);
    await open();
    expect(screen.getByText(/1,200 mailpieces have been priced with this model/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete model/i })).toBeDisabled();
  });

  it('deletes an unused model after asking', async () => {
    respond = ((prev) => (url, m, b) => (url === '/api/costing-models/5' && m === 'DELETE' ? { status: 204 } : prev(url, m, b)))(respond);
    await open();
    await userEvent.click(screen.getByRole('button', { name: /delete model/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
    expect(await screen.findByRole('button', { name: /new model/i })).toBeInTheDocument();
  });
});
