import sql from 'mssql';
import { findCostingModel } from './costing.js';
import { priceMailpiece } from '../costing/calculate.js';
import type { CostingModel } from '../costing/types.js';
import { composedPages, paddingPages, type ColourMode, type PackPages } from '../costing/colour.js';

interface Row {
  mailpiece_id: number; account_id: number; usage_day: string; is_cancelled: boolean;
  pack_count: number; sheet_count: number; unknown_packs: number; packs_json: string | null; colour_mode: ColourMode; inserts: number;
  department: string; batch_mailpieces: number; format_name: string | null; outer_stock_item_id: number;
  is_oversticker: boolean; is_address_matching: boolean;
  rate_id: number | null; rate_cost: number | null; rate_sell: number | null;
}

export interface PriceJobResult { priced: number; noModel: number; unknownColours: number }

/** Which mailpieces to price: either a job's, or a customer's (and everything below it) between two production days. */
export type PriceFilter = { jobId: number } | { accountId: number; from: string | null; to: string | null; onlyUnpriced: boolean };

/**
 * Prices every mailpiece of a job and stores the totals and the lines on the mailpiece. The costing model is the one in force on the
 * mailpiece's production day (the UK day it was created) for its customer. Safe to run again: a mailpiece's lines are replaced.
 * A mailpiece is left alone when there is no model, or when the colours of any of its pages are not known.
 */
export async function priceJob(pool: sql.ConnectionPool, jobId: number): Promise<PriceJobResult> {
  return priceMailpieces(pool, { jobId }, false);
}

const DAY = `CAST(m.created_at AT TIME ZONE N'UTC' AT TIME ZONE N'GMT Standard Time' AS DATE)`;

/**
 * The work behind priceJob and the re-price screen. With dryRun nothing is written and the result says what a real run would do.
 * For a customer filter the account and every account below it are covered (by the sub-account that submitted the mail), never the whole system.
 */
export async function priceMailpieces(pool: sql.ConnectionPool, filter: PriceFilter, dryRun: boolean): Promise<PriceJobResult> {
  const req = pool.request();
  let tree = ''; let where: string;
  if ('jobId' in filter) { req.input('j', sql.BigInt, filter.jobId); where = 'm.job_id = @j'; }
  else {
    req.input('a', sql.Int, filter.accountId);
    tree = `WITH tree (account_id) AS (SELECT account_id FROM idoc.account WHERE account_id = @a
              UNION ALL SELECT x.account_id FROM idoc.account AS x INNER JOIN tree AS t ON x.parent_account_id = t.account_id)`;
    const w = ['m.submitting_account_id IN (SELECT account_id FROM tree)'];
    if (filter.from) { req.input('from', sql.Date, filter.from); w.push(`${DAY} >= @from`); }
    if (filter.to) { req.input('to', sql.Date, filter.to); w.push(`${DAY} <= @to`); }
    if (filter.onlyUnpriced) w.push('m.priced_at IS NULL');
    where = w.join(' AND ');
  }
  const rows = (await req.query<Row>(`${tree}
    SELECT m.mailpiece_id, m.account_id, m.is_cancelled, m.pack_count, m.sheet_count,
           CONVERT(CHAR(10), CAST(m.created_at AT TIME ZONE N'UTC' AT TIME ZONE N'GMT Standard Time' AS DATE), 23) AS usage_day,
           pk.unknown_packs, pk.packs_json,
           COALESCE((SELECT a.colour_mode FROM idoc.v_account_owner AS o INNER JOIN idoc.account AS a ON a.account_id = o.owner_account_id WHERE o.account_id = m.submitting_account_id), N'ORIGINAL') AS colour_mode,
           COALESCE((SELECT SUM(i.quantity) FROM idoc.v_mailpiece_insert AS i WHERE i.mailpiece_id = m.mailpiece_id), 0) AS inserts,
           b.fulfilment_department AS department, b.mailpiece_count AS batch_mailpieces, b.outer_stock_item_id,
           f.name AS format_name,
           COALESCE(ae.is_oversticker, 0) AS is_oversticker,
           COALESCE((SELECT TOP 1 a.is_address_matching FROM idoc.v_account_setting_source AS s
                     INNER JOIN idoc.account AS a ON a.account_id = s.source_account_id
                     WHERE s.account_id = m.account_id AND s.setting = N'matching' ORDER BY s.depth), 0) AS is_address_matching,
           r.postal_rate_id AS rate_id, r.cost AS rate_cost, r.sell_price AS rate_sell
    FROM idoc.mailpiece AS m
    INNER JOIN idoc.batch AS b ON b.batch_id = m.batch_id
    CROSS APPLY (SELECT SUM(CASE WHEN p.colour_pages IS NULL OR p.mono_pages IS NULL OR p.blank_pages IS NULL THEN 1 ELSE 0 END) AS unknown_packs,
                        (SELECT COALESCE(x.colour_pages, 0) AS colour, COALESCE(x.mono_pages, 0) AS mono, COALESCE(x.blank_pages, 0) AS blank,
                                CASE WHEN o.colour LIKE N'Mono%' THEN CAST(1 AS BIT) ELSE CAST(0 AS BIT) END AS forceMono -- same rule as the composer (/^mono/i)
                         FROM idoc.pack AS x INNER JOIN idoc.option_set AS o ON o.option_set_id = x.option_set_id
                         WHERE x.mailpiece_id = m.mailpiece_id ORDER BY x.document_sequence, x.pack_id FOR JSON PATH) AS packs_json
                 FROM idoc.pack AS p WHERE p.mailpiece_id = m.mailpiece_id) AS pk
    LEFT JOIN idoc.postal_format AS f ON f.postal_format_id = m.postal_format_id
    LEFT JOIN idoc.account_envelope AS ae ON ae.account_envelope_id = m.account_envelope_id
    LEFT JOIN idoc.postal_rate AS r ON r.postal_rate_id = m.postal_rate_id
    WHERE ${where} AND m.is_cancelled = 0`)).recordset;

  const smallBatchLimit = (await pool.request().query<{ n: number }>('SELECT small_batch_limit AS n FROM idoc.settings WHERE settings_id = 1')).recordset[0]!.n;
  const result: PriceJobResult = { priced: 0, noModel: 0, unknownColours: 0 };
  const models = new Map<string, CostingModel | null>();
  const tx = new sql.Transaction(pool);
  if (!dryRun) await tx.begin();
  try {
    for (const m of rows) {
      if (m.unknown_packs > 0) { result.unknownColours++; continue; }
      const key = `${m.account_id}|${m.usage_day}`;
      if (!models.has(key)) models.set(key, await findCostingModel(pool, m.account_id, m.usage_day));
      const model = models.get(key);
      if (!model) { result.noModel++; continue; }
      if (dryRun) { result.priced++; continue; }
      const packs: PackPages[] = m.packs_json ? JSON.parse(m.packs_json) : [];
      const pages = composedPages(m.colour_mode, packs);   // what is printed, not what arrived
      pages.blank += paddingPages(packs);                   // the blank the composer adds after an odd pack
      const price = priceMailpiece(model, {
        packs: m.pack_count, colourPages: pages.colour, monoPages: pages.mono, blankPages: pages.blank, sheets: m.sheet_count, inserts: m.inserts,
        enclosing: m.department === 'Machine enclosing' ? 'Machine' : 'Hand', // Reception work is done by hand
        isOversticker: !!m.is_oversticker, batchMailpieces: m.batch_mailpieces, smallBatchLimit, postalFormat: m.format_name ?? '',
        isAddressMatching: !!m.is_address_matching, envelopeStockItemId: m.outer_stock_item_id,
        postageRate: m.rate_id === null ? null : { id: m.rate_id, cost: m.rate_cost === null ? null : Number(m.rate_cost), sellPrice: m.rate_sell === null ? null : Number(m.rate_sell) },
      });
      const q = (text: string, inputs: [string, sql.ISqlTypeFactoryWithNoParams | sql.ISqlType, unknown][]) => {
        const req = new sql.Request(tx); for (const [n, t, v] of inputs) req.input(n, t as sql.ISqlType, v); return req.query(text);
      };
      await q('DELETE FROM idoc.mailpiece_price_line WHERE mailpiece_id = @m', [['m', sql.BigInt, m.mailpiece_id]]);
      await q(`UPDATE idoc.mailpiece SET costing_model_id = @cm, production_cost = @pc, production_sell = @ps, postage_cost = @gc, postage_sell = @gs,
                 priced_at = SYSUTCDATETIME(), price_warnings = @w WHERE mailpiece_id = @m`, [
        ['m', sql.BigInt, m.mailpiece_id], ['cm', sql.Int, model.id], ['pc', sql.Decimal(12, 4), price.productionCost], ['ps', sql.Decimal(12, 4), price.productionSell],
        ['gc', sql.Decimal(12, 4), price.postageCost], ['gs', sql.Decimal(12, 4), price.postageSell],
        ['w', sql.NVarChar(500), price.warnings.length ? price.warnings.join(' ').slice(0, 500) : null]]);
      if (price.lines.length > 0) {
        await q(`INSERT INTO idoc.mailpiece_price_line (mailpiece_id, line_no, charge_code, label, quantity, unit_cost, unit_sell, cost, sell)
                 SELECT @m, l.line_no, l.code, l.label, l.quantity, l.unit_cost, l.unit_sell, l.cost, l.sell
                 FROM OPENJSON(@lines) WITH (line_no INT '$.n', code NVARCHAR(50) '$.code', label NVARCHAR(100) '$.label', quantity INT '$.quantity',
                   unit_cost DECIMAL(12,4) '$.unitCost', unit_sell DECIMAL(12,4) '$.unitSell', cost DECIMAL(12,4) '$.cost', sell DECIMAL(12,4) '$.sell') AS l`, [
          ['m', sql.BigInt, m.mailpiece_id], ['lines', sql.NVarChar(sql.MAX), JSON.stringify(price.lines.map((l, i) => ({ n: i + 1, ...l })))]]);
      }
      result.priced++;
    }
    if (!dryRun) await tx.commit();
  } catch (e) { if (dryRun) throw e; try { await tx.rollback(); } catch { /* already rolled back */ } throw e; }
  return result;
}
