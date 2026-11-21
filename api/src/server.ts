import { fileURLToPath } from 'node:url';
import sql from 'mssql';
import { buildApp } from './app.js';
import { MssqlCustomerStore } from './customers/mssqlStore.js';
import { MssqlSettingsStore } from './settings/store.js';

const cs = process.env['INTELLIDOC_DB'];
if (!cs) { console.error('Set INTELLIDOC_DB (see api/.env.example)'); process.exit(2); }
const pool = await new sql.ConnectionPool(cs).connect();
const customers = new MssqlCustomerStore(pool);
const rollJobNumbers = (): void => { customers.applyDuePending().then((n) => { if (n > 0) console.log(`${n} pending job number(s) took effect`); }).catch((e: Error) => console.error('Pending job numbers:', e.message)); };
rollJobNumbers();
setInterval(rollJobNumbers, 10 * 60_000).unref();
const app = await buildApp({ settings: new MssqlSettingsStore(pool), customers, webDir: fileURLToPath(new URL('../../web/dist', import.meta.url)) });
const port = Number(process.env['API_PORT'] ?? 3001);
const host = process.env['API_HOST'] ?? '127.0.0.1';
await app.listen({ port, host });
console.log(`IntelliDoc API on http://${host}:${port}  (database: ${(await pool.request().query('SELECT DB_NAME() AS n')).recordset[0].n})`);
