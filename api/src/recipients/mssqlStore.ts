import sql from 'mssql';
import { NotFoundError } from '../errors.js';
import type { MailpiecePrice, RecipientPack, RecipientQuery, RecipientResult, RecipientRow, RecipientStore, SearchScope } from './types.js';
import { containsPattern, referencePattern } from './validate.js';

/** `pack.document_sequence` for a pack that the customer's sequence rules do not list. */
const UNLISTED = 99;

export const TREE = `
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

    const req = this.pool.request().input('scope', sql.Int, q.accountId).input('top', sql.Int, q.limit + 1).input('skip', sql.Int, q.offset);
    // The name and address are the mailpiece's (every pack in it has the same address). A reference or a date matches when one of its packs has it.
    const where: string[] = [];
    const ofPack: string[] = [];
    if (q.name) {
      req.input('name', sql.NVarChar(400), containsPattern(q.name));
      where.push(`EXISTS (SELECT 1 FROM idoc.address_line l WHERE l.address_id = m.address_id AND l.line_no = 1 AND l.text LIKE @name ESCAPE N'\\')`);
    }
    if (q.address) {
      req.input('addr', sql.NVarChar(400), containsPattern(q.address));
      where.push(`(EXISTS (SELECT 1 FROM idoc.address_line l WHERE l.address_id = m.address_id AND l.line_no > 1 AND l.text LIKE @addr ESCAPE N'\\') OR ad.postcode LIKE @addr ESCAPE N'\\')`);
    }
    if (q.reference) {
      req.input('ref', sql.NVarChar(400), referencePattern(q.reference));
      let keyTest = '';
      if (q.referenceKey) { req.input('refKey', sql.NVarChar(100), q.referenceKey); keyTest = ' AND k.name = @refKey'; }
      ofPack.push(`EXISTS (SELECT 1 FROM idoc.pack_passthrough pp
                          JOIN idoc.passthrough_value v ON v.passthrough_value_id = pp.passthrough_value_id
                          JOIN idoc.passthrough_key k ON k.passthrough_key_id = pp.passthrough_key_id
                          WHERE pp.pack_id = p.pack_id AND v.value LIKE @ref ESCAPE N'\\'${keyTest})`);
    }
    if (q.packGuid) { req.input('packGuid', sql.UniqueIdentifier, q.packGuid); ofPack.push('p.pack_guid = @packGuid'); }
    if (q.jobGuid) { req.input('jobGuid', sql.UniqueIdentifier, q.jobGuid); ofPack.push('EXISTS (SELECT 1 FROM idoc.source sc WHERE sc.source_id = p.source_id AND sc.source_guid = @jobGuid)'); }
    if (q.from) { req.input('from', sql.Date, q.from); ofPack.push('p.release_date >= @from'); }
    if (q.to) { req.input('to', sql.Date, q.to); ofPack.push('p.release_date < DATEADD(DAY, 1, @to)'); }
    if (q.batchId !== null) { req.input('batch', sql.BigInt, q.batchId); where.push('m.batch_id = @batch'); }
    if (ofPack.length) where.push(`EXISTS (SELECT 1 FROM idoc.pack p WHERE p.mailpiece_id = m.mailpiece_id AND ${ofPack.join(' AND ')})`);

    const found = (await req.query(`${TREE}
      SELECT m.mailpiece_id, m.sequence_number, b.batch_code, b.current_status AS batch_status, j.base_name AS job,
             CONVERT(NVARCHAR(19), rel.release_date, 126) AS release_date, ad.postcode, m.is_cancelled,
             m.submitting_account_code AS account_code, m.submitting_account_name AS account_name, m.submitting_account_path AS account_path,
             m.invoicing_account_code, m.invoicing_account_name, COALESCE(m.brand_name, br.name) AS brand,
             CASE WHEN m.priced_at IS NULL THEN NULL ELSE m.production_sell + m.postage_sell END AS price_sell
      FROM idoc.mailpiece m
      JOIN tree ON tree.account_id = m.submitting_account_id
      JOIN idoc.job j ON j.job_id = m.job_id
      JOIN idoc.address ad ON ad.address_id = m.address_id
      LEFT JOIN idoc.batch b ON b.batch_id = m.batch_id
      LEFT JOIN idoc.brand br ON br.brand_id = m.brand_id
      CROSS APPLY (SELECT MAX(p.release_date) AS release_date FROM idoc.pack p WHERE p.mailpiece_id = m.mailpiece_id) rel
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${q.batchId !== null ? 'CASE WHEN m.sequence_number IS NULL THEN 1 ELSE 0 END, m.sequence_number, m.mailpiece_id' : 'rel.release_date DESC, m.mailpiece_id DESC'}
      OFFSET @skip ROWS FETCH NEXT @top ROWS ONLY`)).recordset as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any

    const truncated = found.length > q.limit;
    const page = found.slice(0, q.limit);
    const lines = new Map<number, string[]>();
    const packs = new Map<number, RecipientPack[]>();
    const refs = new Map<number, Record<string, string>>();
    if (page.length) {
      const ids = page.map((r) => Number(r['mailpiece_id']));
      const inList = (r: sql.Request): string => ids.map((id, i) => { r.input(`m${i}`, sql.BigInt, id); return `@m${i}`; }).join(',');
      const r1 = this.pool.request();
      for (const l of (await r1.query(`SELECT m.mailpiece_id, l.text FROM idoc.mailpiece m JOIN idoc.address_line l ON l.address_id = m.address_id
                                       WHERE m.mailpiece_id IN (${inList(r1)}) ORDER BY m.mailpiece_id, l.line_no`)).recordset as { mailpiece_id: number; text: string }[]) {
        (lines.get(Number(l.mailpiece_id)) ?? lines.set(Number(l.mailpiece_id), []).get(Number(l.mailpiece_id))!).push(l.text);
      }
      const r2 = this.pool.request();
      for (const x of (await r2.query(`SELECT pp.pack_id, k.name AS [key], v.value FROM idoc.pack p
                                       JOIN idoc.pack_passthrough pp ON pp.pack_id = p.pack_id
                                       JOIN idoc.passthrough_key k ON k.passthrough_key_id = pp.passthrough_key_id
                                       JOIN idoc.passthrough_value v ON v.passthrough_value_id = pp.passthrough_value_id
                                       WHERE p.mailpiece_id IN (${inList(r2)}) ORDER BY pp.pack_id, k.name`)).recordset as { pack_id: number; key: string; value: string }[]) {
        (refs.get(Number(x.pack_id)) ?? refs.set(Number(x.pack_id), {}).get(Number(x.pack_id))!)[x.key] = x.value;
      }
      // the order the packs go into the envelope: the customer's pack sequence, then the order in the PDF (as the composer does)
      const r3 = this.pool.request();
      for (const k of (await r3.query(`SELECT p.mailpiece_id, p.pack_id, LOWER(CONVERT(CHAR(36), p.pack_guid)) AS pack_guid, LOWER(CONVERT(CHAR(36), sc.source_guid)) AS job_guid, p.document_sequence, p.start_page, p.page_count, CONVERT(NVARCHAR(19), p.release_date, 126) AS release_date
                                       FROM idoc.pack p JOIN idoc.source sc ON sc.source_id = p.source_id WHERE p.mailpiece_id IN (${inList(r3)}) ORDER BY p.mailpiece_id, p.document_sequence, p.start_page, p.pack_id`)).recordset as Record<string, any>[]) { // eslint-disable-line @typescript-eslint/no-explicit-any
        const list = packs.get(Number(k['mailpiece_id'])) ?? packs.set(Number(k['mailpiece_id']), []).get(Number(k['mailpiece_id']))!;
        list.push({ packId: Number(k['pack_id']), packGuid: k['pack_guid'], jobGuid: k['job_guid'], position: list.length + 1, sequence: Number(k['document_sequence']) >= UNLISTED ? null : Number(k['document_sequence']),
          startPage: Number(k['start_page']), pageCount: Number(k['page_count']), releaseDate: k['release_date'], references: refs.get(Number(k['pack_id'])) ?? {} });
      }
    }
    const rows: RecipientRow[] = page.map((r) => {
      const id = Number(r['mailpiece_id']);
      return {
        mailpieceId: id, sequenceNumber: r['sequence_number'] == null ? null : Number(r['sequence_number']), batchCode: r['batch_code'] == null ? null : Number(r['batch_code']), batchStatus: r['batch_status'] ?? null,
        job: r['job'], releaseDate: r['release_date'], addressLines: lines.get(id) ?? [], postcode: r['postcode'], isCancelled: Boolean(r['is_cancelled']),
        accountCode: r['account_code'], accountName: r['account_name'], accountPath: r['account_path'],
        invoicingCode: r['invoicing_account_code'] ?? null, invoicingName: r['invoicing_account_name'] ?? null, brand: r['brand'] ?? null,
        priceSell: r['price_sell'] == null ? null : Number(r['price_sell']), packs: packs.get(id) ?? [],
      };
    });
    return { scope: { id: q.accountId, label }, rows, truncated };
  }

  async price(mailpieceId: number): Promise<MailpiecePrice> {
    const m = (await this.pool.request().input('m', sql.BigInt, mailpieceId).query(`
      SELECT m.mailpiece_id, m.account_id, m.is_cancelled, m.pack_count, m.priced_at, m.costing_model_id, cm.name AS model_name,
             m.production_cost, m.production_sell, m.postage_cost, m.postage_sell, m.price_warnings, b.batch_code,
             CONVERT(CHAR(10), CAST(m.created_at AT TIME ZONE N'UTC' AT TIME ZONE N'GMT Standard Time' AS DATE), 23) AS usage_day,
             CONVERT(NVARCHAR(19), m.priced_at, 126) AS priced_text,
             pk.unknown_packs, pk.colour, pk.mono, pk.blank,
             (SELECT TOP 1 1 FROM idoc.v_account_setting_source AS s
                INNER JOIN idoc.costing_model AS x ON x.account_id = s.source_account_id
                WHERE s.account_id = m.account_id AND s.setting = N'costing' AND x.is_active = 1
                  AND x.valid_from <= CAST(m.created_at AT TIME ZONE N'UTC' AT TIME ZONE N'GMT Standard Time' AS DATE)
                  AND (x.valid_to IS NULL OR x.valid_to >= CAST(m.created_at AT TIME ZONE N'UTC' AT TIME ZONE N'GMT Standard Time' AS DATE))) AS has_model
      FROM idoc.mailpiece AS m
      LEFT JOIN idoc.batch AS b ON b.batch_id = m.batch_id
      LEFT JOIN idoc.costing_model AS cm ON cm.costing_model_id = m.costing_model_id
      CROSS APPLY (SELECT SUM(CASE WHEN p.colour_pages IS NULL OR p.mono_pages IS NULL OR p.blank_pages IS NULL THEN 1 ELSE 0 END) AS unknown_packs,
                          SUM(COALESCE(p.colour_pages, 0)) AS colour, SUM(COALESCE(p.mono_pages, 0)) AS mono, SUM(COALESCE(p.blank_pages, 0)) AS blank
                   FROM idoc.pack AS p WHERE p.mailpiece_id = m.mailpiece_id) AS pk
      WHERE m.mailpiece_id = @m`)).recordset[0] as Record<string, any> | undefined; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!m) throw new NotFoundError('Mailpiece not found');
    const lines = (await this.pool.request().input('m', sql.BigInt, mailpieceId).query(
      `SELECT charge_code, label, quantity, unit_cost, unit_sell, cost, sell FROM idoc.mailpiece_price_line WHERE mailpiece_id = @m ORDER BY line_no`)).recordset as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
    const priced = m['priced_at'] != null;
    let reason: string | null = null;
    if (!priced) {
      if (m['is_cancelled']) reason = 'This mailpiece was cancelled.';
      else if (Number(m['unknown_packs']) > 0) reason = 'The colours of some of its pages are not known yet. The PDF has not been read, or could not be read.';
      else if (!m['has_model']) reason = `No costing model was in force for this customer on ${m['usage_day']}.`;
      else reason = 'It has not been priced yet.';
    }
    const n = (v: unknown): number => (v == null ? 0 : Number(v));
    const productionCost = n(m['production_cost']); const productionSell = n(m['production_sell']); const postageCost = n(m['postage_cost']); const postageSell = n(m['postage_sell']);
    const r4 = (x: number): number => Math.round(x * 1e4) / 1e4;
    return {
      mailpieceId, batchCode: m['batch_code'] == null ? null : Number(m['batch_code']), priced, reason, pricedAt: priced ? m['priced_text'] : null,
      model: m['costing_model_id'] == null ? null : { id: Number(m['costing_model_id']), name: m['model_name'] },
      packs: Number(m['pack_count']), colourPages: n(m['colour']), monoPages: n(m['mono']), blankPages: n(m['blank']),
      lines: lines.map((l) => ({ code: l['charge_code'], label: l['label'], quantity: Number(l['quantity']), unitCost: Number(l['unit_cost']), unitSell: Number(l['unit_sell']), cost: Number(l['cost']), sell: Number(l['sell']) })),
      productionCost, productionSell, postageCost, postageSell, totalCost: r4(productionCost + postageCost), totalSell: r4(productionSell + postageSell),
      warnings: m['price_warnings'] ?? null,
    };
  }
}
