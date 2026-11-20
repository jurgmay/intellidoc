import sql from 'mssql';
import { assertScratchDatabase, resetAndSeed } from '../../src/mssql/devDb.js';

export { resetAndSeed };
export const hasDb = Boolean(process.env['INTELLIDOC_TEST_DB']);

/** Connect using INTELLIDOC_TEST_DB, e.g. "Server=host,1433;Database=idoc_test;User Id=u;Password=p;Encrypt=true;TrustServerCertificate=true". */
export async function connect(): Promise<sql.ConnectionPool> {
  const pool = new sql.ConnectionPool(process.env['INTELLIDOC_TEST_DB']!);
  await pool.connect();
  try { await assertScratchDatabase(pool, /test|scratch|tmp/i); } catch (e) { await pool.close(); throw e; }
  return pool;
}
