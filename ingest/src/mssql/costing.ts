import sql from 'mssql';
import type { ChargeCode, CostingModel, Rate } from '../costing/types.js';

/**
 * The costing model that prices an account's mail on a day: the model of the account that holds the costing setting
 * (its own, or the nearest ancestor's, from idoc.v_account_setting_source), in force on that day. Null if there is none.
 * When models overlap the one that started last wins.
 */
export async function findCostingModel(pool: sql.ConnectionPool, accountId: number, on: Date | string): Promise<CostingModel | null> {
  const day = typeof on === 'string' ? on : on.toISOString().slice(0, 10);
  const head = (await pool.request().input('a', sql.Int, accountId).input('d', sql.Date, day).query(`
    SELECT TOP 1 m.costing_model_id AS id, m.name
    FROM idoc.v_account_setting_source AS s
    INNER JOIN idoc.costing_model AS m ON m.account_id = s.source_account_id
    WHERE s.account_id = @a AND s.setting = N'costing' AND m.is_active = 1 AND m.valid_from <= @d AND (m.valid_to IS NULL OR m.valid_to >= @d)
    ORDER BY s.depth, m.valid_from DESC`)).recordset[0] as { id: number; name: string } | undefined;
  if (!head) return null;
  const q = (text: string) => pool.request().input('m', sql.Int, head.id).query(text);
  const rate = (r: { cost: number; sell_price: number; adjustment: number }): Rate => ({ cost: Number(r.cost), sellPrice: Number(r.sell_price), adjustment: Number(r.adjustment) });
  const rates = new Map<ChargeCode, Rate>((await q('SELECT charge_code, cost, sell_price, adjustment FROM idoc.costing_model_rate WHERE costing_model_id = @m')).recordset
    .map((r) => [r.charge_code as ChargeCode, rate(r)]));
  const envelopes = new Map<number, Rate>((await q('SELECT stock_item_id, cost, sell_price, adjustment FROM idoc.costing_model_envelope WHERE costing_model_id = @m')).recordset
    .map((r) => [Number(r.stock_item_id), rate(r)]));
  const postageAdjustments = new Map<number, number>((await q('SELECT postal_rate_id, adjustment FROM idoc.costing_model_postage WHERE costing_model_id = @m')).recordset
    .map((r) => [Number(r.postal_rate_id), Number(r.adjustment)]));
  return { id: head.id, name: head.name, rates, envelopes, postageAdjustments };
}
