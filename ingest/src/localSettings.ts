/**
 * Your own Settings values, kept in db/local_settings.sql (not in git) so a rebuild of the scratch database does not lose them.
 * `npm run settings:export` writes the file from the database's current Settings; `npm run db:rebuild` (and `npm run settings:apply`) applies it.
 * The schema's DEFAULTs stay as they are, and the DB tests still run against them.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type sql from 'mssql';

export const LOCAL_SETTINGS_FILE = fileURLToPath(new URL('../../db/local_settings.sql', import.meta.url));

/** A T-SQL literal for a value read from idoc.settings (number, bit, text or null). */
export function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error(`Cannot write ${v} as a setting`); return String(v); }
  if (typeof v === 'string') return `N'${v.replace(/'/g, "''")}'`;
  throw new Error(`Cannot write a ${typeof v} as a setting`);
}

const HEADER = (when: Date) => `-- Your Settings values. Applied after the schema is rebuilt by \`npm run db:rebuild\` (and by \`npm run settings:apply\`).
-- Written by \`npm run settings:export\` on ${when.toISOString().slice(0, 16).replace('T', ' ')} UTC. Edit it by hand if you like:
-- a line you delete keeps the schema's default, and a column the schema no longer has must be deleted (or run settings:export again after a rebuild).
-- This file is not in git. Values are the same units as the Settings page (mm, pt, minutes, ...).
`;

/** The UPDATE for one idoc.settings row (the row read with SELECT *), every column but settings_id, in column order. */
export function settingsSql(row: Record<string, unknown>, when: Date = new Date()): string {
  const cols = Object.keys(row).filter((c) => c !== 'settings_id');
  if (!cols.length) throw new Error('The settings row has no columns');
  return `${HEADER(when)}UPDATE idoc.settings SET\n${cols.map((c) => `    ${c} = ${sqlLiteral(row[c])}`).join(',\n')}\nWHERE settings_id = 1;\n`;
}

export async function exportSettingsSql(pool: sql.ConnectionPool, when?: Date): Promise<string> {
  const row = (await pool.request().query('SELECT * FROM idoc.settings WHERE settings_id = 1')).recordset[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error('idoc.settings has no row');
  return settingsSql(row, when);
}

/** Runs the file's SQL. A column the schema does not have is reported with what to do about it. */
export async function applySettingsSql(pool: sql.ConnectionPool, text: string): Promise<void> {
  try { await pool.request().batch(text); }
  catch (e) {
    const msg = (e as Error).message;
    const bad = /Invalid column name '([^']+)'/.exec(msg);
    if (bad) throw new Error(`db/local_settings.sql sets "${bad[1]}", which the schema no longer has. Delete that line from the file (or run npm run settings:export after a rebuild to write it afresh).`);
    throw new Error(`db/local_settings.sql could not be applied: ${msg}`);
  }
}

/** The file's text, or null when there is no file. */
export function readLocalSettings(file: string = LOCAL_SETTINGS_FILE): string | null {
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}
