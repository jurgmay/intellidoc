import sql from 'mssql';
import type { Sample } from './estimate.js';
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
  async samples(limit: number): Promise<Sample[]> {
    const rs = await this.pool.request().input('n', sql.Int, limit).query(`SELECT TOP (@n) with_pdf, bytes, DATEDIFF(SECOND, started_at, finished_at) AS seconds FROM idoc.activity
      WHERE state = N'Done' AND kind IN (N'Import', N'PDF check') AND finished_at IS NOT NULL AND (bytes > 0 OR with_pdf = 0) ORDER BY activity_id DESC`);
    return (rs.recordset as R[]).map((r) => ({ withPdf: !!r['with_pdf'], bytes: Number(r['bytes'] ?? 0), seconds: Number(r['seconds']) }));
  }
  constructor(private readonly pool: sql.ConnectionPool) {}
  async running(): Promise<ActivityRow[]> {
    return ((await this.pool.request().query(`SELECT ${COLS} FROM idoc.activity WHERE state = N'Running' ORDER BY activity_id`)).recordset as R[]).map((r) => row(r));
  }
  async recent(limit: number): Promise<ActivityRow[]> {
    return ((await this.pool.request().input('n', sql.Int, limit).query(`SELECT TOP (@n) ${COLS} FROM idoc.activity WHERE state <> N'Running' ORDER BY activity_id DESC`)).recordset as R[]).map((r) => row(r));
  }
}
