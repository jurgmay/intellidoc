import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type sql from 'mssql';
import { connect, hasDb, resetAndSeed } from './setup.js';
import { applyDuePendingJobNumbers } from '../../src/mssql/jobNumbers.js';

/** Runs against INTELLIDOC_TEST_DB (it DROPS and recreates the idoc schema). */
describe.skipIf(!hasDb)('applyDuePendingJobNumbers', { timeout: 120_000 }, () => {
  let pool: sql.ConnectionPool;
  beforeAll(async () => { pool = await connect(); await resetAndSeed(pool); });
  afterAll(async () => { await pool?.close(); });

  const set = (code: string, job: string | null, pending: string | null, from: string | null) =>
    pool.request().input('c', code).input('j', job).input('p', pending).input('f', from)
      .query('UPDATE idoc.account SET mis_job_number = @j, pending_mis_job_number = @p, pending_job_number_from = CAST(@f AS DATE) WHERE account_code = @c');
  const read = async (code: string) => (await pool.request().input('c', code)
    .query('SELECT mis_job_number AS j, pending_mis_job_number AS p, pending_job_number_from AS f FROM idoc.account WHERE account_code = @c')).recordset[0] as { j: string | null; p: string | null; f: Date | null };

  it('moves a due pending job number into the job number, clears it, and records it in the audit log', async () => {
    await set('FEXCO_CUSTOMER', '1000', '1001', '2020-01-01');
    expect(await applyDuePendingJobNumbers(pool)).toBe(1);
    expect(await read('FEXCO_CUSTOMER')).toEqual({ j: '1001', p: null, f: null });
    const log = (await pool.request().query(`SELECT changed_by, summary FROM idoc.audit_log WHERE entity = N'customer' ORDER BY audit_id DESC`)).recordset[0];
    expect(log).toEqual({ changed_by: 'system', summary: 'Job number: "1000" → "1001" (the pending job number took effect)' });
  });

  it('leaves a pending job number that is not due yet, and does nothing twice', async () => {
    await set('NATIONAL_GRID_PSR', '2000', '2001', '2999-01-01');
    expect(await applyDuePendingJobNumbers(pool)).toBe(0);
    expect(await read('NATIONAL_GRID_PSR')).toMatchObject({ j: '2000', p: '2001' });
    await set('FEXCO_CUSTOMER', '1001', null, null);
    expect(await applyDuePendingJobNumbers(pool)).toBe(0);
  });

  it('works when the customer had no job number before', async () => {
    await set('FEXCO_CUSTOMER', null, '3000', '2020-01-01');
    expect(await applyDuePendingJobNumbers(pool)).toBe(1);
    expect((await pool.request().query(`SELECT TOP 1 summary FROM idoc.audit_log ORDER BY audit_id DESC`)).recordset[0].summary).toBe('Job number: (none) → "3000" (the pending job number took effect)');
  });

  it('the database refuses a pending number without a start date, or a date without a number', async () => {
    await expect(set('FEXCO_CUSTOMER', null, '4000', null)).rejects.toThrow(/ck_account_pending/);
    await expect(set('FEXCO_CUSTOMER', null, null, '2030-01-01')).rejects.toThrow(/ck_account_pending/);
  });
});
