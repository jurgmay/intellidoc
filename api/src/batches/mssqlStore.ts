import sql from 'mssql';
import { NotFoundError } from '../errors.js';
import { TREE } from '../recipients/mssqlStore.js';
import { escapeLike } from '../recipients/validate.js';
import type { BatchQuery, BatchResult, BatchRow, BatchStore } from './types.js';

const LONDON = `AT TIME ZONE N'UTC' AT TIME ZONE N'GMT Standard Time'`;

/**
 * The SQL behind the batch search. A batch is found when at least one of its mailpieces was submitted from the chosen account or below it (a batch can
 * hold mailpieces of several sub-accounts), and its figures are those of the mailpieces the scope covers.
 */
export class MssqlBatchStore implements BatchStore {
  constructor(private readonly pool: sql.ConnectionPool) {}

  async search(q: BatchQuery): Promise<BatchResult> {
    const label = ((await this.pool.request().input('a', sql.Int, q.accountId).query(`
      WITH t (account_id, label) AS (
        SELECT account_id, CAST(name AS NVARCHAR(1000)) FROM idoc.account WHERE parent_account_id IS NULL AND is_deleted = 0
        UNION ALL SELECT a.account_id, CAST(t.label + N' > ' + a.name AS NVARCHAR(1000)) FROM idoc.account a JOIN t ON a.parent_account_id = t.account_id WHERE a.is_deleted = 0)
      SELECT label FROM t WHERE account_id = @a`)).recordset[0] as { label: string } | undefined)?.label;
    if (label === undefined) throw new NotFoundError('That account does not exist.');

    const req = this.pool.request().input('scope', sql.Int, q.accountId).input('top', sql.Int, q.limit + 1);
    const where: string[] = ['s.in_scope > 0'];
    if (q.code !== null) { req.input('code', sql.BigInt, q.code); where.push('b.batch_code = @code'); }
    if (q.status) { req.input('status', sql.NVarChar(30), q.status); where.push('b.current_status = @status'); }
    if (q.job) { req.input('job', sql.NVarChar(400), `%${escapeLike(q.job)}%`); where.push(`j.base_name LIKE @job ESCAPE N'\\'`); }
    if (q.from) { req.input('from', sql.Date, q.from); where.push(`CAST(b.created_at ${LONDON} AS DATE) >= @from`); }
    if (q.to) { req.input('to', sql.Date, q.to); where.push(`CAST(b.created_at ${LONDON} AS DATE) <= @to`); }

    const found = (await req.query(`${TREE}
      SELECT TOP (@top) b.batch_id, b.batch_code, b.current_status, j.base_name AS job, CONVERT(NVARCHAR(19), CAST(b.created_at ${LONDON} AS DATETIME2(0)), 126) AS created_at,
             b.fulfilment_department AS department, pp.name + N' ' + ps.name + N' (' + pf.name + N')' AS service,
             si.stock_code AS envelope_code, si.description AS envelope_description, br.name AS brand, inv.account_code AS invoicing_code, inv.name AS invoicing_name,
             s.in_scope, s.in_batch, s.cancelled, s.packs, s.pages, s.sheets, s.sell, s.unpriced
      FROM idoc.batch b
      JOIN idoc.job j ON j.job_id = b.job_id
      JOIN idoc.account inv ON inv.account_id = b.invoicing_account_id
      JOIN idoc.postal_service ps ON ps.postal_service_id = b.postal_service_id
      JOIN idoc.postal_provider pp ON pp.postal_provider_id = ps.postal_provider_id
      JOIN idoc.postal_format pf ON pf.postal_format_id = b.postal_format_id
      JOIN idoc.stock_item si ON si.stock_item_id = b.outer_stock_item_id
      LEFT JOIN idoc.brand br ON br.brand_id = b.brand_id
      CROSS APPLY (
        SELECT SUM(CASE WHEN m.is_cancelled = 0 AND t.account_id IS NOT NULL THEN 1 ELSE 0 END) AS in_scope,
               SUM(CASE WHEN m.is_cancelled = 0 THEN 1 ELSE 0 END) AS in_batch,
               SUM(CASE WHEN m.is_cancelled = 1 AND t.account_id IS NOT NULL THEN 1 ELSE 0 END) AS cancelled,
               SUM(CASE WHEN m.is_cancelled = 0 AND t.account_id IS NOT NULL THEN m.pack_count ELSE 0 END) AS packs,
               SUM(CASE WHEN m.is_cancelled = 0 AND t.account_id IS NOT NULL THEN m.page_count ELSE 0 END) AS pages,
               SUM(CASE WHEN m.is_cancelled = 0 AND t.account_id IS NOT NULL THEN m.sheet_count ELSE 0 END) AS sheets,
               SUM(CASE WHEN m.is_cancelled = 0 AND t.account_id IS NOT NULL AND m.priced_at IS NOT NULL THEN m.production_sell + m.postage_sell ELSE 0 END) AS sell,
               SUM(CASE WHEN m.is_cancelled = 0 AND t.account_id IS NOT NULL AND m.priced_at IS NULL THEN 1 ELSE 0 END) AS unpriced
        FROM idoc.mailpiece m LEFT JOIN tree t ON t.account_id = m.submitting_account_id
        WHERE m.batch_id = b.batch_id) s
      WHERE ${where.join(' AND ')}
      ORDER BY b.created_at DESC, b.batch_id DESC`)).recordset as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any

    const n = (v: unknown): number => (v == null ? 0 : Number(v));
    const rows: BatchRow[] = found.slice(0, q.limit).map((r) => ({
      batchId: Number(r['batch_id']), batchCode: Number(r['batch_code']), status: r['current_status'], job: r['job'], createdAt: r['created_at'], department: r['department'],
      service: r['service'], envelope: `${r['envelope_code'] ?? ''} ${r['envelope_description']}`.trim(), brand: r['brand'] ?? null, invoicingCode: r['invoicing_code'], invoicingName: r['invoicing_name'],
      mailpieces: n(r['in_scope']), mailpiecesInBatch: n(r['in_batch']), cancelled: n(r['cancelled']), packs: n(r['packs']), pages: n(r['pages']), sheets: n(r['sheets']),
      priceSell: Math.round(n(r['sell']) * 1e4) / 1e4, unpriced: n(r['unpriced']),
    }));
    return { scope: { id: q.accountId, label }, rows, truncated: found.length > q.limit };
  }
}
