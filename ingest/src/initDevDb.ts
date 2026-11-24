import sql from 'mssql';
import { assertScratchDatabase, dropSchema, longTimeout, runScript, schemaExists } from './mssql/devDb.js';

/**
 * Creates the idoc schema plus the TEST reference data (db/test_seed.sql) in a scratch database so the folder
 * watcher can be tried out. Uses INTELLIDOC_DB. The database name must contain test, scratch, tmp or dev.
 *   npm run db:init           create (refuses if idoc already exists)
 *   npm run db:reset          (reads .env) drop the idoc schema and rebuild it (DESTROYS everything in it)
 * Add --no-test-data to leave the test accounts (FEXCO_CUSTOMER, NATIONAL_GRID_PSR...), stock and prices out: the schema only, for loading real data.
 */
const cs = process.env['INTELLIDOC_DB'];
if (!cs) { console.error('Set INTELLIDOC_DB first'); process.exit(2); }
const reset = process.argv.includes('--reset');
const testData = !process.argv.includes('--no-test-data');
const pool = new sql.ConnectionPool(longTimeout(cs));
await pool.connect();
try {
  const name = await assertScratchDatabase(pool, /test|scratch|tmp|dev/i);
  if (await schemaExists(pool)) {
    if (!reset) { console.error(`Database "${name}" already has an idoc schema. Use --reset to drop and rebuild it (this deletes its data).`); process.exitCode = 1; }
    else { await dropSchema(pool); console.log('Dropped existing idoc schema'); }
  }
  if (!process.exitCode) {
    await runScript(pool, 'intellidoc_core_schema.sql');
    if (testData) await runScript(pool, 'test_seed.sql');
    console.log(`Created idoc schema${testData ? ' and test reference data' : ' (no test data)'} in "${name}"`);
  }
} finally { await pool.close(); }
