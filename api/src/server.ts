import { fileURLToPath } from 'node:url';
import sql from 'mssql';
import { buildApp } from './app.js';
import { MssqlCustomerStore } from './customers/mssqlStore.js';
import { MssqlSettingsStore } from './settings/store.js';

const cs = process.env['INTELLIDOC_DB'];
if (!cs) { console.error('Set INTELLIDOC_DB (see api/.env.example)'); process.exit(2); }
const pool = await new sql.ConnectionPool(cs).connect();
const app = await buildApp({ settings: new MssqlSettingsStore(pool), customers: new MssqlCustomerStore(pool), webDir: fileURLToPath(new URL('../../web/dist', import.meta.url)) });
const port = Number(process.env['API_PORT'] ?? 3001);
const host = process.env['API_HOST'] ?? '127.0.0.1';
await app.listen({ port, host });
console.log(`IntelliDoc API on http://${host}:${port}  (database: ${(await pool.request().query('SELECT DB_NAME() AS n')).recordset[0].n})`);
