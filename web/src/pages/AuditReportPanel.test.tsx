import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { theme } from '../theme';
import { ReportsPage } from './ReportsPage';
import { describeSearch } from './AuditReportPanel';
import { EMPTY_FORM } from './recipientSearchSession';

const piece = (mailpieceId: number, name: string) => ({
  mailpieceId, sequenceNumber: null, batchCode: 7001, batchStatus: 'Printed', job: 'job-9', releaseDate: '2026-11-18T09:30:00', addressLines: [name, '12 Mill Lane', 'Leeds'], postcode: 'LS1 4AB', isCancelled: false,
  accountCode: 'ODEVO', accountName: 'Odevo', accountPath: 'Odevo', invoicingCode: 'ODEVO', invoicingName: 'Odevo', brand: null, priceSell: 1.25 as number | null,
  packs: [{ packId: mailpieceId * 10, packGuid: 'aaaaaaaa-0000-4000-8000-000000000001', jobGuid: 'bbbbbbbb-0000-4000-8000-000000000001', position: 1, sequence: 1, startPage: 1, pageCount: 2, releaseDate: '2026-11-18T09:30:00', references: { 'Tenant Reference': 'T-1' } }],
});
let calls: { url: string; init?: RequestInit }[];
let reportResponse: () => Response;

beforeEach(() => {
  calls = [];
  reportResponse = () => new Response(new Uint8Array([37, 80, 68, 70]), { status: 200 });
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:report', revokeObjectURL: () => undefined }));
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.startsWith('/api/recipients/scopes')) return new Response(JSON.stringify({ rows: [{ id: 1, label: 'Odevo', isCustomer: true }] }));
    if (url.startsWith('/api/recipients/search')) return new Response(JSON.stringify({ scope: { id: 1, label: 'Odevo' }, rows: [piece(5, 'Mrs A Patel'), piece(6, 'Mr J Patel')], truncated: false }));
    if (url === '/api/reports/audit.pdf') return reportResponse();
    return new Response(JSON.stringify({ rows: [] }));
  }));
});
afterEach(() => vi.unstubAllGlobals());

async function openAudit() {
  render(<MantineProvider theme={theme}><MemoryRouter><ReportsPage /></MemoryRouter></MantineProvider>);
  await userEvent.click(screen.getByRole('combobox', { name: 'Report' }));
  await userEvent.click(await screen.findByRole('option', { name: 'Mailpiece audit report', hidden: true }));
  await waitFor(() => expect(calls.map((c) => c.url)).toContain('/api/recipients/scopes'));
}
async function find() {
  await userEvent.click(screen.getByRole('combobox', { name: /Search in/ }));
  await userEvent.click(await screen.findByRole('option', { name: 'Odevo', hidden: true }));
  await userEvent.type(screen.getByLabelText('Name'), 'patel');
  await userEvent.click(screen.getByRole('button', { name: 'Find mailpieces' }));
  await screen.findByText('Mrs A Patel');
}
const reportCall = () => calls.find((c) => c.url === '/api/reports/audit.pdf');

describe('Mailpiece audit report', () => {
  it('is a choice on the Reports page with its own search form instead of the invoicing account form', async () => {
    await openAudit();
    expect(screen.getByRole('combobox', { name: 'Report' })).toHaveValue('Mailpiece audit report');
    expect(screen.getByLabelText('Pack GUID')).toBeInTheDocument();
    expect(screen.getByLabelText('Reference')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Invoicing account/ })).toBeNull();
  });

  it('shows the matches for review, with none chosen, and only makes the report from the ticked ones', async () => {
    await openAudit(); await find();
    expect(calls.find((c) => c.url.startsWith('/api/recipients/search'))!.url).toBe('/api/recipients/search?accountId=1&name=patel&limit=300');
    expect(screen.getByRole('button', { name: /Create report \(0 mailpieces\)/ })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Include the mailpiece to Mr J Patel in the report' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create report (1 mailpiece)' }));
    await screen.findByRole('link', { name: /Open the report \(1 mailpiece\)/ });
    expect(screen.getByRole('link', { name: /Open the report/ })).toHaveAttribute('href', 'blob:report');
    const body = JSON.parse(String(reportCall()!.init!.body));
    expect(reportCall()!.init!.method).toBe('POST');
    expect(body).toMatchObject({ accountId: 1, mailpieceIds: [6], thumbnails: true });
    expect(body.criteria).toMatch(/Searched in Odevo and below\. Name contains: patel\. 1 of 2 matches were chosen/);
  });

  it('can tick and untick everything, show the letters for checking, and leave the page images out', async () => {
    await openAudit(); await find();
    await userEvent.click(screen.getByRole('button', { name: 'Tick all' }));
    expect(screen.getByRole('button', { name: 'Create report (2 mailpieces)' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Untick all' }));
    expect(screen.getByRole('button', { name: /Create report \(0/ })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Show the letters for Mrs A Patel' }));
    expect(screen.getAllByTestId('pack')).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: 'Tick all' }));
    await userEvent.click(screen.getByRole('checkbox', { name: /Include an image/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Create report (2 mailpieces)' }));
    await screen.findByRole('link', { name: /Open the report/ });
    expect(JSON.parse(String(reportCall()!.init!.body))).toMatchObject({ mailpieceIds: [5, 6], thumbnails: false });
  });

  it('has no price button on the cards, and says what went wrong', async () => {
    await openAudit(); await find();
    expect(screen.queryByRole('button', { name: /Price of the mailpiece/ })).toBeNull();
    reportResponse = () => new Response(JSON.stringify({ errors: { mailpieceIds: 'None of those mailpieces are in the account searched or below.' } }), { status: 422 });
    await userEvent.click(screen.getByRole('button', { name: 'Tick all' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create report (2 mailpieces)' }));
    expect(await screen.findByText(/None of those mailpieces/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Open the report/ })).toBeNull();
  });

  it('describes the search in words for the first page of the report', () => {
    expect(describeSearch('Odevo', { ...EMPTY_FORM, name: ' patel ', referenceKey: 'Tenant Reference', reference: 'T-10*', from: '2026-11-01', to: '2026-11-30' }, 2, 5))
      .toBe('Searched in Odevo and below. Name contains: patel; Reference: T-10*; in field: Tenant Reference; Released from 01/11/2026; Released to 30/11/2026. 2 of 5 matches were chosen for this report.');
  });
});
