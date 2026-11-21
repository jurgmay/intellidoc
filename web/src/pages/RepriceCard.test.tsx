import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { theme } from '../theme';
import { RepriceCard } from './customer/RepriceCard';

let calls: { url: string; body?: any }[]; // eslint-disable-line @typescript-eslint/no-explicit-any
let counts: object;
const wrap = () => render(<MantineProvider theme={theme}><Notifications /><RepriceCard customerId={7} /></MantineProvider>);
beforeEach(() => {
  calls = []; counts = { inScope: 412, alreadyPriced: 380, wouldPrice: 31, noModel: 1, unknownColours: 2 };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { body?: string }) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    if (url.endsWith('/preview')) return new Response(JSON.stringify(counts), { status: 200 });
    return new Response(JSON.stringify({ priced: 31, noModel: 1, unknownColours: 2 }), { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('RepriceCard', () => {
  it('previews first and only prices after the confirm button', async () => {
    wrap();
    await userEvent.click(screen.getByRole('button', { name: 'Check how much mail this covers' }));
    expect(await screen.findByText(/31 would be priced/)).toBeInTheDocument();
    expect(screen.getByText(/412 mailpieces in this range, 380 already priced/)).toBeInTheDocument();
    expect(screen.getByText(/1 left as they are: no costing model/)).toBeInTheDocument();
    expect(calls.map((c) => c.url)).toEqual(['/api/customers/7/reprice/preview']);
    await userEvent.click(screen.getByRole('button', { name: 'Price 31 mailpieces' }));
    await waitFor(() => expect(calls.at(-1)!.url).toBe('/api/customers/7/reprice'));
    expect(calls.at(-1)!.body).toEqual({ from: null, to: null, overwrite: false });
    expect(await screen.findByText(/31 priced\./)).toBeInTheDocument();
  });
  it('sends the dates and the overwrite choice, and forgets the preview when they change', async () => {
    wrap();
    await userEvent.type(screen.getByLabelText('From (first day)'), '2026-01-01');
    await userEvent.click(screen.getByLabelText(/Also price mail that already has a price/));
    await userEvent.click(screen.getByRole('button', { name: 'Check how much mail this covers' }));
    expect(await screen.findByText(/existing prices replaced/)).toBeInTheDocument();
    expect(calls[0]!.body).toEqual({ from: '2026-01-01', to: null, overwrite: true });
    await userEvent.type(screen.getByLabelText('To (last day)'), '2026-03-31');
    expect(screen.queryByText(/would be priced/)).not.toBeInTheDocument();
  });
  it('has nothing to confirm when nothing would be priced', async () => {
    counts = { inScope: 5, alreadyPriced: 5, wouldPrice: 0, noModel: 0, unknownColours: 0 };
    wrap();
    await userEvent.click(screen.getByRole('button', { name: 'Check how much mail this covers' }));
    expect(await screen.findByRole('button', { name: 'Price 0 mailpieces' })).toBeDisabled();
  });
});
