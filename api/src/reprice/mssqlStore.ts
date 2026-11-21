import sql from 'mssql';
import { NotFoundError } from '../errors.js';
import { describeReprice } from './validate.js';
import type { RepriceEngine, RepriceInput, RepricePreview, RepriceResult, RepriceStore } from './types.js';

/** Checks the customer exists, hands the work to the engine and writes the audit line on the customer's history. */
export class MssqlRepriceStore implements RepriceStore {
  constructor(private readonly pool: sql.ConnectionPool, private readonly engine: RepriceEngine) {}
  private async check(id: number): Promise<void> {
    const r = await this.pool.request().input('a', sql.Int, id).query('SELECT 1 AS x FROM idoc.account WHERE account_id = @a AND is_deleted = 0');
    if (r.recordset.length === 0) throw new NotFoundError('Customer not found');
  }
  async preview(customerId: number, input: RepriceInput): Promise<RepricePreview> { await this.check(customerId); return this.engine.preview({ accountId: customerId, ...input }); }
  async run(customerId: number, input: RepriceInput, by: string): Promise<RepriceResult> {
    await this.check(customerId);
    const result = await this.engine.run({ accountId: customerId, ...input });
    await this.pool.request().input('c', sql.BigInt, customerId).input('by', sql.NVarChar(200), by).input('s', sql.NVarChar(1000), describeReprice(input, result).slice(0, 1000))
      .query(`INSERT INTO idoc.audit_log (changed_by, entity, entity_id, summary) VALUES (@by, N'customer', @c, @s)`);
    return result;
  }
}
