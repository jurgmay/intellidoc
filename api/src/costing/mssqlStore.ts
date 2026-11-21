import sql from 'mssql';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { describeCostingMode, describeModelChange, describeModelCreated, describeModelRemoved } from './describe.js';
import { CHARGES, type ChargeCode, type CostingLookups, type CostingMode, type CostingOverview, type CostingStore, type ModelDetail, type ModelInput, type ModelSummary, type NewModelInput } from './types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;
const isDuplicate = (e: unknown): boolean => { const n = (e as { number?: number }).number; return n === 2627 || n === 2601; };
const rateLabel = (r: R): string => `${r.provider} – ${r.service} (${r.format}), ${r.min_weight_g <= 1 ? 'up to ' : `${r.min_weight_g}–`}${r.max_weight_g}g`;
const day = (d: Date | string | null): string | null => (d === null ? null : typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));
const num = (v: unknown): number => Number(v);
const CLASH = 'This customer already has a costing model starting on that day.';

/** The SQL behind the Costing tab. Anything written here also writes its audit line (on the customer's history) in the same transaction. */
export class MssqlCostingStore implements CostingStore {
  constructor(private readonly pool: sql.ConnectionPool) {}

  private async tx<T>(fn: (t: sql.Transaction) => Promise<T>): Promise<T> {
    const t = new sql.Transaction(this.pool);
    await t.begin();
    try { const out = await fn(t); await t.commit(); return out; }
    catch (e) { try { await t.rollback(); } catch { /* already rolled back */ } throw e; }
  }
  private req(t?: sql.Transaction): sql.Request { return t ? new sql.Request(t) : this.pool.request(); }
  private async audit(t: sql.Transaction, customerId: number, by: string, summary: string): Promise<void> {
    await this.req(t).input('c', sql.BigInt, customerId).input('by', sql.NVarChar(200), by).input('s', sql.NVarChar(1000), summary.slice(0, 1000))
      .query(`INSERT INTO idoc.audit_log (changed_by, entity, entity_id, summary) VALUES (@by, N'customer', @c, @s)`);
  }

  private async summaries(accountId: number): Promise<ModelSummary[]> {
    const rows = (await this.pool.request().input('a', sql.Int, accountId).query(`
      SELECT m.costing_model_id AS id, m.name, m.valid_from, m.valid_to, m.is_active,
             (SELECT COUNT(*) FROM idoc.mailpiece AS p WHERE p.costing_model_id = m.costing_model_id) AS used
      FROM idoc.costing_model AS m WHERE m.account_id = @a ORDER BY m.valid_from DESC`)).recordset as R[];
    return rows.map((r) => ({ id: r.id, name: r.name, validFrom: day(r.valid_from)!, validTo: day(r.valid_to), isActive: !!r.is_active, mailpieceCount: r.used }));
  }

  async overview(customerId: number): Promise<CostingOverview> {
    const acct = (await this.pool.request().input('a', sql.Int, customerId).query(`
      SELECT a.account_id, a.inherits_settings, a.costing_mode,
             (SELECT TOP 1 s.source_account_id FROM idoc.v_account_setting_source AS s WHERE s.account_id = a.account_id AND s.setting = N'costing' ORDER BY s.depth) AS source_id
      FROM idoc.account AS a WHERE a.account_id = @a`)).recordset[0] as R | undefined;
    if (!acct) throw new NotFoundError('Customer not found');
    let source = null; let sourceModels: ModelSummary[] = []; let sourceId: number = customerId;
    if (acct.source_id && acct.source_id !== customerId) {
      const s = (await this.pool.request().input('a', sql.Int, acct.source_id).query('SELECT account_id AS id, account_code AS code, name FROM idoc.account WHERE account_id = @a')).recordset[0] as R;
      source = { id: s.id as number, code: s.code as string, name: s.name as string }; sourceId = s.id; sourceModels = await this.summaries(s.id);
    }
    const inForce = (await this.pool.request().input('a', sql.Int, sourceId).query(`
      SELECT TOP 1 costing_model_id AS id FROM idoc.costing_model
      WHERE account_id = @a AND is_active = 1 AND valid_from <= CAST(SYSUTCDATETIME() AS DATE) AND (valid_to IS NULL OR valid_to >= CAST(SYSUTCDATETIME() AS DATE))
      ORDER BY valid_from DESC`)).recordset[0] as R | undefined;
    return { customerId, mode: acct.costing_mode as CostingMode, inheritsAll: !!acct.inherits_settings, source, models: await this.summaries(customerId), sourceModels, inForceId: inForce?.id ?? null };
  }

  async setMode(customerId: number, mode: CostingMode, by: string): Promise<void> {
    await this.tx(async (t) => {
      const a = (await this.req(t).input('a', sql.Int, customerId).query('SELECT inherits_settings, costing_mode, parent_account_id FROM idoc.account WHERE account_id = @a')).recordset[0] as R | undefined;
      if (!a) throw new NotFoundError('Customer not found');
      if (a.inherits_settings) throw new ConflictError('This account takes all its settings from its parent, so it cannot choose its own costing.');
      if (mode === 'INHERIT' && a.parent_account_id === null) throw new ValidationError({ mode: 'This customer has no parent to take prices from.' });
      if (a.costing_mode === mode) return;
      await this.req(t).input('a', sql.Int, customerId).input('m', sql.NVarChar(10), mode).query('UPDATE idoc.account SET costing_mode = @m WHERE account_id = @a');
      await this.audit(t, customerId, by, describeCostingMode(a.costing_mode, mode));
    });
  }

  private async input(id: number, t?: sql.Transaction): Promise<{ detail: ModelInput; customerId: number } | null> {
    const h = (await this.req(t).input('m', sql.Int, id).query('SELECT account_id, name, valid_from, valid_to, is_active, comments FROM idoc.costing_model WHERE costing_model_id = @m')).recordset[0] as R | undefined;
    if (!h) return null;
    const rates = (await this.req(t).input('m', sql.Int, id).query('SELECT charge_code, cost, sell_price, adjustment FROM idoc.costing_model_rate WHERE costing_model_id = @m')).recordset as R[];
    const envs = (await this.req(t).input('m', sql.Int, id).query('SELECT stock_item_id, cost, sell_price, adjustment FROM idoc.costing_model_envelope WHERE costing_model_id = @m')).recordset as R[];
    const post = (await this.req(t).input('m', sql.Int, id).query('SELECT postal_rate_id, adjustment FROM idoc.costing_model_postage WHERE costing_model_id = @m')).recordset as R[];
    return {
      customerId: h.account_id,
      detail: {
        name: h.name, validFrom: day(h.valid_from)!, validTo: day(h.valid_to), isActive: !!h.is_active, comments: h.comments,
        charges: rates.map((r) => ({ code: r.charge_code as ChargeCode, cost: num(r.cost), sellPrice: num(r.sell_price), adjustment: num(r.adjustment) })),
        envelopes: envs.map((r) => ({ stockItemId: r.stock_item_id, cost: num(r.cost), sellPrice: num(r.sell_price), adjustment: num(r.adjustment) })),
        postage: post.map((r) => ({ postalRateId: r.postal_rate_id, adjustment: num(r.adjustment) })),
      },
    };
  }

  async model(id: number): Promise<ModelDetail> {
    const cur = await this.input(id);
    if (!cur) throw new NotFoundError('Costing model not found');
    const meta = (await this.pool.request().input('m', sql.Int, id).query(`
      SELECT m.copied_from_id, c.name AS copied_name, (SELECT COUNT(*) FROM idoc.mailpiece AS p WHERE p.costing_model_id = m.costing_model_id) AS used
      FROM idoc.costing_model AS m LEFT JOIN idoc.costing_model AS c ON c.costing_model_id = m.copied_from_id WHERE m.costing_model_id = @m`)).recordset[0] as R;
    const envs = (await this.pool.request().input('m', sql.Int, id).query(`
      SELECT e.stock_item_id, s.stock_code, s.description, z.code AS size, e.cost, e.sell_price, e.adjustment
      FROM idoc.costing_model_envelope AS e INNER JOIN idoc.stock_item AS s ON s.stock_item_id = e.stock_item_id
      LEFT JOIN idoc.envelope_size AS z ON z.envelope_size_id = s.envelope_size_id WHERE e.costing_model_id = @m ORDER BY s.description`)).recordset as R[];
    const rates = (await this.pool.request().input('m', sql.Int, id).query(`
      SELECT r.postal_rate_id, pp.name AS provider, ps.name AS service, pf.name AS format, r.min_weight_g, r.max_weight_g, r.cost, r.sell_price, COALESCE(cp.adjustment, 0) AS adjustment
      FROM idoc.postal_rate AS r
      JOIN idoc.postal_service AS ps ON ps.postal_service_id = r.postal_service_id
      JOIN idoc.postal_provider AS pp ON pp.postal_provider_id = ps.postal_provider_id
      JOIN idoc.postal_format AS pf ON pf.postal_format_id = ps.postal_format_id
      LEFT JOIN idoc.costing_model_postage AS cp ON cp.postal_rate_id = r.postal_rate_id AND cp.costing_model_id = @m
      WHERE cp.postal_rate_id IS NOT NULL
         OR (r.valid_from <= CAST(SYSUTCDATETIME() AS DATE) AND (r.valid_to IS NULL OR r.valid_to >= CAST(SYSUTCDATETIME() AS DATE)))
      ORDER BY pp.name, ps.name, pf.rank_order, r.max_weight_g`)).recordset as R[];
    const ch = new Map(cur.detail.charges.map((c) => [c.code, c]));
    return {
      id, name: cur.detail.name, validFrom: cur.detail.validFrom, validTo: cur.detail.validTo, isActive: cur.detail.isActive, mailpieceCount: meta.used,
      customerId: cur.customerId, comments: cur.detail.comments, copiedFrom: meta.copied_from_id ? { id: meta.copied_from_id, name: meta.copied_name } : null,
      charges: CHARGES.map((c) => ({ code: c.code, label: c.label, group: c.group, cost: ch.get(c.code)?.cost ?? 0, sellPrice: ch.get(c.code)?.sellPrice ?? 0, adjustment: ch.get(c.code)?.adjustment ?? 0 })),
      envelopes: envs.map((r) => ({ stockItemId: r.stock_item_id, stockCode: r.stock_code, description: r.description, size: r.size, cost: num(r.cost), sellPrice: num(r.sell_price), adjustment: num(r.adjustment) })),
      postage: rates.map((r) => ({ postalRateId: r.postal_rate_id, label: rateLabel(r), format: r.format, suggestedCost: r.cost === null ? null : num(r.cost), suggestedSell: r.sell_price === null ? null : num(r.sell_price), adjustment: num(r.adjustment) })),
    };
  }

  async create(customerId: number, input: NewModelInput, by: string): Promise<number> {
    try {
      return await this.tx(async (t) => {
        const owner = (await this.req(t).input('a', sql.Int, customerId).query('SELECT account_id FROM idoc.account WHERE account_id = @a')).recordset[0];
        if (!owner) throw new NotFoundError('Customer not found');
        let copyName: string | null = null;
        if (input.copyFromId !== null) {
          const c = (await this.req(t).input('m', sql.Int, input.copyFromId).query('SELECT name FROM idoc.costing_model WHERE costing_model_id = @m')).recordset[0] as R | undefined;
          if (!c) throw new ValidationError({ copyFromId: 'The model to copy no longer exists' });
          copyName = c.name;
        }
        const id = (await this.req(t).input('a', sql.Int, customerId).input('n', sql.NVarChar(200), input.name).input('f', sql.Date, input.validFrom).input('to', sql.Date, input.validTo)
          .input('act', sql.Bit, input.isActive).input('cp', sql.Int, input.copyFromId).query(`
          INSERT INTO idoc.costing_model (account_id, name, valid_from, valid_to, is_active, copied_from_id)
          OUTPUT INSERTED.costing_model_id AS id VALUES (@a, @n, @f, @to, @act, @cp)`)).recordset[0].id as number;
        if (input.copyFromId !== null) {
          const q = (text: string) => this.req(t).input('new', sql.Int, id).input('old', sql.Int, input.copyFromId).query(text);
          await q('INSERT INTO idoc.costing_model_rate (costing_model_id, charge_code, cost, sell_price, adjustment) SELECT @new, charge_code, cost, sell_price, adjustment FROM idoc.costing_model_rate WHERE costing_model_id = @old');
          await q('INSERT INTO idoc.costing_model_envelope (costing_model_id, stock_item_id, cost, sell_price, adjustment) SELECT @new, stock_item_id, cost, sell_price, adjustment FROM idoc.costing_model_envelope WHERE costing_model_id = @old');
          await q('INSERT INTO idoc.costing_model_postage (costing_model_id, postal_rate_id, adjustment) SELECT @new, postal_rate_id, adjustment FROM idoc.costing_model_postage WHERE costing_model_id = @old');
        }
        await this.audit(t, customerId, by, describeModelCreated(input.name, copyName));
        return id;
      });
    } catch (e) { if (isDuplicate(e)) throw new ConflictError(CLASH); throw e; }
  }

  async update(id: number, input: ModelInput, by: string): Promise<void> {
    try {
      await this.tx(async (t) => {
        const before = await this.input(id, t);
        if (!before) throw new NotFoundError('Costing model not found');
        const kept = { ...input, postage: input.postage.filter((p) => p.adjustment !== 0) };
        const stockIds = kept.envelopes.map((e) => e.stockItemId); const rateIds = kept.postage.map((p) => p.postalRateId);
        const names = (await this.req(t).input('s', sql.NVarChar(sql.MAX), JSON.stringify(stockIds)).input('r', sql.NVarChar(sql.MAX), JSON.stringify(rateIds)).query(`
          SELECT N'S' AS k, s.stock_item_id AS id, COALESCE(s.stock_code, s.description) AS name FROM idoc.stock_item AS s WHERE s.stock_item_id IN (SELECT CAST(value AS INT) FROM OPENJSON(@s))
          UNION ALL SELECT N'R', r.postal_rate_id, CONCAT(ps.name, N' ', r.max_weight_g, N'g') FROM idoc.postal_rate AS r JOIN idoc.postal_service AS ps ON ps.postal_service_id = r.postal_service_id
          WHERE r.postal_rate_id IN (SELECT CAST(value AS INT) FROM OPENJSON(@r))`)).recordset as R[];
        const nameOf = (k: string) => new Map(names.filter((n) => n.k === k).map((n) => [n.id as number, n.name as string]));
        const sn = nameOf('S'); const rn = nameOf('R');
        const missingStock = kept.envelopes.findIndex((e) => !sn.has(e.stockItemId));
        if (missingStock >= 0) throw new ValidationError({ [`envelopes.${missingStock}.stockItemId`]: 'That envelope does not exist' });
        const missingRate = kept.postage.findIndex((p) => !rn.has(p.postalRateId));
        if (missingRate >= 0) throw new ValidationError({ [`postage.${missingRate}.postalRateId`]: 'That postal rate does not exist' });

        await this.req(t).input('m', sql.Int, id).input('n', sql.NVarChar(200), kept.name).input('f', sql.Date, kept.validFrom).input('to', sql.Date, kept.validTo)
          .input('act', sql.Bit, kept.isActive).input('c', sql.NVarChar(1000), kept.comments)
          .query('UPDATE idoc.costing_model SET name = @n, valid_from = @f, valid_to = @to, is_active = @act, comments = @c WHERE costing_model_id = @m');
        const del = (table: string) => this.req(t).input('m', sql.Int, id).query(`DELETE FROM idoc.${table} WHERE costing_model_id = @m`);
        await del('costing_model_rate'); await del('costing_model_envelope'); await del('costing_model_postage');
        const json = (v: unknown) => JSON.stringify(v);
        if (kept.charges.length) await this.req(t).input('m', sql.Int, id).input('j', sql.NVarChar(sql.MAX), json(kept.charges)).query(`
          INSERT INTO idoc.costing_model_rate (costing_model_id, charge_code, cost, sell_price, adjustment)
          SELECT @m, code, cost, sellPrice, adjustment FROM OPENJSON(@j) WITH (code NVARCHAR(50) '$.code', cost DECIMAL(12,4) '$.cost', sellPrice DECIMAL(12,4) '$.sellPrice', adjustment DECIMAL(12,4) '$.adjustment')`);
        if (kept.envelopes.length) await this.req(t).input('m', sql.Int, id).input('j', sql.NVarChar(sql.MAX), json(kept.envelopes)).query(`
          INSERT INTO idoc.costing_model_envelope (costing_model_id, stock_item_id, cost, sell_price, adjustment)
          SELECT @m, stockItemId, cost, sellPrice, adjustment FROM OPENJSON(@j) WITH (stockItemId INT '$.stockItemId', cost DECIMAL(12,4) '$.cost', sellPrice DECIMAL(12,4) '$.sellPrice', adjustment DECIMAL(12,4) '$.adjustment')`);
        if (kept.postage.length) await this.req(t).input('m', sql.Int, id).input('j', sql.NVarChar(sql.MAX), json(kept.postage)).query(`
          INSERT INTO idoc.costing_model_postage (costing_model_id, postal_rate_id, adjustment)
          SELECT @m, postalRateId, adjustment FROM OPENJSON(@j) WITH (postalRateId INT '$.postalRateId', adjustment DECIMAL(12,4) '$.adjustment')`);
        const line = describeModelChange(kept.name, before.detail, kept, (s) => sn.get(s) ?? String(s), (r) => rn.get(r) ?? String(r));
        if (line) await this.audit(t, before.customerId, by, line);
      });
    } catch (e) { if (isDuplicate(e)) throw new ConflictError(CLASH); throw e; }
  }

  async remove(id: number, by: string): Promise<void> {
    await this.tx(async (t) => {
      const m = (await this.req(t).input('m', sql.Int, id).query(`
        SELECT account_id, name FROM idoc.costing_model WHERE costing_model_id = @m`)).recordset[0] as R | undefined;
      if (!m) throw new NotFoundError('Costing model not found');
      const used = (await this.req(t).input('m', sql.Int, id).query('SELECT COUNT(*) AS n FROM idoc.mailpiece WHERE costing_model_id = @m')).recordset[0].n as number;
      if (used > 0) throw new ConflictError(`This model has priced ${used} mailpiece${used === 1 ? '' : 's'}, so it cannot be deleted. Switch it off instead.`);
      for (const table of ['costing_model_rate', 'costing_model_envelope', 'costing_model_postage']) await this.req(t).input('m', sql.Int, id).query(`DELETE FROM idoc.${table} WHERE costing_model_id = @m`);
      await this.req(t).input('m', sql.Int, id).query('UPDATE idoc.costing_model SET copied_from_id = NULL WHERE copied_from_id = @m');
      await this.req(t).input('m', sql.Int, id).query('DELETE FROM idoc.costing_model WHERE costing_model_id = @m');
      await this.audit(t, m.account_id, by, describeModelRemoved(m.name));
    });
  }

  async lookups(): Promise<CostingLookups> {
    const stock = (await this.pool.request().query(`SELECT s.stock_item_id, s.stock_code, s.description, z.code AS size FROM idoc.stock_item s LEFT JOIN idoc.envelope_size z ON z.envelope_size_id = s.envelope_size_id
      WHERE s.is_envelope = 1 AND s.is_active = 1 ORDER BY s.description`)).recordset as R[];
    return { envelopeStock: stock.map((r) => ({ id: r.stock_item_id, code: r.stock_code, description: r.description, size: r.size })) };
  }
}
