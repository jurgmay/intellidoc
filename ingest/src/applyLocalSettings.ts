import sql from 'mssql';
import { assertScratchDatabase, longTimeout } from './mssql/devDb.js';
import { applySettingsSql, LOCAL_SETTINGS_FILE, readLocalSettings } from './localSettings.js';

/**
 * Applies db/local_settings.sql to the scratch database. The last step of db:rebuild; also on its own:  npm run settings:apply
 * With no file nothing changes and the schema's defaults stay.
 */
const text = readLocalSettings();
if (text === null) { console.log(`No ${LOCAL_SETTINGS_FILE}: the schema's default settings are kept. (npm run settings:export writes one from the current Settings.)`); process.exit(0); }
const cs = process.env['INTELLIDOC_DB'];
if (!cs) { console.error('Set INTELLIDOC_DB first'); process.exit(2); }
const pool = new sql.ConnectionPool(longTimeout(cs));
await pool.connect();
try {
  await assertScratchDatabase(pool, /test|scratch|tmp|dev/i);
  await applySettingsSql(pool, text);
  console.log(`Applied your settings from ${LOCAL_SETTINGS_FILE}`);
} catch (e) { console.error((e as Error).message); process.exitCode = 1; }
finally { await pool.close(); }
