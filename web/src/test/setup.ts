import '@testing-library/jest-dom/vitest';

// Mantine needs these browser APIs, which jsdom lacks.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({ matches: false, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false }),
});
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
Element.prototype.scrollIntoView = () => {};
// Mantine's auto-sizing Textarea listens for web fonts loading.
Object.defineProperty(document, 'fonts', { configurable: true, value: { addEventListener: () => {}, removeEventListener: () => {} } });
// Mantine renders slowly in jsdom; the default 1s wait is too tight when the whole suite runs.
import { configure } from '@testing-library/react';
configure({ asyncUtilTimeout: 4000 });
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
afterEach(() => cleanup());
