import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { theme } from '../theme';
import { SettingsPage } from './SettingsPage';

const payload = {
  groups: ['Enclosing', 'PDF and alerts', 'Print production settings', 'Page size', 'Envelope window', 'Sequence number', 'MRDF OCR code', 'MRDF Data Matrix', 'Network access', 'Workflow server', 'Email settings', 'H-POD API settings'],
  settings: [
    { key: 'machineEnclosingMaxSheets', group: 'Enclosing', label: 'Machine enclosing: maximum sheets per letter', type: 'integer', unit: 'sheets', min: 1, max: 500,
      description: 'The machine can enclose letters of up to this many sheets.', usedBy: 'Import: routes mailpieces.', appliesTo: 'Next file imported.', value: 12 },
    { key: 'xmlFirstEnabled', group: 'PDF and alerts', label: 'Import an XML without waiting for its PDF', type: 'boolean',
      description: 'When on, an XML is imported as soon as it arrives.', usedBy: 'Folder watcher.', appliesTo: 'No restart needed.', value: true },
    { key: 'autoCompose', group: 'Print production settings', label: 'Make print files automatically', type: 'boolean', description: 'Make the print files as soon as a job is ready.', usedBy: 'Folder watcher.', appliesTo: 'No restart needed.', value: false },
    { key: 'markSeqFontPt', group: 'Sequence number', label: 'Font size', type: 'number', unit: 'pt', min: 1, max: 72, description: 'Size of the sequence number.', usedBy: 'Print files.', appliesTo: 'Next print files.', value: 8 },
    { key: 'windowWidthMm', group: 'Envelope window', label: 'Width', type: 'number', unit: 'mm', min: 0.1, max: 400, description: 'Width of the address window.', usedBy: 'Marks preview.', appliesTo: 'Next preview.', value: 90 },
    { key: 'pageWidthMm', group: 'Page size', label: 'Width', type: 'number', unit: 'mm', min: 50, max: 1000, description: 'Width of the page.', usedBy: 'Marks preview.', appliesTo: 'Next preview.', value: 210 },
    { key: 'networkUsername', group: 'Network access', label: 'Username', type: 'text', description: 'The account the app signs in with.', usedBy: 'Nothing yet.', appliesTo: 'Saved immediately.', value: '' },
    { key: 'networkPassword', group: 'Network access', label: 'Password', type: 'secret', description: 'Stored encrypted.', usedBy: 'Nothing yet.', appliesTo: 'Saved immediately.', value: '', isSet: false },
    { key: 'workflowNetworkPath', group: 'Workflow server', label: 'Network path', type: 'text', description: 'Network path of the workflow server.', usedBy: 'Nothing yet.', appliesTo: 'Saved immediately.', value: '\\\\wf01' },
    { key: 'smtpServer', group: 'Email settings', label: 'SMTP server', type: 'text', description: 'The mail server.', usedBy: 'Test button.', appliesTo: 'Saved immediately.', value: '' },
    { key: 'smtpPort', group: 'Email settings', label: 'SMTP port', type: 'integer', unit: 'port', min: 1, max: 65535, description: 'The mail server port.', usedBy: 'Test button.', appliesTo: 'Saved immediately.', value: 587 },
    { key: 'smtpPassword', group: 'Email settings', label: 'SMTP password', type: 'secret', description: 'Stored encrypted.', usedBy: 'Test button.', appliesTo: 'Saved immediately.', value: '', isSet: false },
    { key: 'hpodEndpoint', group: 'H-POD API settings', label: 'Endpoint', type: 'url', description: 'The H-POD API address.', usedBy: 'Test button.', appliesTo: 'Saved immediately.', value: '' },
    { key: 'hpodPassword', group: 'H-POD API settings', label: 'Password', type: 'secret', description: 'Stored encrypted.', usedBy: 'Nothing yet.', appliesTo: 'Saved immediately.', value: '', isSet: true },
    { key: 'mrdfOcrRotationDeg', group: 'MRDF OCR code', label: 'Rotation', type: 'integer', unit: '°', allowed: [0, 90, 180, 270], description: 'Turns the OCR code clockwise.', usedBy: 'MRDF.', appliesTo: 'Next print files.', value: 0 },
    { key: 'mrdfOcrHeightMm', group: 'MRDF OCR code', label: 'Box height', type: 'number', unit: 'mm', min: 0.1, max: 400, description: 'Height of the OCR code box.', usedBy: 'MRDF.', appliesTo: 'Next print files.', value: 4 },
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
    if (url === '/api/settings/marks-preview') return new Response(new Uint8Array([137, 80, 78, 71]), { status: 200, headers: { 'Content-Type': 'image/png' } });
    if (url.startsWith('/api/settings/audit')) return new Response(JSON.stringify({ rows: [] }), { status: 200 });
    return new Response(JSON.stringify(payload), { status: 200 });
  }));
});
afterEach(() => vi.unstubAllGlobals());
const previews = () => calls.filter((c) => c.url === '/api/settings/marks-preview');

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
    expect(tabs.map((t) => t.textContent)).toEqual(['General', 'Control marks', 'Network', 'Connectivity', 'Postal rates', 'Postal formats', 'Paper', 'Anonymous addressees', 'Change log']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  });
  it('puts the mark positions on the Control marks tab and the rest on General, with one save bar for both', async () => {
    wrap();
    await screen.findByText('Make print files automatically');
    let panel = within(screen.getByRole('tabpanel'));
    expect(panel.getByText('Machine enclosing: maximum sheets per letter')).toBeInTheDocument();
    expect(panel.getByText('Make print files automatically')).toBeInTheDocument();
    expect(panel.queryByText('Font size')).toBeNull();
    expect(screen.getAllByText('No unsaved changes')).toHaveLength(1);
    await userEvent.click(screen.getByRole('tab', { name: 'Control marks' }));
    panel = within(screen.getByRole('tabpanel'));
    expect(panel.getByRole('heading', { name: 'Sequence number' })).toBeInTheDocument();
    expect(panel.getByText('Font size')).toBeInTheDocument();
    expect(panel.getByRole('heading', { name: 'MRDF OCR code' })).toBeInTheDocument();
    expect(panel.getByText('Box height')).toBeInTheDocument();
    expect(panel.queryByText('Make print files automatically')).toBeNull();
    expect(screen.getByText('No unsaved changes')).toBeInTheDocument();
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
  it('offers the OCR code rotation as 0, 90, 180 and 270 and saves the choice as a number', async () => {
    const user = userEvent.setup();
    wrap();
    await screen.findByText('Make print files automatically');
    await user.click(screen.getByRole('tab', { name: 'Control marks' }));
    await user.click(screen.getByDisplayValue('0°'));
    expect(screen.getAllByRole('option', { hidden: true }).map((o) => o.textContent)).toEqual(['0°', '90°', '180°', '270°']);
    await user.click(screen.getByRole('option', { name: '270°', hidden: true }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ values: { mrdfOcrRotationDeg: 270 } });
  });
  describe('Network tab', () => {
    const open = async (user: ReturnType<typeof userEvent.setup>) => {
      await screen.findByText('Make print files automatically');
      await user.click(screen.getByRole('tab', { name: 'Network' }));
      return within(screen.getByRole('tabpanel'));
    };
    it('has the network groups and fields, which are not on General, and shares the save bar', async () => {
      const user = userEvent.setup(); wrap();
      await screen.findByText('Make print files automatically');
      expect(within(screen.getByRole('tabpanel')).queryByText('Username')).toBeNull();
      const panel = await open(user);
      expect(panel.getByRole('heading', { name: 'Network access' })).toBeInTheDocument();
      expect(panel.getByRole('heading', { name: 'Workflow server' })).toBeInTheDocument();
      expect(panel.getByLabelText(/Username/)).toBeInTheDocument();
      expect(panel.getByLabelText(/Password/)).toHaveAttribute('type', 'password');
      expect(panel.getByLabelText(/Network path/)).toHaveValue('\\\\wf01');
      expect(panel.queryByRole('button', { name: /Remove saved password/ })).toBeNull();
      expect(screen.getByText('No unsaved changes')).toBeInTheDocument();
    });
    it('saves the typed values; the password goes only when it is typed', async () => {
      const user = userEvent.setup(); wrap();
      const panel = await open(user);
      await user.type(panel.getByLabelText(/Username/), 'svc_idoc');
      await user.type(panel.getByLabelText(/Password/), 'Tr0ub4dor&3');
      expect(await screen.findByText('2 unsaved changes')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
      expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ values: { networkUsername: 'svc_idoc', networkPassword: 'Tr0ub4dor&3' } });
    });
    it('shows that a password is saved without showing it, and removes it on request', async () => {
      const user = userEvent.setup();
      const saved = { ...payload, settings: payload.settings.map((s) => (s.key === 'networkPassword' ? { ...s, isSet: true } : s)) };
      (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string, init?: { method?: string }) => {
        calls.push({ url, method: init?.method ?? 'GET' });
        if (init?.method === 'DELETE') return new Response(JSON.stringify(payload), { status: 200 });
        return new Response(JSON.stringify(url.includes('audit') ? { rows: [] } : saved), { status: 200 });
      });
      wrap();
      const panel = await open(user);
      const pw = panel.getByLabelText(/Password/);
      expect(pw).toHaveValue(''); expect(pw).toHaveAttribute('placeholder', expect.stringMatching(/A password is saved/));
      await user.click(panel.getByRole('button', { name: 'Remove saved password' }));
      await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url === '/api/settings/networkPassword/secret')).toBe(true));
      await waitFor(() => expect(within(screen.getByRole('tabpanel')).queryByRole('button', { name: 'Remove saved password' })).toBeNull());
      expect(screen.getByText('No unsaved changes')).toBeInTheDocument();
    });
  });

  describe('Connectivity tab', () => {
    const tests = () => calls.filter((c) => c.url.startsWith('/api/settings/test-'));
    const open = async (user: ReturnType<typeof userEvent.setup>) => {
      await screen.findByText('Make print files automatically');
      await user.click(screen.getByRole('tab', { name: 'Connectivity' }));
      return within(screen.getByRole('tabpanel'));
    };
    const answer = (ok: boolean, message: string) => (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : undefined });
      if (url.startsWith('/api/settings/test-')) return new Response(JSON.stringify({ ok, message }), { status: 200 });
      return new Response(JSON.stringify(url.includes('audit') ? { rows: [] } : payload), { status: 200 });
    });
    it('has the two groups with a test button each, and none of it on General', async () => {
      const user = userEvent.setup(); wrap();
      await screen.findByText('Make print files automatically');
      expect(within(screen.getByRole('tabpanel')).queryByText('SMTP server')).toBeNull();
      const panel = await open(user);
      expect(panel.getByRole('heading', { name: 'Email settings' })).toBeInTheDocument();
      expect(panel.getByRole('heading', { name: 'H-POD API settings' })).toBeInTheDocument();
      expect(panel.getByRole('button', { name: 'Send a test e-mail to the system administrator' })).toBeInTheDocument();
      expect(panel.getByRole('button', { name: 'Test the connection' })).toBeInTheDocument();
    });
    it('sends the e-mail settings on screen to the test, without an empty password box, and shows the answer', async () => {
      const user = userEvent.setup(); wrap();
      const panel = await open(user);
      answer(true, 'Test e-mail sent to admin@latcham.co.uk. Check the inbox.');
      await user.type(panel.getByLabelText(/SMTP server/), 'smtp.example.com');
      await user.click(panel.getByRole('button', { name: 'Send a test e-mail to the system administrator' }));
      expect(await screen.findByText(/Test e-mail sent to admin@latcham.co.uk/)).toBeInTheDocument();
      const body = (tests()[0]!.body as { values: Record<string, unknown> }).values;
      expect(tests()[0]!.url).toBe('/api/settings/test-email');
      expect(body).toMatchObject({ smtpServer: 'smtp.example.com', smtpPort: 587 });
      expect(body).not.toHaveProperty('smtpPassword'); expect(body).not.toHaveProperty('hpodEndpoint');
      expect(calls.some((c) => c.method === 'PUT')).toBe(false); // testing saves nothing
    });
    it('shows a failed test in red and tests the H-POD address on screen', async () => {
      const user = userEvent.setup(); wrap();
      const panel = await open(user);
      answer(false, 'Could not reach https://hpod.example.com: ENOTFOUND');
      await user.type(panel.getByLabelText(/Endpoint/), 'https://hpod.example.com');
      await user.click(panel.getByRole('button', { name: 'Test the connection' }));
      expect(await screen.findByText(/ENOTFOUND/)).toBeInTheDocument();
      expect(tests()[0]!.url).toBe('/api/settings/test-hpod');
      expect((tests()[0]!.body as { values: Record<string, unknown> }).values).toMatchObject({ hpodEndpoint: 'https://hpod.example.com' });
    });
  });

  describe('Preview positions', () => {
    beforeEach(() => { URL.createObjectURL = vi.fn(() => 'blob:preview'); URL.revokeObjectURL = vi.fn(); });
    const open = async (user: ReturnType<typeof userEvent.setup>) => {
      await screen.findByText('Make print files automatically');
      await user.click(screen.getByRole('tab', { name: 'Control marks' }));
      await user.click(screen.getByRole('button', { name: 'Preview positions' }));
    };
    it('keeps the page size and envelope window with the other marks settings, away from General', async () => {
      const user = userEvent.setup(); wrap();
      await screen.findByText('Make print files automatically');
      expect(within(screen.getByRole('tabpanel')).queryByRole('heading', { name: 'Envelope window' })).toBeNull();
      await user.click(screen.getByRole('tab', { name: 'Control marks' }));
      const panel = within(screen.getByRole('tabpanel'));
      expect(panel.getByRole('heading', { name: 'Page size' })).toBeInTheDocument();
      expect(panel.getByRole('heading', { name: 'Envelope window' })).toBeInTheDocument();
    });
    it('draws the page from the values on screen, saved or not, and sends only the mark settings', async () => {
      const user = userEvent.setup(); wrap();
      await screen.findByText('Make print files automatically');
      await user.click(screen.getByRole('tab', { name: 'Control marks' }));
      const font = screen.getByLabelText(/Font size/);
      await user.clear(font); await user.type(font, '9');
      await user.click(screen.getByRole('button', { name: 'Preview positions' }));
      expect(await screen.findByRole('img', { name: /first page of a mailpiece/i })).toHaveAttribute('src', 'blob:preview');
      expect(previews()).toHaveLength(1);
      const body = previews()[0]!.body as { page: string; values: Record<string, unknown> };
      expect(body.page).toBe('window');
      expect(body.values).toMatchObject({ markSeqFontPt: 9, windowWidthMm: 90, pageWidthMm: 210 });
      expect(body.values).not.toHaveProperty('autoCompose');
      expect(calls.some((c) => c.method === 'PUT')).toBe(false); // previewing saves nothing
    });
    it('draws the MRDF page when asked', async () => {
      const user = userEvent.setup(); wrap(); await open(user);
      await screen.findByRole('img');
      await user.click(screen.getByText('MRDF page codes', { selector: 'label, label *' }));
      await waitFor(() => expect(previews()).toHaveLength(2));
      expect((previews()[1]!.body as { page: string }).page).toBe('mrdf');
    });
    it('shows the reason when the picture cannot be drawn', async () => {
      const user = userEvent.setup(); wrap();
      (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string) => (url === '/api/settings/marks-preview'
        ? new Response(JSON.stringify({ error: 'The preview could not be drawn: Ghostscript was not found (gs).' }), { status: 503 })
        : new Response(JSON.stringify(url.includes('audit') ? { rows: [] } : payload), { status: 200 })));
      await open(user);
      expect(await screen.findByText(/Ghostscript was not found/)).toBeInTheDocument();
    });
  });
});
