import sql from 'mssql';
import { priceMailpieces } from './pricing.js';

export interface RepriceScope { accountId: number; from: string | null; to: string | null; overwrite: boolean }
export interface RepricePreview {
  /** Mailpieces (not cancelled) of the account and below in the date range. */
  inScope: number;
  /** Of those, how many already carry a price. */
  alreadyPriced: number;
  /** How many a run would price now. */
  wouldPrice: number;
  /** Left out because no costing model covered their production day. */
  noModel: number;
  /** Left out because the colours of some of their pages are not known. */
  unknownColours: number;
}
export interface RepriceResult { priced: number; noModel: number; unknownColours: number }

/**
 * Prices mail that was ingested before a costing model existed, or prices it again after a model was corrected. It owns its connection so the
 * API does not have to share a driver instance with the ingest code. Each mailpiece is priced with the model in force on its production day.
 */
export class Repricer {
  private pool: sql.ConnectionPool | null = null;
  constructor(private readonly connectionString: string) {}
  private async db(): Promise<sql.ConnectionPool> { return (this.pool ??= await new sql.ConnectionPool(this.connectionString).connect()); }
  async close(): Promise<void> { await this.pool?.close(); this.pool = null; }

  async preview(scope: RepriceScope): Promise<RepricePreview> {
    const pool = await this.db();
    const req = pool.request().input('a', sql.Int, scope.accountId);
    const w = ['m.submitting_account_id IN (SELECT account_id FROM tree)', 'm.is_cancelled = 0'];
    if (scope.from) { req.input('from', sql.Date, scope.from); w.push(`CAST(m.created_at AT TIME ZONE N'UTC' AT TIME ZONE N'GMT Standard Time' AS DATE) >= @from`); }
    if (scope.to) { req.input('to', sql.Date, scope.to); w.push(`CAST(m.created_at AT TIME ZONE N'UTC' AT TIME ZONE N'GMT Standard Time' AS DATE) <= @to`); }
    const c = (await req.query(`
      WITH tree (account_id) AS (SELECT account_id FROM idoc.account WHERE account_id = @a
        UNION ALL SELECT x.account_id FROM idoc.account AS x INNER JOIN tree AS t ON x.parent_account_id = t.account_id)
      SELECT COUNT(*) AS n, SUM(CASE WHEN m.priced_at IS NOT NULL THEN 1 ELSE 0 END) AS priced FROM idoc.mailpiece AS m WHERE ${w.join(' AND ')}`)).recordset[0] as { n: number; priced: number | null };
    const would = await priceMailpieces(pool, { ...scope, onlyUnpriced: !scope.overwrite }, true);
    return { inScope: c.n, alreadyPriced: c.priced ?? 0, wouldPrice: would.priced, noModel: would.noModel, unknownColours: would.unknownColours };
  }

  async run(scope: RepriceScope): Promise<RepriceResult> {
    return priceMailpieces(await this.db(), { ...scope, onlyUnpriced: !scope.overwrite }, false);
  }
}
