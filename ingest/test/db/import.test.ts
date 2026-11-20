import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type sql from 'mssql';
import { connect, hasDb, resetAndSeed } from './setup.js';
import { applyPlan } from '../../src/import/apply.js';
import { buildPlan } from '../../src/import/plan.js';

describe.skipIf(!hasDb)('reference import', { timeout: 120_000 }, () => {
  let pool: sql.ConnectionPool;
  beforeAll(async () => { pool = await connect(); await resetAndSeed(pool); });
  afterAll(async () => { await pool?.close(); });

  const A = 'aaaaaaaa-0000-0000-0000-000000000001', S = 'cccccccc-0000-0000-0000-000000000001', E = 'dddddddd-0000-0000-0000-000000000001', BR = 'bbbbbbbb-0000-0000-0000-000000000001';
  const plan = buildPlan({
    customers: [{ id: A, id_parentAccount: '', id_groupingAccount: '', accountCode: 'IMPORT_CUST', accountName: 'Import customer', isDeleted: '0', notificationEmails: 'x@y.co',
      envelopesJSON: JSON.stringify({ k: { id: E, stockCode: 'WHIMP1' } }) }],
    brands: [{ id: BR, id_customer: A, name: 'Brand 1' }],
    stock: [{ id: S, id_customer: A, id_parent: '', id_brand: BR, stockCode: 'WHIMP1', type: 'Outer Envelope', description: 'C5 Envelope', isActive: '1', size: 'C5', weight: '8', thickness: '0', width: '229', height: '162' }],
    envelopes: [{ id: E, id_customer: A, id_brand: BR, id_stockItem: S, isDeleted: '0', postalProvider: 'Royal Mail', postalFormat: 'Letter', postalService: '2nd Class', externalService: '2nd Class', maxWeight: '100', externalName: 'C5 Envelope' }],
  });
  const count = async (t: string) => (await pool.request().query(`SELECT COUNT(*) AS n FROM idoc.${t}`)).recordset[0].n as number;

  it('loads and can be re-run without duplicating anything', async () => {
    await applyPlan(pool, plan);
    const first = { a: await count('account'), s: await count('stock_item'), e: await count('account_envelope'), r: await count('postal_rate'), b: await count('brand') };
    await applyPlan(pool, plan);
    expect({ a: await count('account'), s: await count('stock_item'), e: await count('account_envelope'), r: await count('postal_rate'), b: await count('brand') }).toEqual(first);
    const r = (await pool.request().query(`SELECT ae.delivery_band, si.stock_code, si.is_warehouse_code, pr.max_weight_g FROM idoc.account_envelope ae
      JOIN idoc.stock_item si ON si.stock_item_id = ae.outer_stock_item_id JOIN idoc.postal_rate pr ON pr.postal_rate_id = ae.postal_rate_id
      WHERE si.stock_code = N'WHIMP1'`)).recordset;   // the test seed has its own envelopes; look at ours only
    expect(r).toEqual([{ delivery_band: '2nd Class', stock_code: 'WHIMP1', is_warehouse_code: true, max_weight_g: 100 }]);
  });
});
