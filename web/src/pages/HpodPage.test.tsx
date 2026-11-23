import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { theme } from '../theme';
import { HpodPage } from './HpodPage';

const status = { configured: true, missing: [] as string[], endpoint: 'https://api-uk.h-pod.co.uk', instance: 'uk', accountLogin: 'latcham', username: 'jo@latcham.example', signedIn: false, expiresAt: null as string | null, claims: null };
const signedIn = { ...status, signedIn: true, expiresAt: '2026-11-23T11:00:00.000Z' };
const G = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const operations = {
  groups: ['Authenticate', 'Print', 'Pack'],
  operations: [
    { id: 'authenticate', group: 'Authenticate', method: 'POST', path: '/authenticate', auth: 'settings', summary: 'Acquire a token', description: 'Signs in with the settings.' },
    { id: 'printConfiguration', group: 'Print', method: 'GET', path: '/print/configuration', auth: 'bearer', summary: 'Get configuration', description: 'The account options.' },
    { id: 'jobStatus', group: 'Print', method: 'GET', path: '/job/status/{jobGuid}', auth: 'bearer', summary: 'Get a job status', description: 'How far a job has got.', pathParams: [{ name: 'jobGuid', label: 'Job GUID', required: true }] },
    { id: 'packBatch', group: 'Pack', method: 'POST', path: '/pack/batch', auth: 'bearer', summary: 'Update pack statuses', description: 'Sets statuses.', live: 'This changes the status of live packs in H-POD.', body: { kind: 'json', sample: { packs: [] } } },
  ],
};
const result = (body: unknown, over: Record<string, unknown> = {}) => ({ status: 200, statusText: 'OK', ok: true, durationMs: 42, headers: { 'x-rate-limit-remaining': '29' }, bodyKind: 'json', body, request: { method: 'GET', url: 'https://api-uk.h-pod.co.uk/v3/x', headers: { Authorization: 'Bearer eyJhbGciOi...abcd' } }, ...over });
const config = { papers: [{ guid: G(1), name: '80gsm white', isDefault: true }, { guid: G(2), name: '100gsm white', isDefault: false }], envelopes: [{ guid: G(11), name: 'C5 window', isDefault: true }], inks: [{ guid: G(21), name: 'Black', isDefault: true }], duplexes: [{ guid: G(31), name: 'Double sided', isDefault: true }], packModes: [{ guid: G(41), name: 'One per pack', isDefault: true }], deliveries: [{ guid: G(51), name: '2nd class', isDefault: true }] };

let calls: { url: string; method: string; body?: any }[];
let current: typeof status;
let answers: Record<string, (body: any) => { status?: number; json: unknown }>;

beforeEach(() => {
  calls = []; current = status; answers = {};
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? 'GET', body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    const custom = answers[`${method} ${url}`];
    if (custom) { const a = custom(body); return new Response(JSON.stringify(a.json), { status: a.status ?? 200 }); }
    if (url === '/api/hpod/operations') return new Response(JSON.stringify(operations));
    if (url === '/api/hpod/session' && method === 'GET') return new Response(JSON.stringify(current));
    if (url === '/api/hpod/session' && method === 'POST') { current = signedIn; return new Response(JSON.stringify({ status: signedIn, result: result({ token: '********' }, { request: { method: 'POST', url: 'https://x/v3/authenticate', headers: {}, body: { password: '********' } } }) })); }
    if (url === '/api/hpod/session' && method === 'DELETE') { current = status; return new Response(JSON.stringify(status)); }
    if (url === '/api/hpod/call') return new Response(JSON.stringify({ status: current, result: result(body.operation === 'printConfiguration' ? config : { done: body.operation }) }));
    return new Response('{}', { status: 404 });
  }));
});
afterEach(() => vi.unstubAllGlobals());

const wrap = () => render(<MantineProvider theme={theme}><MemoryRouter><HpodPage /></MemoryRouter></MantineProvider>);
const callsTo = (url: string) => calls.filter((c) => c.url === url && c.method === 'POST');
const panel = () => within(screen.getByRole('tabpanel'));
async function choose(user: ReturnType<typeof userEvent.setup>, label: string | RegExp, option: string) {
  await user.click(screen.getByRole('combobox', { name: label }));
  await user.click(await screen.findByRole('option', { name: option, hidden: true }));
}

describe('the session bar', () => {
  it('says what to fill in on Settings when H-POD is not set up, and offers no tabs', async () => {
    current = { ...status, configured: false, missing: ['Account code', 'Password'] };
    wrap();
    expect(await screen.findByText('H-POD is not set up yet')).toBeInTheDocument();
    expect(screen.getByText(/Enter the Account code, Password on/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Settings > Connectivity/ })).toHaveAttribute('href', '/settings');
    expect(screen.queryByRole('tab', { name: 'Console' })).not.toBeInTheDocument();
  });

  it('signs in and out, showing who and until when', async () => {
    const user = userEvent.setup();
    wrap();
    expect(await screen.findByText('Not signed in')).toBeInTheDocument();
    expect(screen.getByText(/jo@latcham.example · account latcham · instance uk/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Signed in')).toBeInTheDocument();
    expect(screen.getByText('Token valid until 2026-11-23 11:00 UTC')).toBeInTheDocument();
    expect(callsTo('/api/hpod/session')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('Not signed in')).toBeInTheDocument();
  });

  it('shows why a sign-in failed', async () => {
    const user = userEvent.setup();
    answers['POST /api/hpod/session'] = () => ({ status: 502, json: { error: 'H-POD refused the sign-in details (HTTP 401): Invalid login', kind: 'auth' } });
    wrap();
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('H-POD refused the sign-in details (HTTP 401)');
    expect(screen.getByText('Not signed in')).toBeInTheDocument();
  });
});

describe('Console', () => {
  const open = async (user: ReturnType<typeof userEvent.setup>) => { wrap(); await user.click(await screen.findByRole('tab', { name: 'Console' })); };

  it('sends the chosen operation and shows the status, the call limits, the response and the request sent', async () => {
    const user = userEvent.setup();
    await open(user);
    await user.click(panel().getByRole('button', { name: 'Send' }));
    const r = await screen.findByTestId('hpod-result');
    expect(r).toHaveTextContent('200 OK'); expect(r).toHaveTextContent('42 ms'); expect(r).toHaveTextContent('x-rate-limit-remaining: 29');
    expect(r).toHaveTextContent('80gsm white');
    expect(callsTo('/api/hpod/call')[0]!.body).toMatchObject({ operation: 'printConfiguration' });
    await user.click(within(r).getByText('Request sent'));
    expect(r).toHaveTextContent('Bearer eyJhbGciOi...abcd');
  });

  it('asks for the path parameter it needs, and shows what the server said when it refuses', async () => {
    const user = userEvent.setup();
    answers['POST /api/hpod/call'] = () => ({ status: 422, json: { errors: { jobGuid: 'Job GUID is required.' } } });
    await open(user);
    await choose(user, 'Operation', 'Get a job status (GET /job/status/{jobGuid})');
    expect(panel().getByLabelText(/Job GUID/)).toBeInTheDocument();
    await user.click(panel().getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Job GUID is required.');
  });

  it('does not send a live operation until it is confirmed, and says what it does', async () => {
    const user = userEvent.setup();
    await open(user);
    await choose(user, 'Operation', 'Update pack statuses (POST /pack/batch)');
    expect(panel().getByText('This changes the status of live packs in H-POD.')).toBeInTheDocument();
    await user.click(panel().getByRole('button', { name: 'Send' }));
    const dlg = await screen.findByRole('dialog');
    await user.click(within(dlg).getByRole('button', { name: 'Cancel' }));
    expect(callsTo('/api/hpod/call')).toHaveLength(0);
    await user.click(panel().getByRole('button', { name: 'Send' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Yes, send it' }));
    await waitFor(() => expect(callsTo('/api/hpod/call')).toHaveLength(1));
    expect(callsTo('/api/hpod/call')[0]!.body).toMatchObject({ operation: 'packBatch', confirm: true, body: { packs: [] } });
  });

  it('will not send a body that is not JSON', async () => {
    const user = userEvent.setup();
    await open(user);
    await choose(user, 'Operation', 'Update pack statuses (POST /pack/batch)');
    const body = panel().getByLabelText(/Body \(JSON\)/);
    await user.clear(body); await user.click(body); await user.paste('{ nope');
    await user.click(panel().getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/The body is not valid JSON/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(callsTo('/api/hpod/call')).toHaveLength(0);
  });
});

describe('Submit', () => {
  it('loads the options, sends a PDF after a confirmation, shows the steps, and hands the job to Track', async () => {
    const user = userEvent.setup();
    answers['POST /api/hpod/submit'] = () => ({ json: { ok: true, jobGuid: G(99), message: 'Submitted: job 00000000-0000-4000-8000-000000000099.', commit: {}, steps: [
      { step: 'init', label: 'Start the submission', ok: true, status: 200, durationMs: 80 }, { step: 'docpart', label: 'Send part 1 of 1', ok: true, status: 200, durationMs: 120 }, { step: 'commit', label: 'Commit', ok: true, status: 200, durationMs: 90 }] } });
    wrap();
    await user.click(await screen.findByRole('button', { name: /Load the account's options/ }));
    expect(await panel().findByRole('combobox', { name: 'Paper' })).toHaveValue('80gsm white');
    expect(panel().getByRole('button', { name: 'Submit to H-POD' })).toBeDisabled();
    await user.upload(document.querySelector('input[type=file]') as HTMLInputElement, new File(['%PDF-1.4 hi'], 'letter.pdf', { type: 'application/pdf' }));
    await user.type(panel().getByLabelText(/Recipient address/), 'Mrs A Patel{Enter}12 Mill Lane');
    await user.type(panel().getByLabelText(/Postcode/), 'LS1 4AB');
    await user.click(panel().getByRole('button', { name: 'Submit to H-POD' }));
    const dlg = await screen.findByRole('dialog');
    expect(dlg).toHaveTextContent('"letter.pdf" will be sent to H-POD');
    expect(callsTo('/api/hpod/submit')).toHaveLength(0);
    await user.click(within(dlg).getByRole('button', { name: 'Yes, submit it' }));
    expect(await panel().findByText('Send part 1 of 1')).toBeInTheDocument();
    const sent = callsTo('/api/hpod/submit')[0]!.body;
    expect(sent).toMatchObject({ fileName: 'letter.pdf', confirm: true, data: btoa('%PDF-1.4 hi'),
      options: { name: 'Demo letter', clientId: 'demo-1', paper: { guid: G(1) }, envelope: { guid: G(11) }, ink: { guid: G(21) }, duplex: { guid: G(31) }, packMode: { guid: G(41) }, delivery: { guid: G(51) } },
      commit: { extractAddress: true, abortOnValidationFailure: true, recipients: [{ address: ['Mrs A Patel', '12 Mill Lane'], addressType: 'Postal', postcode: 'LS1 4AB', countryCode: 'GB' }] } });
    await user.click(panel().getByRole('button', { name: 'Track this job' }));
    expect(await panel().findByLabelText('Job GUID')).toHaveValue(G(99));
  });

  it('shows the step that failed', async () => {
    const user = userEvent.setup();
    answers['POST /api/hpod/submit'] = () => ({ json: { ok: false, jobGuid: null, message: 'Could not start the submission: Unknown paper', commit: null, steps: [{ step: 'init', label: 'Start the submission', ok: false, status: 400, durationMs: 50, message: 'Unknown paper' }] } });
    wrap();
    await user.click(await screen.findByRole('button', { name: /Load the account's options/ }));
    await panel().findByRole('combobox', { name: 'Paper' });
    await user.upload(document.querySelector('input[type=file]') as HTMLInputElement, new File(['x'], 'a.pdf', { type: 'application/pdf' }));
    await user.click(panel().getByRole('button', { name: 'Submit to H-POD' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Yes, submit it' }));
    expect(await panel().findByRole('status')).toHaveTextContent('Could not start the submission: Unknown paper');
    expect(panel().getByText('Failed (400): Unknown paper')).toBeInTheDocument();
  });
});

describe('Track', () => {
  it('looks a job up, offers its packs, and sets a pack status only after a confirmation', async () => {
    const user = userEvent.setup();
    answers['POST /api/hpod/call'] = (b) => ({ json: { status: current, result: result(b.operation === 'jobStatus' ? { guid: G(99), completed: true, packs: [{ guid: G(700) }] } : { updated: 1 }) } });
    wrap();
    await user.click(await screen.findByRole('tab', { name: 'Track' }));
    await user.type(panel().getByLabelText('Job GUID'), G(99));
    await user.click(panel().getByRole('button', { name: 'Get job status' }));
    expect(callsTo('/api/hpod/call')[0]!.body).toMatchObject({ operation: 'jobStatus', path: { jobGuid: G(99) } });
    await user.click(await panel().findByRole('button', { name: G(700) }));
    expect(panel().getByLabelText('Pack GUID')).toHaveValue(G(700));
    await user.type(panel().getByLabelText(/Context/), 'RM123');
    await user.click(panel().getByRole('button', { name: 'Set status' }));
    expect(callsTo('/api/hpod/call')).toHaveLength(1);
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Yes, change it' }));
    await waitFor(() => expect(callsTo('/api/hpod/call')).toHaveLength(2));
    expect(callsTo('/api/hpod/call')[1]!.body).toMatchObject({ operation: 'packBatch', confirm: true, body: { permitPartialUpdate: false, packs: [{ packGUID: G(700), status: 'printed', context: 'RM123' }] } });
  });
});
