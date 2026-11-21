import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { MemorySettingsStore } from './settings/store.js';

/** The API with in-memory data and no database, for working on the web app. */
const store = new MemorySettingsStore();
store.rows = [
  { id: 2, changedAt: '2026-11-20T16:42:00.000Z', changedBy: 'system', setting: 'Alert if the PDF has not arrived after', oldValue: '30', newValue: '45' },
  { id: 1, changedAt: '2026-11-19T09:10:00.000Z', changedBy: 'system', setting: 'Machine enclosing: most sheets per letter', oldValue: '16', newValue: '12' },
];
const app = await buildApp({ settings: store, webDir: fileURLToPath(new URL('../../web/dist', import.meta.url)) });
await app.listen({ port: Number(process.env['API_PORT'] ?? 3001), host: '127.0.0.1' });
console.log('Stub API (no database) on http://127.0.0.1:3001');
