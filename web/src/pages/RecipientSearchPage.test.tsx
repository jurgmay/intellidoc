import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { theme } from '../theme';
import { RecipientSearchPage } from './RecipientSearchPage';
import { resetRecipientSearchSession } from './recipientSearchSession';

const scopes = [{ id: 1, label: 'Odevo', isCustomer: true }, { id: 2, label: 'Odevo > Highline Solicitors', isCustomer: false }];
const hit = {
  mailpieceId: 5, sequenceNumber: 1 as number | null, batchCode: 7001, batchStatus: 'Printed', job: 'job-9', releaseDate: '2026-11-18T09:30:00', addressLines: ['Mrs A Patel', '12 Mill Lane', 'Leeds'], postcode: 'LS1 4AB', isCancelled: false,
  accountCode: 'ODEVO_HIGHLINE', accountName: 'Highline Solicitors', accountPath: 'Odevo > Highline Solicitors', invoicingCode: 'ODEVO', invoicingName: 'Odevo', brand: 'Home', priceSell: 1.05 as number | null,
  packs: [
    { packId: 12, position: 1, sequence: 1, startPage: 3, pageCount: 2, releaseDate: '2026-11-18T09:30:00', references: { 'Tenant Reference': 'T-1001', 'Document Type': 'Bill' } },
    { packId: 11, position: 2, sequence: 2, startPage: 1, pageCount: 2, releaseDate: '2026-11-18T09:30:00', references: { 'Tenant Reference': 'T-1001', 'Document Type': 'Arrears' } },
    { packId: 13, position: 3, sequence: null, startPage: 5, pageCount: 1, releaseDate: '2026-11-18T09:30:00', references: { 'Document Type': 'Leaflet' } },
  ],
};
const price = {
  mailpieceId: 5, batchCode: 7001, priced: true, reason: null as string | null, pricedAt: '2026-11-18T09:31:00', model: { id: 2, name: '2026 prices' }, packs: 1, colourPages: 1, monoPages: 3, blankPages: 0,
  lines: [{ code: 'HPOD', label: 'H-POD processing', quantity: 1, unitCost: 0.04, unitSell: 0.09, cost: 0.04, sell: 0.09 }, { code: 'MONO_PAGE', label: 'Mono page', quantity: 3, unitCost: 0.012, unitSell: 0.032, cost: 0.036, sell: 0.096 }],
  productionCost: 0.076, productionSell: 0.186, postageCost: 0.61, postageSell: 0.64, totalCost: 0.686, totalSell: 0.826, warnings: null as string | null,
};
let urls: string[];
let respond: (url: string) => { status: number; json: unknown };

beforeEach(() => {
  resetRecipientSearchSession();
  urls = [];
  respond = (url) => url.startsWith('/api/recipients/scopes') ? { status: 200, json: { rows: scopes } } : url.startsWith('/api/mailpieces/') ? { status: 200, json: price } : { status: 200, json: { scope: { id: 1, label: 'Odevo' }, rows: [hit], truncated: false } };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => { urls.push(url); const r = respond(url); return new Response(JSON.stringify(r.json), { status: r.status }); }));
});
afterEach(() => vi.unstubAllGlobals());
const show = () => render(<MantineProvider theme={theme}><MemoryRouter><RecipientSearchPage /></MemoryRouter></MantineProvider>);

describe('RecipientSearchPage', () => {
  it('keeps the account, the terms and the results when you leave the page and come back, and Clear forgets them', async () => {
    const first = show();
    await waitFor(() => expect(urls).toContain('/api/recipients/scopes'));
    await userEvent.click(screen.getByRole('combobox', { name: /Search in/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Odevo', hidden: true }));
    await userEvent.type(screen.getByLabelText('Name'), 'patel');
    await userEvent.type(screen.getByLabelText('Reference'), 'T-10*');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Mrs A Patel');
    await userEvent.click(screen.getByRole('button', { name: 'Show the letters for Mrs A Patel' }));
    first.unmount();   // another page is shown
    const searches = urls.filter((u) => u.startsWith('/api/recipients/search')).length;
    show();            // and back again
    expect(screen.getByLabelText('Name')).toHaveValue('patel');
    expect(screen.getByLabelText('Reference')).toHaveValue('T-10*');
    await waitFor(() => expect(screen.getByRole('combobox', { name: /Search in/ })).toHaveValue('Odevo'));
    expect(screen.getByText('Mrs A Patel')).toBeInTheDocument();
    expect(screen.getAllByTestId('pack')).toHaveLength(3); // the letters that were open are still open
    expect(screen.getByText(/1 found in Odevo and below. Searched at \d\d:\d\d/)).toBeInTheDocument();
    expect(urls.filter((u) => u.startsWith('/api/recipients/search'))).toHaveLength(searches); // shown as it was: no new search
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByText('Mrs A Patel')).not.toBeInTheDocument();
    cleanup(); show();
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(screen.queryByText('Mrs A Patel')).not.toBeInTheDocument();
  });

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
    const tr = row.closest<HTMLElement>('[data-testid="mailpiece"]')!;
    expect(within(tr).getByText('Odevo > Highline Solicitors')).toBeInTheDocument();
    expect(within(tr).getByText('7001')).toBeInTheDocument();
    expect(screen.getByText(/1 found in Odevo and below/)).toBeInTheDocument();
  });

  it('shows the address in one comma separated line under the name', async () => {
    await searchFor();
    const tr = screen.getByText('Mrs A Patel').closest<HTMLElement>('[data-testid="mailpiece"]')!;
    expect(within(tr).getByText('12 Mill Lane, Leeds, LS1 4AB')).toBeInTheDocument();
    expect(within(tr).queryByText('LS1 4AB')).not.toBeInTheDocument();
  });

  it('does not repeat a postcode that is already an address line, and flags a cancelled mailpiece', async () => {
    respond = (url) => url.startsWith('/api/recipients/scopes') ? { status: 200, json: { rows: scopes } } : { status: 200, json: { scope: { id: 1, label: 'Odevo' }, truncated: false, rows: [{ ...hit, addressLines: ['Mrs A Patel', '12 Mill Lane', 'LS1 4AB'], isCancelled: true }] } };
    await searchFor();
    const tr = screen.getByText('Mrs A Patel').closest<HTMLElement>('[data-testid="mailpiece"]')!;
    expect(within(tr).getByText('12 Mill Lane, LS1 4AB')).toBeInTheDocument();
    expect(within(tr).getByText('Cancelled')).toBeInTheDocument();
  });

  it('shows only the mailpiece headers at first, and the header shows or hides the letters when it is clicked', async () => {
    await searchFor();
    const header = screen.getByRole('button', { name: 'Show the letters for Mrs A Patel' });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('pack')).not.toBeInTheDocument();
    expect(screen.getByText('12 Mill Lane, Leeds, LS1 4AB')).toBeInTheDocument(); // the header still has the common details
    await userEvent.click(header);
    expect(screen.getByRole('button', { name: 'Hide the letters for Mrs A Patel' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByTestId('pack')).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: 'Hide the letters for Mrs A Patel' }));
    expect(screen.queryByTestId('pack')).not.toBeInTheDocument();
    // the keyboard works too
    screen.getByRole('button', { name: 'Show the letters for Mrs A Patel' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getAllByTestId('pack')).toHaveLength(3);
  });

  it('opens the price, and not the letters, when the price is clicked', async () => {
    await searchFor();
    await userEvent.click(screen.getByRole('button', { name: /price of the mailpiece to Mrs A Patel/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByTestId('pack')).not.toBeInTheDocument();
  });

  it('shows the shared details in the mailpiece header, and the letters in their own box beneath it', async () => {
    await searchFor();
    const mp = screen.getByTestId('mailpiece');
    await toggleHeader('Mrs A Patel');
    const box = within(mp).getByRole('table', { name: 'Letters in the envelope' });
    const field = (label: string) => within(mp).getAllByText(label)[0]!.nextSibling; // the first one is in the header (the letters table has a Released column too)
    expect(field('Letters')).toHaveTextContent('3');
    expect(field('Released')).toHaveTextContent('18/11/2026');
    expect(field('Job')).toHaveTextContent('job-9');
    expect(field('Sent from')).toHaveTextContent('Odevo > Highline Solicitors');
    expect(field('Invoiced to')).toHaveTextContent('Odevo');
    expect(within(box).getAllByText('18/11/2026')).toHaveLength(3); // each letter's own release date
    expect(within(box).queryByText('job-9')).not.toBeInTheDocument(); // not repeated on every letter
    expect(within(box).queryByText('Odevo > Highline Solicitors')).not.toBeInTheDocument();
  });

  it('lists the letters in the envelope in order, each with its pages, sequence and fields', async () => {
    await searchFor();
    await toggleHeader('Mrs A Patel');
    const packs = screen.getAllByTestId('pack');
    expect(packs).toHaveLength(3);
    expect(packs.map((p) => within(p).getByLabelText(/Letter \d/).getAttribute('aria-label'))).toEqual(['Letter 1', 'Letter 2', 'Letter 3']);
    expect(within(packs[0]!).getAllByRole('cell')[1]).toHaveTextContent(/^1$/);
    expect(within(packs[1]!).getAllByRole('cell')[1]).toHaveTextContent(/^2$/);
    expect(packs[0]).toHaveTextContent('2 pages');
    expect(packs[0]).toHaveTextContent('from page 3');
    expect(packs[0]).toHaveTextContent('Tenant Reference: T-1001');
    expect(packs[0]).toHaveTextContent('Document Type: Bill');
    expect(packs[1]).toHaveTextContent('Document Type: Arrears');
    expect(packs[2]).toHaveTextContent('Not in the sequence');
    expect(packs[2]).toHaveTextContent('1 page');
    expect(packs[2]).toHaveTextContent('Document Type: Leaflet');
  });

  it('shows one box of letters for each mailpiece', async () => {
    respond = (url) => url.startsWith('/api/recipients/scopes') ? { status: 200, json: { rows: scopes } } : { status: 200, json: { scope: { id: 1, label: 'Odevo' }, truncated: false, rows: [hit, { ...hit, mailpieceId: 6, addressLines: ['Mr B Jones', '1 Road'], packs: [{ ...hit.packs[0]!, packId: 21, references: {} }] }] } };
    await searchFor();
    await toggleHeader('Mrs A Patel'); await toggleHeader('Mr B Jones');
    const mps = screen.getAllByTestId('mailpiece');
    expect(mps).toHaveLength(2);
    expect(within(mps[0]!).getAllByTestId('pack')).toHaveLength(3);
    expect(within(mps[1]!).getAllByTestId('pack')).toHaveLength(1);
    expect(within(mps[1]!).getByText('None')).toBeInTheDocument(); // a letter with no fields
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

  const searchFor = async () => {
    show();
    await waitFor(() => expect(urls).toContain('/api/recipients/scopes'));
    await userEvent.click(screen.getByRole('combobox', { name: /Search in/ }));
    await userEvent.click(await screen.findByRole('option', { name: 'Odevo', hidden: true }));
    await userEvent.type(screen.getByLabelText('Name'), 'patel');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));
    await screen.findByText('Mrs A Patel');
  };

  const toggleHeader = (who: string) => userEvent.click(screen.getByRole('button', { name: new RegExp(`(Show|Hide) the letters for ${who}`) }));

  it('shows what the customer pays on each hit and opens the breakdown', async () => {
    await searchFor();
    await userEvent.click(screen.getByRole('button', { name: /price of the mailpiece to Mrs A Patel/i }));
    const dialog = await screen.findByRole('dialog');
    expect(urls).toContain('/api/mailpieces/5/price');
    expect(await within(dialog).findByText('H-POD processing')).toBeInTheDocument();
    expect(within(dialog).getByText('Mono page')).toBeInTheDocument();
    expect(within(dialog).getByText('£0.83')).toBeInTheDocument(); // what the customer pays
    expect(within(dialog).getByText('£0.69')).toBeInTheDocument(); // what it costs
    expect(within(dialog).getByText('2026 prices')).toBeInTheDocument();
    expect(within(dialog).getByText(/Priced 18\/11\/2026 09:31\./)).toBeInTheDocument();
    expect(within(dialog).getByText(/1 colour, 3 mono and 0 blank pages/)).toBeInTheDocument();
  });

  it('says so when the price is incomplete', async () => {
    price.warnings = 'No price for the outer envelope in this costing model.';
    await searchFor();
    await userEvent.click(screen.getByRole('button', { name: /price of the mailpiece/i }));
    expect(await screen.findByText(/price is incomplete/i)).toBeInTheDocument();
    expect(screen.getByText(/No price for the outer envelope/)).toBeInTheDocument();
    price.warnings = null;
  });

  it('says why a mailpiece has no price', async () => {
    hit.priceSell = null; price.priced = false; price.reason = 'No costing model was in force for this customer on 2026-11-18.';
    await searchFor();
    const btn = screen.getByRole('button', { name: /price of the mailpiece/i });
    expect(btn).toHaveTextContent('Not priced');
    await userEvent.click(btn);
    expect(await screen.findByText(/No costing model was in force/)).toBeInTheDocument();
    hit.priceSell = 1.05; price.priced = true; price.reason = null;
  });
});
