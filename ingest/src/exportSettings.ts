import { writeFileSync } from 'node:fs';
import sql from 'mssql';
import { assertScratchDatabase, longTimeout } from './mssql/devDb.js';
import { exportSettingsSql, LOCAL_SETTINGS_FILE } from './localSettings.js';

/**
 * Writes the scratch database's current Settings (everything on the Settings page) to db/local_settings.sql, which db:rebuild applies after
 * rebuilding. Replaces the file. Reads the same connection string as the watcher (INTELLIDOC_DB).
 *   npm run settings:export
 *   npm run settings:export -- --print     show the SQL instead of writing the file
 */
const cs = process.env['INTELLIDOC_DB'];
if (!cs) { console.error('Set INTELLIDOC_DB first'); process.exit(2); }
const pool = new sql.ConnectionPool(longTimeout(cs));
await pool.connect();
try {
  await assertScratchDatabase(pool, /test|scratch|tmp|dev/i);
  const text = await exportSettingsSql(pool);
  if (process.argv.includes('--print')) console.log(text);
  else { writeFileSync(LOCAL_SETTINGS_FILE, text, 'utf8'); console.log(`Wrote the current Settings to ${LOCAL_SETTINGS_FILE}\ndb:rebuild will apply them after rebuilding.`); }
} finally { await pool.close(); }
