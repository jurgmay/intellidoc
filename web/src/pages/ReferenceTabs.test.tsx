import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { theme } from '../theme';
import { AnonymousAddressees, InsertSizesTab, PaperTab, PostalFormatsTab } from './ReferenceTabs';

let calls: { url: string; method: string; body?: any }[]; // eslint-disable-line @typescript-eslint/no-explicit-any
let failNext: Response | null;
let papers: object[]; let formats: object[]; let names: string[]; let sizes: object[];

const wrap = (ui: React.ReactElement) => render(<MantineProvider theme={theme}><Notifications />{ui}</MantineProvider>);
beforeEach(() => {
  calls = []; failNext = null;
  papers = [{ id: 1, name: 'A4 White', batchName: 'A4 WHITE', paperCode: null, usedBy: 3 }, { id: 2, name: 'A4 Plain', batchName: 'A4 PLAIN', paperCode: 'P1', usedBy: 0 }];
  formats = [{ id: 1, name: 'Letter', rank: 1, maxWeightG: 100, maxThicknessMm: 5, maxSheets: 16, maxLengthMm: 240, maxWidthMm: 165, usedBy: 2 }, { id: 2, name: 'Large Letter', rank: 2, maxWeightG: 750, maxThicknessMm: null, maxSheets: null, maxLengthMm: 353, maxWidthMm: 250, usedBy: 1 }];
  names = ['THEOCCUPIER', 'THERESIDENT'];
  sizes = [{ id: 1, name: 'A4', widthMm: 210, heightMm: 297, usedBy: 2 }, { id: 2, name: 'DL', widthMm: null, heightMm: null, usedBy: 0 }];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : undefined });
    if (failNext && init?.method) { const r = failNext; failNext = null; return r; }
    if (url === '/api/reference/history') return new Response(JSON.stringify({ rows: [{ id: 1, changedAt: '2026-11-20T10:00:00Z', changedBy: 'sam', summary: 'Anonymous addressee THETENANT added' }] }), { status: 200 });
    if (url === '/api/reference/insert-sizes' && (init?.method ?? 'GET') === 'GET') return new Response(JSON.stringify({ sizes }), { status: 200 });
    if (url === '/api/reference/papers') return new Response(JSON.stringify({ papers }), { status: 200 });
    if (url === '/api/reference/postal-formats') return new Response(JSON.stringify({ formats }), { status: 200 });
    if (url === '/api/reference/anonymous' && (init?.method ?? 'GET') === 'GET') return new Response(JSON.stringify({ names }), { status: 200 });
    return new Response(init?.method === 'POST' ? JSON.stringify({ text: 'X' }) : null, { status: init?.method === 'POST' ? 201 : 204 });
  }));
});
afterEach(() => vi.unstubAllGlobals());
const sent = (method: string) => calls.filter((c) => c.method === method);

describe('PaperTab', () => {
  it('lists papers, and only an unused one can be deleted', async () => {
    wrap(<PaperTab />);
    const row = (await screen.findByText('A4 White')).closest('tr')!;
    expect(within(row).getByText('3 print options')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Delete' })).toBeDisabled();
    expect(within(screen.getByText('A4 Plain').closest('tr')!).getByRole('button', { name: 'Delete' })).toBeEnabled();
    expect(screen.getByText(/Anonymous addressee THETENANT added/)).toBeInTheDocument(); // the shared recent changes list
  });
  it('saves a new batch name and an empty code as null', async () => {
    wrap(<PaperTab />);
    await userEvent.click(within((await screen.findByText('A4 Plain')).closest('tr')!).getByRole('button', { name: 'Edit' }));
    const batch = screen.getByLabelText('Batch name'); await userEvent.clear(batch); await userEvent.type(batch, 'A4 WHITE');
    await userEvent.clear(screen.getByLabelText('Paper code'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sent('PUT')).toHaveLength(1));
    expect(sent('PUT')[0]).toMatchObject({ url: '/api/reference/papers/2', body: { batchName: 'A4 WHITE', paperCode: null } });
  });
  it('shows a field error from the server', async () => {
    wrap(<PaperTab />);
    await userEvent.click(within((await screen.findByText('A4 Plain')).closest('tr')!).getByRole('button', { name: 'Edit' }));
    failNext = new Response(JSON.stringify({ errors: { batchName: 'Batch name is required' } }), { status: 422 });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findAllByText('Batch name is required')).length).toBeGreaterThan(0); // under the field, and in the notification
  });
  it('deletes after a confirmation', async () => {
    wrap(<PaperTab />);
    await userEvent.click(within((await screen.findByText('A4 Plain')).closest('tr')!).getByRole('button', { name: 'Delete' }));
    expect(screen.getByText(/Delete the paper A4 Plain\?/)).toBeInTheDocument();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(sent('DELETE')).toHaveLength(1));
    expect(sent('DELETE')[0]!.url).toBe('/api/reference/papers/2');
  });
});

describe('PostalFormatsTab', () => {
  it('shows the limits, with "no limit" where there is none', async () => {
    wrap(<PostalFormatsTab />);
    const large = (await screen.findByText('Large Letter')).closest('tr')!;
    expect(within(large).getAllByText('no limit')).toHaveLength(2);
    const letter = screen.getByText('Letter').closest('tr')!;
    expect(within(letter).getByText('100 g')).toBeInTheDocument();
    expect(within(letter).getByText('240 mm')).toBeInTheDocument();
    expect(within(letter).getByText('165 mm')).toBeInTheDocument();
  });
  it('heads the limit columns "Maximum …"', async () => {
    wrap(<PostalFormatsTab />);
    await screen.findByText('Large Letter');
    for (const h of ['Maximum weight', 'Maximum thickness', 'Maximum sheets', 'Maximum length', 'Maximum width']) expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /^Most / })).toBeNull();
  });
  it('saves changed limits, and an emptied one becomes null', async () => {
    wrap(<PostalFormatsTab />);
    await userEvent.click(within((await screen.findByText('Letter')).closest('tr')!).getByRole('button', { name: 'Edit' }));
    const w = screen.getByLabelText('Maximum weight (g)'); await userEvent.clear(w); await userEvent.type(w, '120');
    await userEvent.clear(screen.getByLabelText('Maximum sheets'));
    const mw = screen.getByLabelText('Maximum length (mm)'); await userEvent.clear(mw); await userEvent.type(mw, '245.5');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sent('PUT')).toHaveLength(1));
    expect(sent('PUT')[0]).toMatchObject({ url: '/api/reference/postal-formats/1', body: { maxWeightG: 120, maxThicknessMm: 5, maxSheets: null, maxLengthMm: 245.5, maxWidthMm: 165 } });
  });
  it('will not save a format with no length', async () => {
    wrap(<PostalFormatsTab />);
    await userEvent.click(within((await screen.findByText('Letter')).closest('tr')!).getByRole('button', { name: 'Edit' }));
    await userEvent.clear(screen.getByLabelText('Maximum length (mm)'));
    failNext = new Response(JSON.stringify({ errors: { maxLengthMm: 'Maximum length must be a number above 0' } }), { status: 422 });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findAllByText('Maximum length must be a number above 0')).length).toBeGreaterThan(0);
    expect(sent('PUT')[0]!.body.maxLengthMm).toBeNull(); // an empty box is sent as null (NaN in JSON), for the server to refuse
  });
  it('shows the ordering error from the server', async () => {
    wrap(<PostalFormatsTab />);
    await userEvent.click(within((await screen.findByText('Letter')).closest('tr')!).getByRole('button', { name: 'Edit' }));
    failNext = new Response(JSON.stringify({ errors: { maxWeightG: 'Maximum weight cannot be more than Large Letter (750)' } }), { status: 422 });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findAllByText(/cannot be more than Large Letter/)).length).toBeGreaterThan(0);
  });
});

describe('AnonymousAddressees', () => {
  it('lists the stored names and adds one by what was typed', async () => {
    wrap(<AnonymousAddressees />);
    expect(await screen.findByText('THEOCCUPIER')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('New anonymous addressee'), 'The Home-Owner');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(sent('POST')).toHaveLength(1));
    expect(sent('POST')[0]).toMatchObject({ url: '/api/reference/anonymous', body: { text: 'The Home-Owner' } });
    await waitFor(() => expect(screen.getByLabelText('New anonymous addressee')).toHaveValue(''));
  });
  it('shows why an addition was refused and keeps the text', async () => {
    wrap(<AnonymousAddressees />);
    await userEvent.type(await screen.findByLabelText('New anonymous addressee'), 'the occupier');
    failNext = new Response(JSON.stringify({ error: 'THEOCCUPIER is already on the list.' }), { status: 409 });
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect((await screen.findAllByText('THEOCCUPIER is already on the list.')).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('New anonymous addressee')).toHaveValue('the occupier');
  });
  it('removes a name after a confirmation, encoding it in the URL', async () => {
    wrap(<AnonymousAddressees />);
    await userEvent.click(within((await screen.findByText('THERESIDENT')).closest('tr')!).getByRole('button', { name: 'Remove' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(sent('DELETE')).toHaveLength(1));
    expect(sent('DELETE')[0]!.url).toBe('/api/reference/anonymous/THERESIDENT');
  });
});

describe('InsertSizesTab', () => {
  it('shows each size\'s width and height and edits them from the Edit button', async () => {
    wrap(<InsertSizesTab />);
    const a4 = (await screen.findByText('A4')).closest('tr')!;
    expect(within(a4).getByText('210')).toBeInTheDocument(); expect(within(a4).getByText('297')).toBeInTheDocument();
    await userEvent.click(within((await screen.findByText('DL')).closest('tr')!).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Width (mm)'), '99');
    await userEvent.type(within(dialog).getByLabelText('Height (mm)'), '210.5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sent('PUT')).toHaveLength(1));
    expect(sent('PUT')[0]).toMatchObject({ url: '/api/reference/insert-sizes/2', body: { widthMm: 99, heightMm: 210.5 } });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('can clear a size\'s width and height, and shows the server\'s reason when they are refused', async () => {
    wrap(<InsertSizesTab />);
    await userEvent.click(within((await screen.findByText('A4')).closest('tr')!).getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.clear(within(dialog).getByLabelText('Width (mm)'));
    await userEvent.clear(within(dialog).getByLabelText('Height (mm)'));
    failNext = new Response(JSON.stringify({ errors: { widthMm: 'Width must be a number above 0' } }), { status: 422 });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByText('Width must be a number above 0')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sent('PUT')).toHaveLength(2));
    expect(sent('PUT')[1]).toMatchObject({ body: { widthMm: null, heightMm: null } });
  });
});
