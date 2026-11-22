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

  it('adds price lists as switched-off drafts with no dates, and never touches an account that already has one', async () => {
    const leaf = { cost: 0.04, sellPrice: 0.07, adjustment: 0 };
    const withPrices = buildPlan({
      customers: [{ ...{ id: A, id_parentAccount: '', id_groupingAccount: '', accountCode: 'IMPORT_CUST', accountName: 'Import customer', isDeleted: '0', notificationEmails: 'x@y.co',
        envelopesJSON: JSON.stringify({ k: { id: E, stockCode: 'WHIMP1' } }), id_costingModel: 'm1', costingModelJSON: JSON.stringify({ printing: { colourPage: leaf } }) } }],
      brands: [{ id: BR, id_customer: A, name: 'Brand 1' }],
      stock: [{ id: S, id_customer: A, id_parent: '', id_brand: BR, stockCode: 'WHIMP1', type: 'Outer Envelope', description: 'C5 Envelope', isActive: '1', size: 'C5', weight: '8', thickness: '0', cost: '0.05', sellPrice: '0.1' }],
      envelopes: [{ id: E, id_customer: A, id_brand: BR, id_stockItem: S, isDeleted: '0', postalProvider: 'Royal Mail', postalFormat: 'Letter', postalService: '2nd Class', externalService: '2nd Class', maxWeight: '100', externalName: 'C5 Envelope' }],
    });
    const first = await applyPlan(pool, withPrices);
    expect(first.costingModels).toBe(1);
    const q = `SELECT m.valid_from, m.valid_to, m.is_active, (SELECT COUNT(*) FROM idoc.costing_model_rate WHERE costing_model_id = m.costing_model_id) AS rates,
      (SELECT COUNT(*) FROM idoc.costing_model_envelope WHERE costing_model_id = m.costing_model_id) AS envs
      FROM idoc.costing_model m JOIN idoc.account a ON a.account_id = m.account_id WHERE a.account_code = N'IMPORT_CUST'`;
    expect((await pool.request().query(q)).recordset).toEqual([{ valid_from: null, valid_to: null, is_active: false, rates: 1, envs: 1 }]);
    expect((await applyPlan(pool, withPrices)).costingModels).toBe(0);     // re-run adds nothing
    expect((await pool.request().query(q)).recordset.length).toBe(1);
  });
});
