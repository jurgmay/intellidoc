import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { theme } from '../theme';
import { SettingsPage } from './SettingsPage';

const payload = {
  groups: ['Enclosing', 'PDF and alerts'],
  settings: [
    { key: 'machineEnclosingMaxSheets', group: 'Enclosing', label: 'Machine enclosing: maximum sheets per letter', type: 'integer', unit: 'sheets', min: 1, max: 500,
      description: 'The machine can enclose letters of up to this many sheets.', usedBy: 'Import: routes mailpieces.', appliesTo: 'Next file imported.', value: 12 },
    { key: 'xmlFirstEnabled', group: 'PDF and alerts', label: 'Import an XML without waiting for its PDF', type: 'boolean',
      description: 'When on, an XML is imported as soon as it arrives.', usedBy: 'Folder watcher.', appliesTo: 'No restart needed.', value: true },
  ],
  batchCode: { highestUsed: 1041, next: 1042 },
};

const wrap = () => render(<MantineProvider theme={theme}><Notifications /><SettingsPage /></MantineProvider>);
let calls: { url: string; method: string; body?: unknown }[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : undefined });
    if (url === '/api/settings' && init?.method === 'PUT') {
      return new Response(JSON.stringify({ changed: 1, ...payload, settings: payload.settings.map((s) => (s.key === 'machineEnclosingMaxSheets' ? { ...s, value: 10 } : s)) }), { status: 200 });
    }
    if (url.startsWith('/api/settings/audit')) return new Response(JSON.stringify({ rows: [] }), { status: 200 });
    return new Response(JSON.stringify(payload), { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('SettingsPage', () => {
  it('shows each setting with its explanation and where it is used', async () => {
    wrap();
    expect(await screen.findByText('The machine can enclose letters of up to this many sheets.')).toBeInTheDocument();
    expect(screen.getByText(/Import: routes mailpieces/)).toBeInTheDocument();
    expect(screen.getByText('No unsaved changes')).toBeInTheDocument();
    expect(screen.getByText(/Highest batch code used so far/)).toHaveTextContent('1041');
  });
  it('names the first tab General and opens on it', async () => {
    wrap();
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['General', 'Postal rates', 'Postal formats', 'Paper', 'Anonymous addressees', 'Change log']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  });
  it('saves only what was changed', async () => {
    const user = userEvent.setup();
    wrap();
    const input = await screen.findByLabelText(/Machine enclosing: maximum sheets per letter/);
    await user.clear(input); await user.type(input, '10');
    expect(await screen.findByText('1 unsaved change')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ values: { machineEnclosingMaxSheets: 10 } });
    expect(await screen.findByText('No unsaved changes')).toBeInTheDocument();
  });
  it('shows the server message next to a rejected value', async () => {
    const user = userEvent.setup();
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string, init?: { method?: string }) => {
      if (init?.method === 'PUT') return new Response(JSON.stringify({ errors: { machineEnclosingMaxSheets: 'Machine enclosing: maximum sheets per letter must be at least 1' } }), { status: 422 });
      return new Response(JSON.stringify(url.includes('audit') ? { rows: [] } : payload), { status: 200 });
    });
    wrap();
    const input = await screen.findByLabelText(/Machine enclosing: maximum sheets per letter/);
    await user.clear(input); await user.type(input, '3');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect((await screen.findAllByText(/must be at least 1/)).length).toBeGreaterThan(0);
  });
});
