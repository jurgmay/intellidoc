import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';

const dbDir = fileURLToPath(new URL('../../../db/', import.meta.url));

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
SET @s = N'';
SELECT @s += N'DROP SEQUENCE idoc.' + QUOTENAME(name) + N';' FROM sys.sequences WHERE schema_id = SCHEMA_ID(N'idoc');
EXEC sp_executesql @s;
IF SCHEMA_ID(N'idoc') IS NOT NULL DROP SCHEMA idoc;`;

export async function schemaExists(pool: sql.ConnectionPool): Promise<boolean> {
  return (await pool.request().query(`SELECT SCHEMA_ID(N'idoc') AS id`)).recordset[0].id !== null;
}

/** Throws unless the connected database name looks like a scratch/dev database. */
export async function assertScratchDatabase(pool: sql.ConnectionPool, pattern: RegExp): Promise<string> {
  const name = (await pool.request().query('SELECT DB_NAME() AS n')).recordset[0].n as string;
  if (!pattern.test(name)) throw new Error(`Refusing to touch database "${name}": its name must match ${pattern}`);
  return name;
}

export async function runScript(pool: sql.ConnectionPool, file: string): Promise<void> {
  const text = readFileSync(dbDir + file, 'utf8');
  for (const batch of text.split(/^\s*GO\s*$/gim)) {
    if (batch.trim()) await pool.request().batch(batch);
  }
}

export async function dropSchema(pool: sql.ConnectionPool): Promise<void> { await pool.request().batch(DROP_ALL); }

/** Drops the idoc schema and rebuilds it with the TEST seed reference data. Scratch databases only. */
export async function resetAndSeed(pool: sql.ConnectionPool): Promise<void> {
  await dropSchema(pool);
  await runScript(pool, 'intellidoc_core_schema.sql');
  await runScript(pool, 'test_seed.sql');
}
