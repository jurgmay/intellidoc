import sql from 'mssql';
import { STALLED_AFTER_MS, type ActivityRow, type ActivityStore } from './types.js';

type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const iso = (d: Date): string => d.toISOString();
function row(r: R, now = Date.now()): ActivityRow {
  return { id: Number(r['activity_id']), kind: r['kind'], label: r['label'], jobId: r['job_id'] === null ? null : Number(r['job_id']), state: r['state'], detail: r['detail'] ?? null,
    done: r['step_done'] ?? null, total: r['step_total'] ?? null, startedAt: iso(r['started_at']), updatedAt: iso(r['updated_at']), finishedAt: r['finished_at'] ? iso(r['finished_at']) : null,
    bytes: r['bytes'] === null || r['bytes'] === undefined ? null : Number(r['bytes']), withPdf: !!r['with_pdf'],
    stalled: r['state'] === 'Running' && now - (r['updated_at'] as Date).getTime() > STALLED_AFTER_MS };
}
const COLS = 'activity_id, kind, label, job_id, state, detail, step_done, step_total, bytes, with_pdf, started_at, updated_at, finished_at';

export class MssqlActivityStore implements ActivityStore {
  constructor(private readonly pool: sql.ConnectionPool) {}
  async running(): Promise<ActivityRow[]> {
    return ((await this.pool.request().query(`SELECT ${COLS} FROM idoc.activity WHERE state = N'Running' ORDER BY activity_id`)).recordset as R[]).map((r) => row(r));
  }
  async get(id: number): Promise<ActivityRow | null> {
    const rs = (await this.pool.request().input('i', sql.BigInt, id).query(`SELECT ${COLS} FROM idoc.activity WHERE activity_id = @i`)).recordset as R[];
    return rs[0] ? row(rs[0]) : null;
  }
  async dismiss(id: number): Promise<void> {
    await this.pool.request().input('i', sql.BigInt, id).query(`UPDATE idoc.activity SET state = N'Abandoned', updated_at = SYSUTCDATETIME() WHERE activity_id = @i AND state = N'Failed'`);
  }
  async recent(limit: number): Promise<ActivityRow[]> {
    return ((await this.pool.request().input('n', sql.Int, limit).query(`SELECT TOP (@n) ${COLS} FROM idoc.activity WHERE state <> N'Running' ORDER BY activity_id DESC`)).recordset as R[]).map((r) => row(r));
  }
}
