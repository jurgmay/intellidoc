import sql from 'mssql';
import { NotFoundError } from '../errors.js';
import type { JobBatch, JobDetail, JobQuery, JobRow, JobStatus, JobStore } from './types.js';

type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const like = (s: string): string => `%${s.replace(/[\\%_[]/g, (c) => `\\${c}`)}%`;

const ROW = `j.job_id, a.account_code, a.name AS account_name, j.base_name, j.pdf_file_name, j.export_date, j.status, j.pack_count, j.page_count, j.pdf_error,
  (SELECT COUNT(*) FROM idoc.batch b WHERE b.job_id = j.job_id) AS batch_count,
  (SELECT COUNT(*) FROM idoc.batch b WHERE b.job_id = j.job_id AND EXISTS (SELECT 1 FROM idoc.batch_file f WHERE f.batch_id = b.batch_id)) AS composed_count
  FROM idoc.job AS j INNER JOIN idoc.account AS a ON a.account_id = j.account_id`;

function row(r: R): JobRow {
  return {
    id: Number(r['job_id']), customerCode: r['account_code'], customerName: r['account_name'], baseName: r['base_name'], pdfFileName: r['pdf_file_name'],
    receivedAt: (r['export_date'] as Date).toISOString(), status: r['status'] as JobStatus, packCount: r['pack_count'] ?? null, pageCount: r['page_count'] ?? null, pdfError: r['pdf_error'] ?? null,
    batchCount: r['batch_count'], composedBatchCount: r['composed_count'],
  };
}

export class MssqlJobStore implements JobStore {
  constructor(private readonly pool: sql.ConnectionPool) {}

  async list(q: JobQuery): Promise<JobRow[]> {
    const rs = await this.pool.request().input('n', sql.Int, q.limit).input('q', sql.NVarChar(210), q.search ? like(q.search) : null).input('s', sql.NVarChar(30), q.status)
      .query(`SELECT TOP (@n) ${ROW}
              WHERE (@s IS NULL OR j.status = @s)
                AND (@q IS NULL OR a.account_code LIKE @q ESCAPE N'\\' OR a.name LIKE @q ESCAPE N'\\' OR j.base_name LIKE @q ESCAPE N'\\')
              ORDER BY j.job_id DESC`);
    return (rs.recordset as R[]).map(row);
  }

  async get(id: number): Promise<JobDetail> {
    const [j, b, f] = await Promise.all([
      this.pool.request().input('id', sql.BigInt, id).query(`SELECT ${ROW} WHERE j.job_id = @id`),
      this.pool.request().input('id', sql.BigInt, id).query('SELECT batch_id, batch_code, current_status, mailpiece_count FROM idoc.batch WHERE job_id = @id ORDER BY batch_code'),
      this.pool.request().input('id', sql.BigInt, id).query(`SELECT f.batch_id, f.segment_number, f.file_name, f.mailpiece_count, f.page_count FROM idoc.batch_file AS f
                                                              INNER JOIN idoc.batch AS b ON b.batch_id = f.batch_id WHERE b.job_id = @id ORDER BY f.batch_id, f.segment_number`),
    ]);
    const r = j.recordset[0] as R | undefined;
    if (!r) throw new NotFoundError('Job not found');
    const batches: JobBatch[] = (b.recordset as R[]).map((x) => ({
      id: Number(x['batch_id']), batchCode: Number(x['batch_code']), status: x['current_status'], mailpieceCount: x['mailpiece_count'],
      files: (f.recordset as R[]).filter((y) => String(y['batch_id']) === String(x['batch_id'])).map((y) => ({ fileName: y['file_name'], segment: y['segment_number'], mailpieces: y['mailpiece_count'], pages: y['page_count'] })),
    }));
    return { ...row(r), batches };
  }
}
