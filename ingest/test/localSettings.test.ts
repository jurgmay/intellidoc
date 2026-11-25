import { describe, expect, it } from 'vitest';
import { settingsSql, sqlLiteral } from '../src/localSettings.js';

describe('local settings file', () => {
  it('writes numbers, bits, text and nulls as T-SQL literals, doubling quotes', () => {
    expect(sqlLiteral(5.625)).toBe('5.625');
    expect(sqlLiteral(true)).toBe('1'); expect(sqlLiteral(false)).toBe('0');
    expect(sqlLiteral("ops@latcham.co.uk, o'neil@x.co.uk")).toBe("N'ops@latcham.co.uk, o''neil@x.co.uk'");
    expect(sqlLiteral(null)).toBe('NULL');
    expect(() => sqlLiteral(NaN)).toThrow(); expect(() => sqlLiteral(new Date())).toThrow();
  });
  it('is one UPDATE of every column but settings_id, in column order, with a header saying how to use it', () => {
    const text = settingsSql({ settings_id: 1, a4_sheet_weight_g: 5.625, auto_compose: false, alert_recipients: 'a@b.co', page_width_mm: 210 }, new Date('2026-11-23T15:20:00Z'));
    expect(text).toContain('-- Written by `npm run settings:export` on 2026-11-23 15:20 UTC');
    expect(text).toContain('npm run db:rebuild');
    expect(text.slice(text.indexOf('UPDATE'))).toBe("UPDATE idoc.settings SET\n    a4_sheet_weight_g = 5.625,\n    auto_compose = 0,\n    alert_recipients = N'a@b.co',\n    page_width_mm = 210\nWHERE settings_id = 1;\n");
  });
  it('can also set the next batch code, in a line of its own that can be edited by hand', () => {
    const text = settingsSql({ settings_id: 1, page_width_mm: 210 }, new Date('2026-11-23T15:20:00Z'), 8001);
    expect(text).toContain('WHERE settings_id = 1;\n\n-- The next batch code.');
    expect(text.trimEnd().endsWith('ALTER SEQUENCE idoc.batch_code_seq RESTART WITH 8001;')).toBe(true);
  });
  it('refuses a row with nothing to set', () => { expect(() => settingsSql({ settings_id: 1 })).toThrow(/no columns/); });
});
