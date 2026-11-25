import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { theme } from '../theme';
import { CustomerPage } from './CustomerPage';
import { CustomersPage } from './CustomersPage';

const flags = { isAddressMatching: true, isArchiveMailpieces: false, isCreateOutputFiles: false, isSso: false, isSameDayService: false, isUseMrdf: false, isTesting: false, isDeleted: false };
const detail = () => ({
  id: 7, code: 'ACME', name: 'Acme Energy Ltd', misJobNumber: '24518', pendingJobNumber: '24601', pendingFrom: '2026-12-01', jobNumberRolloverDay: 1, modes: { envelopes: 'OWN', brands: 'OWN', matching: 'OWN', sequence: 'OWN', emails: 'OWN', inserts: 'OWN' }, inheritedEnvelopes: [], inserts: [], inheritedInserts: [], inherited: { brands: [], matchRules: [], sequenceRules: [], emails: [], matching: null, sequence: null }, invoicing: null, invoicingOptions: [{ id: 7, code: 'ACME', name: 'Acme Energy Ltd' }], returnAddress: 'PO Box 1', colourMode: 'ORIGINAL', flags, batchingKey: 'Department', packSequenceKey: null,
  parent: null, children: [{ id: 9, code: 'ACME-HL', name: 'Highline Solicitors', isDeleted: false }],
  accounts: [{ id: 8, code: 'ACME-SC', name: 'Acme Scotland', isDeleted: false }],
  brands: [{ id: 21, name: 'Home', usage: 1 }, { id: 22, name: 'Business', usage: 0 }],
  envelopes: [{ id: 31, brandId: 21, brandName: 'Home', deliveryBand: '2nd Class', postalRateId: 1, rateLabel: 'Royal Mail – 2nd Class (Letter), up to 100g', stockItemId: 10, stockCode: 'WH0101', stockDescription: 'C5 white window', reference: null, externalName: null, isOversticker: false }],
  matchRules: [], sequenceRules: [], emails: ['print@acme.example'],
});
const lookups = {
  passthroughKeys: ['Department'], customers: [{ id: 7, code: 'ACME', name: 'Acme Energy Ltd' }, { id: 5, code: 'ODEVO', name: 'Odevo' }], deliveryBands: ['1st Class', '2nd Class'], flagLabels: Object.fromEntries(Object.keys(flags).map((k) => [k, k])),
  postalRates: [{ id: 1, label: 'Royal Mail – 2nd Class (Letter), up to 100g', format: 'Letter' }, { id: 2, label: 'Royal Mail – 1st Class (Letter), up to 100g', format: 'Letter' }],
  insertSizes: [{ id: 1, name: 'A4' }, { id: 2, name: 'DL' }],
  envelopeStock: [{ id: 10, code: 'WH0101', description: 'C5 white window', size: 'C5' }],
};
const row = { id: 7, code: 'ACME', name: 'Acme Energy Ltd', misJobNumber: '24518', pendingJobNumber: '24601' as string | null, parentId: null as number | null, parentCode: null as string | null, isAddressMatching: true, isUseMrdf: false, isSso: false, isTesting: false, isDeleted: false, accountCount: 1, brandCount: 2, envelopeCount: 1 };

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
  it('gives a Testing customer a pale orange row, and no other row', async () => {
    respond = (url) => (url.startsWith('/api/customers?') ? { status: 200, json: { rows: [{ ...row, isTesting: true }, { ...row, id: 8, code: 'LIVE', name: 'Live Co', isTesting: false }] } } : { status: 204 });
    wrap('/customers');
    const test = (await screen.findByText('Acme Energy Ltd')).closest('tr')!;
    expect(test.getAttribute('style')).toMatch(/orange-0/);
    expect(screen.getByText('Live Co').closest('tr')!.getAttribute('style')).not.toMatch(/orange/);
  });
  it('gives a Deleted customer a pale red row, even when it is also Testing', async () => {
    respond = (url) => (url.startsWith('/api/customers?') ? { status: 200, json: { rows: [{ ...row, isDeleted: true, isTesting: true }] } } : { status: 204 });
    wrap('/customers');
    const tr = (await screen.findByText('Acme Energy Ltd')).closest('tr')!;
    expect(tr.getAttribute('style')).toMatch(/red-0/);
    expect(tr.getAttribute('style')).not.toMatch(/orange/);
  });
  it('shows a purple SSO pill for a customer that uses SSO', async () => {
    respond = (url) => (url.startsWith('/api/customers?') ? { status: 200, json: { rows: [{ ...row, isSso: true }] } } : { status: 204 });
    wrap('/customers');
    const pill = await screen.findByText('SSO');
    expect(pill.closest('.mantine-Badge-root')?.getAttribute('style')).toMatch(/violet/);
  });
  it('shows a green MRDF pill for a customer that uses MRDF', async () => {
    respond = (url) => (url.startsWith('/api/customers?') ? { status: 200, json: { rows: [{ ...row, isUseMrdf: true }] } } : { status: 204 });
    wrap('/customers');
    const pill = await screen.findByText('MRDF');
    expect(pill.closest('.mantine-Badge-root')).toHaveAttribute('data-variant', 'light');
    expect(pill.closest('.mantine-Badge-root')?.getAttribute('style')).toMatch(/green/);
  });
  it('lists customers with their counts and searches as you type', async () => {
    wrap('/customers');
    expect(await screen.findByText('Acme Energy Ltd')).toBeInTheDocument();
    expect(screen.getByText('Address matching')).toBeInTheDocument();
    expect(screen.queryByText('MRDF')).not.toBeInTheDocument();
    expect(screen.queryByText('SSO')).not.toBeInTheDocument();
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

describe('Job numbers', () => {
  it('shows the job number and the pending job number in the list, with centred headings', async () => {
    wrap('/customers');
    await screen.findByText('Acme Energy Ltd');
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Name', 'Account code', 'Job number', 'Pending job number', 'Accounts', 'Brands', 'Envelopes', 'Flags']);
    const cells = within(screen.getAllByRole('row')[1]!).getAllByRole('cell').map((c) => c.textContent);
    expect(cells.slice(2, 7)).toEqual(['24518', '24601', '1', '2', '1']);
    const heads = screen.getAllByRole('columnheader');
    for (const name of ['Job number', 'Pending job number', 'Accounts', 'Brands', 'Envelopes']) {
      expect(heads.find((h) => h.textContent === name)).toHaveStyle({ textAlign: 'center' });
    }
  });
  it('says on the Details tab when the pending number takes over, and saves a changed one', async () => {
    wrap('/customers/7');
    expect(await screen.findByText(/Becomes the job number on 1 December 2026/)).toBeInTheDocument();
    const field = screen.getByLabelText('Pending job number');
    await userEvent.clear(field); await userEvent.type(field, '24777');
    expect(screen.getByText(/Becomes the job number on the 1st of the month/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ misJobNumber: '24518', pendingJobNumber: '24777' }));
  });
  it('shows the colour mode and saves a changed one', async () => {
    wrap('/customers/7');
    const combo = await screen.findByRole('combobox', { name: 'Colour mode' });
    expect(combo).toHaveValue('No change (print as in the PDF)');
    await userEvent.click(combo);
    await userEvent.click(within(document.getElementById(combo.getAttribute('aria-controls')!)!).getByRole('option', { name: 'All mono', hidden: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ colourMode: 'ALL_MONO' }));
  });
  it('saves the archive tags and logos, sending null for a cleared one', async () => {
    wrap('/customers/7');
    await userEvent.type(await screen.findByLabelText('Archive customer tag'), 'ACME');
    await userEvent.type(screen.getByLabelText('Archive provider tag'), 'IRON');
    await userEvent.type(screen.getByLabelText('Archive directory tag'), 'acme/dir');
    await userEvent.type(screen.getByLabelText('Logo 1'), 'LOGO1');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ archiveCustomerTag: 'ACME', archiveProviderTag: 'IRON', archiveDirectoryTag: 'acme/dir', logo1: 'LOGO1', logo2: null }));
  });
  it('uses the rollover day in the note and saves a changed day', async () => {
    wrap('/customers/7');
    const day = await screen.findByLabelText('Job number rollover day');
    await userEvent.clear(day); await userEvent.type(day, '21');
    expect(screen.getByText(/Becomes the job number on the 21st of the month/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ jobNumberRolloverDay: 21 }));
  });
  it('sends null to clear the pending number', async () => {
    wrap('/customers/7');
    await userEvent.clear(await screen.findByLabelText('Pending job number'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ pendingJobNumber: null }));
  });
});

describe('Customers table columns', () => {
  const width = (i: number) => Number((document.querySelectorAll('colgroup col')[i] as HTMLElement).style.width.replace('px', ''));
  beforeEach(() => localStorage.clear());
  it('keeps each cell on one line', async () => {
    wrap('/customers');
    await screen.findByText('Acme Energy Ltd');
    expect(screen.getByText('Acme Energy Ltd').closest('td')).toHaveStyle({ whiteSpace: 'nowrap' });
  });
  it('resizes a column by dragging its edge, and remembers it', async () => {
    wrap('/customers');
    await screen.findByText('Acme Energy Ltd');
    const before = width(0);
    fireEvent.mouseDown(screen.getByRole('separator', { name: 'Resize Name column' }), { clientX: 100 });
    fireEvent.mouseMove(window, { clientX: 260 });
    fireEvent.mouseUp(window);
    expect(width(0)).toBe(before + 160);
    expect(localStorage.getItem('intellidoc.customers.columns')).toContain(String(before + 160));
  });
  it('stops a column being dragged to nothing', async () => {
    wrap('/customers');
    await screen.findByText('Acme Energy Ltd');
    fireEvent.mouseDown(screen.getByRole('separator', { name: 'Resize Name column' }), { clientX: 500 });
    fireEvent.mouseMove(window, { clientX: -2000 });
    fireEvent.mouseUp(window);
    expect(width(0)).toBe(40);
  });
  it('double-click fits the column back to its content', async () => {
    wrap('/customers');
    await screen.findByText('Acme Energy Ltd');
    const before = width(0);
    const handle = screen.getByRole('separator', { name: 'Resize Name column' });
    fireEvent.mouseDown(handle, { clientX: 100 }); fireEvent.mouseMove(window, { clientX: 300 }); fireEvent.mouseUp(window);
    expect(width(0)).not.toBe(before);
    fireEvent.doubleClick(handle);
    expect(width(0)).toBe(before);
  });
});

describe('Invoicing account', () => {
  it('offers the customer and its parents, and sends null for the default', async () => {
    respond = ((prev) => (url, method, body) => (url === '/api/customers/7' && method === 'GET' ? { status: 200, json: { ...detail(), parent: { id: 5, code: 'ODEVO', name: 'Odevo' }, invoicingOptions: [{ id: 7, code: 'ACME', name: 'Acme Energy Ltd' }, { id: 5, code: 'ODEVO', name: 'Odevo' }] } } : prev(url, method, body)))(respond);
    wrap('/customers/7');
    const select = await screen.findByRole('combobox', { name: 'Invoicing account' });
    expect(select).toHaveValue('Acme Energy Ltd (this customer)');
    await userEvent.type(screen.getByLabelText('Name'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ invoicingAccountId: null }));
  });
  it('sends the chosen parent as the invoicing account', async () => {
    respond = ((prev) => (url, method, body) => (url === '/api/customers/7' && method === 'GET' ? { status: 200, json: { ...detail(), parent: { id: 5, code: 'ODEVO', name: 'Odevo' }, invoicingOptions: [{ id: 7, code: 'ACME', name: 'Acme Energy Ltd' }, { id: 5, code: 'ODEVO', name: 'Odevo' }] } } : prev(url, method, body)))(respond);
    wrap('/customers/7');
    const combo = await screen.findByRole('combobox', { name: 'Invoicing account' });
    await userEvent.click(combo);
    await userEvent.click(within(document.getElementById(combo.getAttribute('aria-controls')!)!).getByRole('option', { name: 'Odevo (ODEVO)', hidden: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ invoicingAccountId: 5 }));
  });
});

describe('Inserts tab', () => {
  const insert = (id: number, over: Record<string, unknown> = {}) => ({ id, stockCode: `WH${id}`, brandId: null, brandName: null, reference: null, description: `Leaflet ${id}`, hpodGuid: null, insertSizeId: 1, sizeName: 'A4', widthMm: 210, heightMm: 297, thicknessMm: 0.1, weightG: 5, isChargeable: true, costPrice: 0.04, sellPrice: 0.1, margin: 0.06, linkedIds: [], parent: null, ...over });
  const withInserts = (inserts: unknown[], over: Record<string, unknown> = {}) => {
    respond = ((prev) => (url, method, body) => (url === '/api/customers/7' && method === 'GET' ? { status: 200, json: { ...detail(), inserts, ...over } } : prev(url, method, body)))(respond);
  };
  const open = async () => { wrap('/customers/7'); await userEvent.click(await screen.findByRole('tab', { name: /Inserts/ })); };

  it('lists inserts with cost, sell price and the margin, and counts them in the tab', async () => {
    withInserts([insert(1), insert(2, { costPrice: null, margin: null, isChargeable: false })]);
    await open();
    const rows = (await screen.findAllByRole('row')).map((r) => r.textContent ?? '');
    expect(rows.some((t) => t.includes('WH1') && t.includes('Leaflet 1') && t.includes('A4') && t.includes('210 × 297 × 0.1') && t.includes('£0.04') && t.includes('£0.10') && t.includes('£0.06') && t.includes('Yes'))).toBe(true);
    expect(rows.some((t) => t.includes('WH2') && t.includes('£–') === false && t.includes('No'))).toBe(true);
    expect(screen.getByRole('tab', { name: 'Inserts (2)' })).toBeInTheDocument();
  });
  it('filters by brand', async () => {
    withInserts([insert(1, { brandId: 21, brandName: 'Home' }), insert(2, { brandId: 22, brandName: 'Business' }), insert(3)]);
    await open();
    const text = () => screen.getAllByRole('row').map((r) => r.textContent ?? '').join('|');
    expect(text()).toContain('WH1'); expect(text()).toContain('WH3');
    const box = await screen.findByRole('combobox', { name: 'Show brand' });
    await userEvent.click(box);
    await userEvent.click(within(document.getElementById(box.getAttribute('aria-controls')!)!).getByRole('option', { name: 'Business', hidden: true }));
    expect(text()).toContain('WH2'); expect(text()).not.toContain('WH1'); expect(text()).not.toContain('WH3');
    expect(screen.getByText('Showing 1 of 3')).toBeInTheDocument();
  });
  it('adds an insert with the chosen values, and shows the margin as the prices are typed', async () => {
    await open();
    await userEvent.click(await screen.findByRole('button', { name: 'Add insert' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Stock code/), 'WH9001');
    await userEvent.type(within(dialog).getByLabelText(/Description/), 'Spring leaflet');
    const size = within(dialog).getByLabelText('Display size');
    await userEvent.click(size);
    await userEvent.click(within(document.getElementById(size.getAttribute('aria-controls')!)!).getByRole('option', { name: 'DL', hidden: true }));
    await userEvent.type(within(dialog).getByLabelText(/Weight \(g\)/), '4.5');
    await userEvent.click(within(dialog).getByRole('switch', { name: /Chargeable/ }));
    await userEvent.type(within(dialog).getByLabelText(/Cost/), '0.04');
    await userEvent.type(within(dialog).getByLabelText(/Sell price/), '0.1');
    expect((within(dialog).getByLabelText(/Margin/) as HTMLInputElement).value).toBe('£0.06');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find((c) => c.url === '/api/customers/7/inserts')?.body).toEqual({
      stockCode: 'WH9001', description: 'Spring leaflet', brandId: null, reference: null, hpodGuid: null, insertSizeId: 2, widthMm: null, heightMm: null, thicknessMm: 0, weightG: 4.5,
      isChargeable: true, costPrice: 0.04, sellPrice: 0.1, linkedIds: [],
    }));
  });
  it('only offers inserts that can be linked, and shows the field error the API gives', async () => {
    withInserts([insert(1), insert(2, { parent: { id: 9, stockCode: 'OTHER', description: 'x' } }), insert(3, { linkedIds: [4] }), insert(4, { parent: { id: 3, stockCode: 'WH3', description: 'x' } }), insert(5)]);
    respond = ((prev) => (url, method, body) => (url === '/api/inserts/1' && method === 'PUT' ? { status: 422, json: { errors: { stockCode: 'Stock code WH1 is already in use' } } } : prev(url, method, body)))(respond);
    await open();
    await userEvent.click((await screen.findAllByRole('button', { name: 'Edit' }))[0]!);
    const dialog = await screen.findByRole('dialog');
    const linked = within(dialog).getByLabelText('Linked inserts');
    await userEvent.click(linked);
    const options = within(document.getElementById(linked.getAttribute('aria-controls')!)!).getAllByRole('option', { hidden: true }).map((o) => o.textContent);
    expect(options).toEqual(['WH5 – Leaflet 5']); // not 2 (linked under another), 3 (has links), 4 (is linked) or itself
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Stock code WH1 is already in use')).toBeInTheDocument();
  });
  it('removes an insert after asking', async () => {
    withInserts([insert(1)]);
    await open();
    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/inserts/1')).toBe(true));
  });
  it("shows the parent's inserts read only", async () => {
    withInserts([], { parent: { id: 5, code: 'ODEVO', name: 'Odevo' }, modes: { ...detail().modes, inserts: 'EXTEND' }, inheritedInserts: [{ ...insert(50, { stockCode: 'PAR1', description: 'Parent leaflet' }), from: { id: 5, code: 'ODEVO', name: 'Odevo' } }] });
    await open();
    expect(await screen.findByText('From the parent')).toBeInTheDocument();
    expect(screen.getAllByRole('row').some((r) => (r.textContent ?? '').includes('PAR1') && (r.textContent ?? '').includes('Odevo'))).toBe(true);
  });
});

describe('Envelope brand filter', () => {
  const env = (id: number, brandId: number | null, brandName: string | null, stockCode: string) => ({ ...detail().envelopes[0]!, id, brandId, brandName, stockCode });
  it('shows only the chosen brand, or only the settings with no brand, and says how many', async () => {
    respond = ((prev) => (url, method, body) => (url === '/api/customers/7' && method === 'GET' ? { status: 200, json: { ...detail(), envelopes: [env(1, 21, 'Home', 'HOME1'), env(2, 22, 'Business', 'BUS1'), env(3, 22, 'Business', 'BUS2'), env(4, null, null, 'ANY1')] } } : prev(url, method, body)))(respond);
    wrap('/customers/7');
    await userEvent.click(await screen.findByRole('tab', { name: /Envelopes/ }));
    const text = () => screen.getAllByRole('row').map((r) => r.textContent ?? '').join('|');
    expect(text()).toContain('HOME1'); expect(text()).toContain('BUS2'); expect(text()).toContain('ANY1');
    const pick = async (name: string) => {
      const box = screen.getByRole('combobox', { name: 'Show brand' });
      await userEvent.click(box);
      await userEvent.click(within(document.getElementById(box.getAttribute('aria-controls')!)!).getByRole('option', { name, hidden: true }));
    };
    await pick('Business');
    expect(text()).toContain('BUS1'); expect(text()).toContain('BUS2'); expect(text()).not.toContain('HOME1'); expect(text()).not.toContain('ANY1');
    expect(screen.getByText('Showing 2 of 4')).toBeInTheDocument();
    await pick('No brand (any brand)');
    expect(text()).toContain('ANY1'); expect(text()).not.toContain('BUS1');
    await pick('All brands');
    expect(text()).toContain('HOME1'); expect(screen.queryByText(/Showing \d+ of/)).toBeNull();
  });
});

describe('Envelope inheritance', () => {
  const inherited = { id: 90, brandId: null, brandName: null, deliveryBand: '2nd Class', postalRateId: 1, rateLabel: 'Royal Mail – 2nd Class (Letter), up to 100g', stockItemId: 10, stockCode: 'WH0101', stockDescription: 'C5 white window', reference: null, externalName: null, isOversticker: false, from: { id: 5, code: 'ODEVO', name: 'Odevo' } };
  const withParent = (over: Record<string, unknown> = {}) => {
    respond = ((prev) => (url, method, body) => (url === '/api/customers/7' && method === 'GET' ? { status: 200, json: { ...detail(), parent: { id: 5, code: 'ODEVO', name: 'Odevo' }, ...over } } : prev(url, method, body)))(respond);
  };
  it('cannot be changed without a parent, and says why', async () => {
    wrap('/customers/7');
    await userEvent.click(await screen.findByRole('tab', { name: /Envelopes/ }));
    expect(await screen.findByRole('combobox', { name: 'Where the envelope list comes from' })).toBeDisabled();
    expect(screen.getByText(/Choose a parent customer on the Details tab/)).toBeInTheDocument();
  });
  it('shows the parent list read only with where each setting comes from', async () => {
    withParent({ modes: { ...detail().modes, envelopes: 'EXTEND' }, inheritedEnvelopes: [inherited] });
    wrap('/customers/7');
    await userEvent.click(await screen.findByRole('tab', { name: /Envelopes/ }));
    expect(await screen.findByText('From the parent')).toBeInTheDocument();
    const rows = screen.getAllByRole('row').map((r) => r.textContent ?? '');
    expect(rows.some((t) => t.includes('Odevo') && t.includes('WH0101'))).toBe(true);
  });
  it('sends the chosen list source', async () => {
    withParent();
    wrap('/customers/7');
    await userEvent.click(await screen.findByRole('tab', { name: /Envelopes/ }));
    const combo = await screen.findByRole('combobox', { name: 'Where the envelope list comes from' });
    await userEvent.click(combo);
    await userEvent.click(within(document.getElementById(combo.getAttribute('aria-controls')!)!).getByRole('option', { name: "The parent's list plus this customer's own", hidden: true }));
    await waitFor(() => expect(calls.find((c) => c.url === '/api/customers/7/inheritance')?.body).toEqual({ setting: 'envelopes', mode: 'EXTEND' }));
  });
  it('does not allow adding an envelope while the parent list is used instead', async () => {
    withParent({ modes: { ...detail().modes, envelopes: 'INHERIT' }, inheritedEnvelopes: [inherited] });
    wrap('/customers/7');
    await userEvent.click(await screen.findByRole('tab', { name: /Envelopes/ }));
    expect(await screen.findByRole('button', { name: /Add envelope/ })).toBeDisabled();
  });
});

describe('Hierarchy', () => {
  it('lists a child customer directly under its parent', async () => {
    const child = { ...row, id: 9, code: 'ACME-HL', name: 'Highline Solicitors', parentId: 7, parentCode: 'ACME' };
    const other = { ...row, id: 3, code: 'ZED', name: 'Zed Ltd' };
    respond = ((prev) => (url, method, body) => (url.startsWith('/api/customers?') ? { status: 200, json: { rows: [row, other, child].sort((a, b) => (a.name < b.name ? -1 : 1)) } } : prev(url, method, body)))(respond);
    wrap('/customers');
    await screen.findByText('Highline Solicitors');
    const names = screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0]!.textContent);
    expect(names).toEqual(['Acme Energy Ltd', '└ Highline Solicitors', 'Zed Ltd']);
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
    const mis = screen.getByLabelText('Job number');
    await userEvent.clear(mis); await userEvent.type(mis, '999');
    await userEvent.click(save);
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toMatchObject({ code: 'ACME', name: 'Acme Energy Ltd', misJobNumber: '999', pendingJobNumber: '24601', batchingKey: 'Department', parentId: null, flags: { isAddressMatching: true } }));
  });

  it('shows the envelope settings and adds one with the chosen values', async () => {
    wrap('/customers/7');
    await userEvent.click(await screen.findByRole('tab', { name: /Envelopes/ }));
    expect(await screen.findByText(/WH0101 – C5 white window/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add envelope' }));
    const dialog = await screen.findByRole('dialog');
    const brand = within(dialog).getByLabelText(/^Brand/);
    await userEvent.click(brand);
    await userEvent.click(within(document.getElementById(brand.getAttribute('aria-controls')!)!).getByRole('option', { name: 'Business', hidden: true }));
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

describe('Sub-account', () => {
  const odevo = { id: 5, code: 'ODEVO', name: 'Odevo' };
  const withParent = (over: Record<string, unknown> = {}) => {
    respond = ((prev) => (url, method, body) => {
      if (url === '/api/customers/7' && method === 'GET') return { status: 200, json: { ...detail(), parent: odevo, children: [], ...over } };
      if (url === '/api/customers/5' && method === 'GET') return { status: 200, json: { ...detail(), id: 5, code: 'ODEVO', name: 'Odevo', accounts: [{ id: 7, code: 'ACME', name: 'Acme Energy Ltd', isDeleted: false }] } };
      return prev(url, method, body);
    })(respond);
  };
  const open = async () => {
    wrap('/customers/7');
    await userEvent.click(await screen.findByRole('button', { name: /Make this a sub-account of Odevo/ }));
    return screen.findByRole('dialog');
  };

  it('is not offered to a customer without a parent', async () => {
    wrap('/customers/7');
    await screen.findByLabelText('Account code');
    expect(screen.queryByRole('button', { name: /Make this a sub-account/ })).not.toBeInTheDocument();
  });

  it('lists what stops being used, then makes it a sub-account and opens the parent', async () => {
    withParent();
    const dialog = await open();
    expect(within(dialog).getByText('2 brands (Home, Business)')).toBeInTheDocument();
    expect(within(dialog).getByText('1 envelope setting')).toBeInTheDocument();
    expect(within(dialog).getByText(/its job number \(24518\)/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Its 1 sub-account becomes a sub-account of Odevo too/)).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('make-sub-account'))).toBe(false); // nothing happens until it is confirmed
    await userEvent.click(within(dialog).getByRole('button', { name: 'Make sub-account' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/customers/7/make-sub-account' && c.method === 'POST')).toBe(true));
    expect(await screen.findByRole('heading', { name: 'Odevo' })).toBeInTheDocument();
  });

  it('will not go ahead while customers are placed under it', async () => {
    withParent({ children: [{ id: 9, code: 'ACME-HL', name: 'Highline Solicitors', isDeleted: false }] });
    const dialog = await open();
    expect(within(dialog).getByText(/Highline Solicitors/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Make sub-account' })).toBeDisabled();
  });

  it('keeps the box open and shows the server’s reason when it is refused', async () => {
    withParent();
    respond = ((prev) => (url, method, body) => (url === '/api/customers/7/make-sub-account' ? { status: 422, json: { errors: { parentId: '1 customer is placed under this one (Kid One).' } } } : prev(url, method, body)))(respond);
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Make sub-account' }));
    expect(await within(dialog).findByText(/1 customer is placed under this one/)).toBeInTheDocument();
  });

  it('an account can be given its own settings again from the parent’s Accounts tab', async () => {
    respond = ((prev) => (url, method, body) => (url === '/api/customers/8' && method === 'GET' ? { status: 200, json: { ...detail(), id: 8, code: 'ACME-SC', name: 'Acme Scotland', parent: { id: 7, code: 'ACME', name: 'Acme Energy Ltd' } } } : prev(url, method, body)))(respond);
    wrap('/customers/7');
    await userEvent.click(await screen.findByRole('tab', { name: /Accounts/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Give it its own settings' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/accounts/8/make-customer' && c.method === 'POST')).toBe(true));
    expect(await screen.findByRole('heading', { name: 'Acme Scotland' })).toBeInTheDocument();
  });
});

describe('Inheritance of brands, matching, pack order and e-mails', () => {
  const odevo = { id: 5, code: 'ODEVO', name: 'Odevo' };
  const modes = (over: Record<string, string> = {}) => ({ envelopes: 'OWN', brands: 'OWN', matching: 'OWN', sequence: 'OWN', emails: 'OWN', inserts: 'OWN', ...over });
  const withParent = (over: Record<string, unknown> = {}) => {
    respond = ((prev) => (url, method, body) => (url === '/api/customers/7' && method === 'GET' ? { status: 200, json: { ...detail(), parent: odevo, ...over } } : prev(url, method, body)))(respond);
  };
  const choose = async (name: string, option: string) => {
    const combo = await screen.findByRole('combobox', { name });
    await userEvent.click(combo);
    await userEvent.click(within(document.getElementById(combo.getAttribute('aria-controls')!)!).getByRole('option', { name: option, hidden: true }));
  };

  it('each group cannot be changed without a parent, and says why', async () => {
    wrap('/customers/7');
    for (const [tab, label] of [['Brands', 'Where the brand list comes from'], ['Matching', 'Where the matching settings come from'], ['Notifications', 'Where the notification addresses come from']] as const) {
      await userEvent.click(await screen.findByRole('tab', { name: new RegExp(tab) }));
      expect(await screen.findByRole('combobox', { name: label })).toBeDisabled();
    }
  });

  it('brands: sends the choice, shows the parent’s brands read only, and does not allow adding while the parent’s list is used', async () => {
    withParent({ modes: modes({ brands: 'INHERIT' }), inherited: { ...detail().inherited, brands: [{ name: 'Parent brand', from: odevo }] } });
    wrap('/customers/7');
    await userEvent.click(await screen.findByRole('tab', { name: /Brands/ }));
    expect(await screen.findByText('Parent brand')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add brand/ })).toBeDisabled();
    expect(screen.getByText(/own brands are kept but not used/)).toBeInTheDocument();
    await choose('Where the brand list comes from', "The parent's list plus this customer's own");
    await waitFor(() => expect(calls.find((c) => c.url === '/api/customers/7/inheritance')?.body).toEqual({ setting: 'brands', mode: 'EXTEND' }));
  });

  it('matching: takes the parent’s values and rules, which are shown and cannot be edited', async () => {
    withParent({ modes: modes({ matching: 'INHERIT' }), inherited: { ...detail().inherited, matching: { isAddressMatching: false, batchingKey: 'Parent key', from: odevo }, matchRules: [{ isInclude: false, key: 'Doc Type', value: 'Final Demand', from: odevo }] } });
    wrap('/customers/7');
    await userEvent.click(await screen.findByRole('tab', { name: /Matching/ }));
    expect(await screen.findByText(/Exclude Doc Type = "Final Demand"/)).toBeInTheDocument();
    const key = screen.getByRole('combobox', { name: 'Batching key' });
    expect(key).toHaveValue('Parent key');
    expect(key).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Match addresses for this customer' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Match addresses for this customer' })).not.toBeChecked(); // the parent's value, not this customer's own (on)
    expect(screen.queryByRole('button', { name: 'Add rule' })).not.toBeInTheDocument();
  });

  it('pack order: sends its own choice, separate from matching', async () => {
    withParent();
    wrap('/customers/7');
    await userEvent.click(await screen.findByRole('tab', { name: /Matching/ }));
    await choose('Where the pack order comes from', "The parent's settings");
    await waitFor(() => expect(calls.find((c) => c.url === '/api/customers/7/inheritance')?.body).toEqual({ setting: 'sequence', mode: 'INHERIT' }));
  });

  it('notification e-mails: shows the parent’s addresses and locks the box while the parent’s list is used', async () => {
    withParent({ modes: modes({ emails: 'INHERIT' }), inherited: { ...detail().inherited, emails: [{ email: 'ops@odevo.example', from: odevo }] } });
    wrap('/customers/7');
    await userEvent.click(await screen.findByRole('tab', { name: /Notifications/ }));
    expect(await screen.findByText('ops@odevo.example')).toBeInTheDocument();
    expect(screen.getByLabelText('Notification e-mail addresses')).toBeDisabled();
  });
});
