import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { theme } from './theme';
import { App } from './App';
import { AuthGate, type Me } from './auth';
import { api } from './api/client';
import { nav } from './api/signIn';

const me = (over: Partial<Me> = {}): Me => ({ name: 'Jo Staff', email: 'jo@latcham.co.uk', roles: ['User'], isAdmin: false, hasAccess: true, signedInByDevelopmentBypass: false, ...over });
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
let calls: { url: string; method: string }[];
let meResponse: () => Response;
let go: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  calls = []; window.history.pushState({}, '', '/jobs?x=1');
  go = vi.spyOn(nav, 'to').mockImplementation(() => undefined);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET' });
    if (url === '/api/auth/me') return meResponse();
    if (url === '/api/auth/logout') return json({ redirect: 'https://login.example/logout' });
    return json({ rows: [] });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); go.mockRestore(); window.history.pushState({}, '', '/'); });
const show = () => render(<MantineProvider theme={theme}><AuthGate><MemoryRouter initialEntries={['/customers']}><App /></MemoryRouter></AuthGate></MantineProvider>);

describe('sign-in gate', () => {
  it('sends someone who is not signed in to Entra and back to the same page', async () => {
    meResponse = () => json({ error: 'Not signed in.' }, 401);
    show();
    await waitFor(() => expect(go).toHaveBeenCalledWith('/api/auth/login?returnTo=%2Fjobs%3Fx%3D1'));
    expect(screen.queryByRole('link', { name: 'Customers' })).not.toBeInTheDocument();
  });
  it('shows the app and who is signed in; an ordinary user has no Settings', async () => {
    meResponse = () => json(me());
    show();
    expect(await screen.findByText('Jo Staff')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Customers' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
  });
  it('gives an administrator Settings', async () => {
    meResponse = () => json(me({ roles: ['Admin'], isAdmin: true }));
    show();
    expect(await screen.findByText('Jo Staff (administrator)')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeInTheDocument();
  });
  it('says so when the account has no role, and offers sign out', async () => {
    meResponse = () => json(me({ roles: [], hasAccess: false }));
    show();
    expect(await screen.findByText('No access to IntelliDoc')).toBeInTheDocument();
    expect(screen.getByText(/jo@latcham.co.uk/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Customers' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(go).toHaveBeenCalledWith('https://login.example/logout'));
  });
  it('signs out with a POST and follows the address the API gives', async () => {
    meResponse = () => json(me());
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(go).toHaveBeenCalledWith('https://login.example/logout'));
    expect(calls).toContainEqual({ url: '/api/auth/logout', method: 'POST' });
  });
  it('shows a plain page after sign-out without asking who is signed in', async () => {
    window.history.pushState({}, '', '/signed-out');
    meResponse = () => json({}, 401);
    show();
    expect(await screen.findByText('You have signed out')).toBeInTheDocument();
    expect(calls.find((c) => c.url === '/api/auth/me')).toBeUndefined();
    expect(go).not.toHaveBeenCalled();
  });
  it('shows development mode instead of a sign-out link', async () => {
    meResponse = () => json(me({ name: 'Development user', roles: ['Admin'], isAdmin: true, signedInByDevelopmentBypass: true }));
    show();
    expect(await screen.findByText('sign-in is off')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument();
  });
  it('tells the person when the API cannot be reached', async () => {
    meResponse = () => json({}, 500);
    show();
    expect(await screen.findByText(/Could not reach IntelliDoc/)).toBeInTheDocument();
  });
});

describe('a session that ends while the app is open', () => {
  it('signs in again when an API call comes back 401', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => json({ error: 'Sign in to continue.' }, 401));
    await expect(api('/api/jobs')).rejects.toThrow(/sign-in has ended/);
    expect(go).toHaveBeenCalledWith('/api/auth/login?returnTo=%2Fjobs%3Fx%3D1');
  });
});
