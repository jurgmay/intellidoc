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
  it('has a Batches page in the menu', async () => {
    show('/batches');
    expect(await screen.findByRole('heading', { name: 'Batches' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Batches' })).toHaveAttribute('href', '/batches');
  });
  it('lists Jobs, Batches, Mailpieces in that order, and one Reports page instead of two', async () => {
    show('/reports');
    expect(await screen.findByRole('heading', { name: 'Reports' })).toBeInTheDocument();
    const labels = screen.getAllByRole('link').map((l) => l.textContent);
    expect(labels.indexOf('Jobs')).toBeLessThan(labels.indexOf('Batches'));
    expect(labels.indexOf('Batches')).toBeLessThan(labels.indexOf('Mailpieces'));
    expect(labels).toContain('Reports');
    expect(labels).not.toContain('Usage report');
    expect(labels).not.toContain('Margin report');
  });
  it('sends the old margin address to Reports', async () => {
    show('/margin');
    expect(await screen.findByRole('heading', { name: 'Reports' })).toBeInTheDocument();
  });
  it('sends the old address to the new one', async () => {
    show('/search');
    expect(await screen.findByRole('heading', { name: 'Mailpieces' })).toBeInTheDocument();
  });
});
