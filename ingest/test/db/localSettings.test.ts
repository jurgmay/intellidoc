import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type sql from 'mssql';
import { connect, hasDb, resetAndSeed } from './setup.js';
import { applySettingsSql, exportSettingsSql } from '../../src/localSettings.js';

/** Against a REAL scratch SQL Server database (INTELLIDOC_TEST_DB); see setup.ts. */
describe.skipIf(!hasDb)('local settings file', { timeout: 120_000 }, () => {   // the test resets the schema, which takes longer than vitest's 5 s
  let pool: sql.ConnectionPool;
  beforeAll(async () => { pool = await connect(); await resetAndSeed(pool); });
  afterAll(async () => { await pool?.close(); });
  const row = async () => (await pool.request().query('SELECT * FROM idoc.settings WHERE settings_id = 1')).recordset[0] as Record<string, unknown>;

  it('exports the current settings, and applying that file after a reset brings them back', async () => {
    await pool.request().query(`UPDATE idoc.settings SET page_width_mm = 297, mark_seq_font_pt = 9.5, auto_compose = 1, alert_recipients = N'o''neil@latcham.co.uk', mrdf_ocr_rotation_deg = 90 WHERE settings_id = 1`);
    const before = await row();
    const text = await exportSettingsSql(pool);
    await resetAndSeed(pool);
    expect((await row())['page_width_mm']).toBe(210);
    await applySettingsSql(pool, text);
    expect(await row()).toEqual(before);
  });
  it('keeps the next batch code across a rebuild', async () => {
    await pool.request().query('ALTER SEQUENCE idoc.batch_code_seq RESTART WITH 8123');
    const text = await exportSettingsSql(pool);
    expect(text).toContain('RESTART WITH 8123;');
    await resetAndSeed(pool);
    await applySettingsSql(pool, text);
    const cur = (await pool.request().query(`SELECT CAST(current_value AS BIGINT) AS v FROM sys.sequences WHERE name = N'batch_code_seq'`)).recordset[0].v;
    expect(Number(cur)).toBe(8123);
  });
  it('names the column when the file has one the schema no longer has', async () => {
    await expect(applySettingsSql(pool, 'UPDATE idoc.settings SET gone_column = 1 WHERE settings_id = 1;')).rejects.toThrow(/"gone_column".*no longer has/);
  });
});
