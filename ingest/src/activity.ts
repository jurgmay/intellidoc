import sql from 'mssql';

/** Told how far a long step has got: how many of how many (total null when not known) and what it is doing. */
export type Progress = (done: number, total: number | null, detail: string) => void;

export type ActivityKind = 'Import' | 'PDF check' | 'Print files';
export type ActivityState = 'Running' | 'Done' | 'Failed' | 'Abandoned';

/** Where progress goes. The real one writes idoc.activity; the Activity screen reads it. */
export interface ActivityLog {
  /** `meta.bytes` is the size of the file the work is about; `withPdf` says a PDF is read as part of it. Both feed the queue's time estimate. */
  start(kind: ActivityKind, label: string, jobId?: number | null, total?: number | null, meta?: { bytes?: number | null; withPdf?: boolean }): Promise<number | null>;
  step(id: number | null, done: number, total: number | null, detail: string): Promise<void>;
  finish(id: number | null, state: 'Done' | 'Failed', detail?: string): Promise<void>;
  /** Forget a row that turned out to be nothing (e.g. a lone PDF no job was waiting for). */
  drop(id: number | null): Promise<void>;
}

/** Records nothing (the default when no database is wanted for it). */
export const noActivity: ActivityLog = { start: async () => null, step: async () => undefined, finish: async () => undefined, drop: async () => undefined };

/**
 * Writes progress to idoc.activity. It never throws and never waits for long: progress is a convenience, so a failure to record it (the database
 * is busy, the table is missing in an old database) must not stop the work it describes. Errors go to `onError` once per run of failures.
 */
export class DbActivity implements ActivityLog {
  private failing = false;
  constructor(private readonly pool: sql.ConnectionPool, private readonly onError: (message: string) => void = () => undefined) {}
  private async safely<T>(f: () => Promise<T>, fallback: T): Promise<T> {
    try { const r = await f(); this.failing = false; return r; }
    catch (e) { if (!this.failing) this.onError(`Could not record progress: ${(e as Error).message}`); this.failing = true; return fallback; }
  }
  start(kind: ActivityKind, label: string, jobId: number | null = null, total: number | null = null, meta: { bytes?: number | null; withPdf?: boolean } = {}): Promise<number | null> {
    return this.safely(async () => (await this.pool.request().input('k', sql.NVarChar(20), kind).input('l', sql.NVarChar(300), label.slice(0, 300)).input('j', sql.BigInt, jobId).input('t', sql.Int, total)
      .input('b', sql.BigInt, meta.bytes ?? null).input('w', sql.Bit, meta.withPdf ?? false)
      .query<{ id: number }>(`INSERT INTO idoc.activity (kind, label, job_id, state, step_done, step_total, bytes, with_pdf) OUTPUT INSERTED.activity_id AS id VALUES (@k, @l, @j, N'Running', 0, @t, @b, @w)`)).recordset[0]!.id, null);
  }
  async step(id: number | null, done: number, total: number | null, detail: string): Promise<void> {
    if (id === null) return;
    await this.safely(() => this.pool.request().input('i', sql.BigInt, id).input('d', sql.Int, done).input('t', sql.Int, total).input('x', sql.NVarChar(500), detail.slice(0, 500))
      .query('UPDATE idoc.activity SET step_done = @d, step_total = @t, detail = @x, updated_at = SYSUTCDATETIME() WHERE activity_id = @i'), undefined);
  }
  async finish(id: number | null, state: 'Done' | 'Failed', detail?: string): Promise<void> {
    if (id === null) return;
    await this.safely(() => this.pool.request().input('i', sql.BigInt, id).input('s', sql.NVarChar(20), state).input('x', sql.NVarChar(500), detail?.slice(0, 500) ?? null)
      .query('UPDATE idoc.activity SET state = @s, detail = COALESCE(@x, detail), finished_at = SYSUTCDATETIME(), updated_at = SYSUTCDATETIME() WHERE activity_id = @i'), undefined);
  }
  async drop(id: number | null): Promise<void> {
    if (id === null) return;
    await this.safely(() => this.pool.request().input('i', sql.BigInt, id).query('DELETE FROM idoc.activity WHERE activity_id = @i'), undefined);
  }
  /** At start-up: anything Running that has not moved for 10 minutes was left by a program that stopped, and old finished rows are cleared. */
  async tidy(keepDays = 7): Promise<void> {
    await this.safely(() => this.pool.request().input('d', sql.Int, keepDays).query(`
      UPDATE idoc.activity SET state = N'Abandoned', finished_at = SYSUTCDATETIME() WHERE state = N'Running' AND updated_at < DATEADD(MINUTE, -10, SYSUTCDATETIME());
      DELETE FROM idoc.activity WHERE state <> N'Running' AND COALESCE(finished_at, updated_at) < DATEADD(DAY, -@d, SYSUTCDATETIME());`), undefined);
  }
}
