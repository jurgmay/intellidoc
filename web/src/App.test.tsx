import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { theme } from './theme';
import { App } from './App';
import { resetRecipientSearchSession } from './pages/recipientSearchSession';

beforeEach(() => { resetRecipientSearchSession(); vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ rows: [] })))); });
afterEach(() => vi.unstubAllGlobals());
const show = (path: string) => render(<MantineProvider theme={theme}><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></MantineProvider>);

describe('navigation', () => {
  it('calls the page Mailpieces in the menu and in its header', async () => {
    show('/mailpieces');
    expect(await screen.findByRole('heading', { name: 'Mailpieces' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Mailpieces' })).toHaveAttribute('href', '/mailpieces');
    expect(screen.queryByText('Recipient search')).not.toBeInTheDocument();
  });
  it('sends the old address to the new one', async () => {
    show('/search');
    expect(await screen.findByRole('heading', { name: 'Mailpieces' })).toBeInTheDocument();
  });
});
