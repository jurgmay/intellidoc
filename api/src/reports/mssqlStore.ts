import sql from 'mssql';
import type { InvoicingAccount, ReportStore, UsageLine, UsageQuery } from './types.js';

export class MssqlReportStore implements ReportStore {
  constructor(private readonly pool: sql.ConnectionPool) {}

  async invoicingAccounts(): Promise<InvoicingAccount[]> {
    const r = await this.pool.request().query(`
      SELECT a.account_id AS id, a.account_code AS code, a.name
      FROM idoc.account a WHERE a.account_id IN (SELECT DISTINCT invoicing_account_id FROM idoc.mailpiece) ORDER BY a.name`);
    return r.recordset as InvoicingAccount[];
  }

  async usageLines(q: UsageQuery) {
    const acct = (await this.pool.request().input('id', sql.Int, q.invoicingAccountId)
      .query(`SELECT account_id AS id, account_code AS code, name FROM idoc.account WHERE account_id = @id`)).recordset[0] as InvoicingAccount | undefined;
    if (!acct) return null;
    const r = await this.pool.request().input('id', sql.Int, q.invoicingAccountId).input('from', sql.Date, q.from).input('to', sql.Date, q.to).query(`
      SELECT CONVERT(NVARCHAR(10), usage_day, 23) AS day, brand, postal_format AS format, postal_service AS service,
             mailpieces, packs, sheets, priced, production_sell AS productionSell, postage_sell AS postageSell
      FROM idoc.v_usage_daily WHERE invoicing_account_id = @id AND usage_day BETWEEN @from AND @to
      ORDER BY usage_day, brand, postal_format, postal_service`);
    return { account: acct, lines: r.recordset as UsageLine[] };
  }
}
