import sql from 'mssql';
import { NotFoundError } from '../errors.js';
import type { RecipientQuery, RecipientResult, RecipientRow, RecipientStore, SearchScope } from './types.js';
import { containsPattern, referencePattern } from './validate.js';

const TREE = `
WITH tree (account_id) AS (
  SELECT account_id FROM idoc.account WHERE account_id = @scope
  UNION ALL
  SELECT a.account_id FROM idoc.account a JOIN tree t ON a.parent_account_id = t.account_id
)`;

/** The SQL behind recipient search. Every search starts from one account and walks down the tree, so it can never cover the whole system. */
export class MssqlRecipientStore implements RecipientStore {
  constructor(private readonly pool: sql.ConnectionPool) {}

  async scopes(): Promise<SearchScope[]> {
    const r = await this.pool.request().query(`
      WITH t (account_id, label, depth, is_customer) AS (
        SELECT account_id, CAST(name AS NVARCHAR(1000)), 0, CAST(1 AS BIT) FROM idoc.account WHERE parent_account_id IS NULL AND is_deleted = 0
        UNION ALL
        SELECT a.account_id, CAST(t.label + N' > ' + a.name AS NVARCHAR(1000)), t.depth + 1, CAST(1 - a.inherits_settings AS BIT)
        FROM idoc.account a JOIN t ON a.parent_account_id = t.account_id WHERE a.is_deleted = 0
      )
      SELECT account_id AS id, label, is_customer AS isCustomer FROM t ORDER BY label`);
    return r.recordset as SearchScope[];
  }

  async search(q: RecipientQuery): Promise<RecipientResult> {
    const label = (await this.scopes()).find((s) => s.id === q.accountId)?.label;
    if (label === undefined) throw new NotFoundError('That account does not exist.');

    const req = this.pool.request().input('scope', sql.Int, q.accountId).input('top', sql.Int, q.limit + 1);
    const where: string[] = [];
    if (q.name) {
      req.input('name', sql.NVarChar(400), containsPattern(q.name));
      where.push(`EXISTS (SELECT 1 FROM idoc.address_line l WHERE l.address_id = p.address_id AND l.line_no = 1 AND l.text LIKE @name ESCAPE N'\\')`);
    }
    if (q.address) {
      req.input('addr', sql.NVarChar(400), containsPattern(q.address));
      where.push(`(EXISTS (SELECT 1 FROM idoc.address_line l WHERE l.address_id = p.address_id AND l.line_no > 1 AND l.text LIKE @addr ESCAPE N'\\') OR ad.postcode LIKE @addr ESCAPE N'\\')`);
    }
    if (q.reference) {
      req.input('ref', sql.NVarChar(400), referencePattern(q.reference));
      let keyTest = '';
      if (q.referenceKey) { req.input('refKey', sql.NVarChar(100), q.referenceKey); keyTest = ' AND k.name = @refKey'; }
      where.push(`EXISTS (SELECT 1 FROM idoc.pack_passthrough pp
                          JOIN idoc.passthrough_value v ON v.passthrough_value_id = pp.passthrough_value_id
                          JOIN idoc.passthrough_key k ON k.passthrough_key_id = pp.passthrough_key_id
                          WHERE pp.pack_id = p.pack_id AND v.value LIKE @ref ESCAPE N'\\'${keyTest})`);
    }
    if (q.from) { req.input('from', sql.Date, q.from); where.push('p.release_date >= @from'); }
    if (q.to) { req.input('to', sql.Date, q.to); where.push('p.release_date < DATEADD(DAY, 1, @to)'); }

    const found = (await req.query(`${TREE}
      SELECT TOP (@top) p.pack_id, p.mailpiece_id, b.batch_code, b.current_status AS batch_status, j.base_name AS job,
             CONVERT(NVARCHAR(19), p.release_date, 126) AS release_date, ad.postcode,
             COALESCE(m.submitting_account_code, sa.account_code) AS account_code,
             COALESCE(m.submitting_account_name, sa.name) AS account_name,
             COALESCE(m.submitting_account_path, sa.name) AS account_path,
             m.invoicing_account_code, m.invoicing_account_name, COALESCE(m.brand_name, br.name) AS brand
      FROM idoc.pack p
      JOIN tree ON tree.account_id = p.submitting_account_id
      JOIN idoc.account sa ON sa.account_id = p.submitting_account_id
      JOIN idoc.job j ON j.job_id = p.job_id
      JOIN idoc.address ad ON ad.address_id = p.address_id
      LEFT JOIN idoc.mailpiece m ON m.mailpiece_id = p.mailpiece_id
      LEFT JOIN idoc.batch b ON b.batch_id = m.batch_id
      LEFT JOIN idoc.brand br ON br.brand_id = p.brand_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY p.release_date DESC, p.pack_id DESC`)).recordset as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any

    const truncated = found.length > q.limit;
    const page = found.slice(0, q.limit);
    const lines = new Map<number, string[]>();
    const refs = new Map<number, Record<string, string>>();
    if (page.length) {
      const ids = page.map((r) => Number(r['pack_id']));
      const inList = (r: sql.Request): string => ids.map((id, i) => { r.input(`p${i}`, sql.BigInt, id); return `@p${i}`; }).join(',');
      const r1 = this.pool.request();
      for (const l of (await r1.query(`SELECT p.pack_id, l.text FROM idoc.pack p JOIN idoc.address_line l ON l.address_id = p.address_id
                                       WHERE p.pack_id IN (${inList(r1)}) ORDER BY p.pack_id, l.line_no`)).recordset as { pack_id: number; text: string }[]) {
        (lines.get(Number(l.pack_id)) ?? lines.set(Number(l.pack_id), []).get(Number(l.pack_id))!).push(l.text);
      }
      const r2 = this.pool.request();
      for (const x of (await r2.query(`SELECT pp.pack_id, k.name AS [key], v.value FROM idoc.pack_passthrough pp
                                       JOIN idoc.passthrough_key k ON k.passthrough_key_id = pp.passthrough_key_id
                                       JOIN idoc.passthrough_value v ON v.passthrough_value_id = pp.passthrough_value_id
                                       WHERE pp.pack_id IN (${inList(r2)})`)).recordset as { pack_id: number; key: string; value: string }[]) {
        (refs.get(Number(x.pack_id)) ?? refs.set(Number(x.pack_id), {}).get(Number(x.pack_id))!)[x.key] = x.value;
      }
    }
    const rows: RecipientRow[] = page.map((r) => ({
      packId: Number(r['pack_id']), mailpieceId: r['mailpiece_id'] == null ? null : Number(r['mailpiece_id']),
      batchCode: r['batch_code'] == null ? null : Number(r['batch_code']), batchStatus: r['batch_status'] ?? null,
      job: r['job'], releaseDate: r['release_date'], addressLines: lines.get(Number(r['pack_id'])) ?? [], postcode: r['postcode'],
      accountCode: r['account_code'], accountName: r['account_name'], accountPath: r['account_path'],
      invoicingCode: r['invoicing_account_code'] ?? null, invoicingName: r['invoicing_account_name'] ?? null, brand: r['brand'] ?? null,
      references: refs.get(Number(r['pack_id'])) ?? {},
    }));
    return { scope: { id: q.accountId, label }, rows, truncated };
  }
}
