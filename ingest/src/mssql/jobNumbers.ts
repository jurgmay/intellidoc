import type sql from 'mssql';

/**
 * Pending job numbers: a customer can be given next month's job number in advance. On its start date (the 1st of a month,
 * London time) it replaces the job number and is cleared. This is safe to call as often as you like and from several places
 * (the watcher every minute, the run sheet command before it reads job numbers, the API on a timer): it only touches rows that are due.
 * Each move is written to idoc.audit_log so it shows on the customer's History tab. Returns how many customers moved.
 */
export async function applyDuePendingJobNumbers(pool: sql.ConnectionPool): Promise<number> {
  const r = await pool.request().query(`
    SET XACT_ABORT ON;
    BEGIN TRAN;
    DECLARE @moved TABLE (account_id INT, old_job NVARCHAR(50), new_job NVARCHAR(50));
    UPDATE idoc.account
       SET mis_job_number = pending_mis_job_number, pending_mis_job_number = NULL, pending_job_number_from = NULL
    OUTPUT inserted.account_id, deleted.mis_job_number, inserted.mis_job_number INTO @moved (account_id, old_job, new_job)
     WHERE pending_mis_job_number IS NOT NULL
       AND pending_job_number_from <= CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'GMT Standard Time' AS DATE);
    INSERT INTO idoc.audit_log (changed_by, entity, entity_id, summary)
    SELECT N'system', N'customer', account_id,
           CONCAT(N'Job number: ', COALESCE(N'"' + old_job + N'"', N'(none)'), N' → "', new_job, N'" (the pending job number took effect)')
      FROM @moved;
    SELECT COUNT(*) AS moved FROM @moved;
    COMMIT;`);
  return Number(r.recordset[0].moved);
}
