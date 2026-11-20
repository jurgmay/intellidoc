import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';

const dbDir = fileURLToPath(new URL('../../../db/', import.meta.url));

export const hasDb = Boolean(process.env['INTELLIDOC_TEST_DB']);

/** Connect using INTELLIDOC_TEST_DB, e.g. "Server=host,1433;Database=idoc_test;User Id=u;Password=p;Encrypt=true;TrustServerCertificate=true". */
export async function connect(): Promise<sql.ConnectionPool> {
  const pool = new sql.ConnectionPool(process.env['INTELLIDOC_TEST_DB']!);
  await pool.connect();
  const name = (await pool.request().query('SELECT DB_NAME() AS n')).recordset[0].n as string;
  // The reset below DROPS every idoc.* object: refuse anything that does not look like a scratch database.
  if (!/test|scratch|tmp/i.test(name)) { await pool.close(); throw new Error(`Refusing to reset database "${name}": its name must contain test, scratch or tmp`); }
  return pool;
}

const DROP_ALL = `
DECLARE @s NVARCHAR(MAX) = N'';
SELECT @s += N'ALTER TABLE ' + QUOTENAME(SCHEMA_NAME(schema_id)) + N'.' + QUOTENAME(OBJECT_NAME(parent_object_id)) + N' DROP CONSTRAINT ' + QUOTENAME(name) + N';'
FROM sys.foreign_keys WHERE schema_id = SCHEMA_ID(N'idoc');
EXEC sp_executesql @s;
SET @s = N'';
SELECT @s += N'DROP VIEW idoc.' + QUOTENAME(name) + N';' FROM sys.views WHERE schema_id = SCHEMA_ID(N'idoc');
EXEC sp_executesql @s;
SET @s = N'';
SELECT @s += N'DROP TABLE idoc.' + QUOTENAME(name) + N';' FROM sys.tables WHERE schema_id = SCHEMA_ID(N'idoc');
EXEC sp_executesql @s;
IF SCHEMA_ID(N'idoc') IS NOT NULL DROP SCHEMA idoc;`;

async function runScript(pool: sql.ConnectionPool, file: string): Promise<void> {
  const text = readFileSync(dbDir + file, 'utf8');
  for (const batch of text.split(/^\s*GO\s*$/gim)) {
    if (batch.trim()) await pool.request().batch(batch);
  }
}

export async function resetAndSeed(pool: sql.ConnectionPool): Promise<void> {
  await pool.request().batch(DROP_ALL);
  await runScript(pool, 'intellidoc_core_schema.sql');
  await runScript(pool, 'test_seed.sql');
}
