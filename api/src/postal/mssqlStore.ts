import sql from 'mssql';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import * as D from './describe.js';
import { checkNoOverlap, dayBefore, planPriceChange, statusOf, type BandRow } from './rules.js';
import type { HistoryEntry, PostalOverview, PostalStore, PriceChangeInput, ProviderView, RateInput, ServiceInput, ServiceView } from './types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;
const code = (e: unknown): number | undefined => (e as { number?: number }).number;
const day = (d: Date | string | null): string | null => (d === null ? null : typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10));
const money = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** The SQL behind the Settings "Postal rates" tab. Every change writes its audit line (entity 'postal') in the same transaction. */
export class MssqlPostalStore implements PostalStore {
  constructor(private readonly pool: sql.ConnectionPool) {}

  private async tx<T>(fn: (t: sql.Transaction) => Promise<T>): Promise<T> {
    const t = new sql.Transaction(this.pool);
    await t.begin();
    try { const out = await fn(t); await t.commit(); return out; }
    catch (e) { try { await t.rollback(); } catch { /* already rolled back */ } throw e; }
  }
  private req(t: sql.Transaction): sql.Request { return new sql.Request(t); }
  private async audit(t: sql.Transaction, by: string, summary: string): Promise<void> {
    await this.req(t).input('by', sql.NVarChar(200), by).input('s', sql.NVarChar(1000), summary.slice(0, 1000))
      .query(`INSERT INTO idoc.audit_log (changed_by, entity, entity_id, summary) VALUES (@by, N'postal', 0, @s)`);
  }
  private async today(t?: sql.Transaction): Promise<string> {
    const r = t ? new sql.Request(t) : this.pool.request();
    return day((await r.query('SELECT CAST(SYSUTCDATETIME() AS DATE) AS d')).recordset[0].d)!;
  }
  private async providerName(t: sql.Transaction, id: number): Promise<string> {
    const r = (await this.req(t).input('i', sql.Int, id).query('SELECT name FROM idoc.postal_provider WHERE postal_provider_id = @i')).recordset[0] as R | undefined;
    if (!r) throw new NotFoundError('Provider not found');
    return r.name as string;
  }
  private async service(t: sql.Transaction, id: number): Promise<R> {
    const r = (await this.req(t).input('i', sql.Int, id).query(`
      SELECT s.postal_service_id, s.postal_provider_id, s.postal_format_id, s.name, s.service_code, s.is_signed_for, s.is_tracked, s.is_recorded, p.name AS provider, f.name AS format
      FROM idoc.postal_service AS s JOIN idoc.postal_provider AS p ON p.postal_provider_id = s.postal_provider_id JOIN idoc.postal_format AS f ON f.postal_format_id = s.postal_format_id
      WHERE s.postal_service_id = @i`)).recordset[0] as R | undefined;
    if (!r) throw new NotFoundError('Service not found');
    return r;
  }
  private async rate(t: sql.Transaction, id: number): Promise<R> {
    const r = (await this.req(t).input('i', sql.Int, id).query(`
      SELECT postal_rate_id, postal_service_id, min_weight_g, max_weight_g, valid_from, valid_to, cost, sell_price FROM idoc.postal_rate WHERE postal_rate_id = @i`)).recordset[0] as R | undefined;
    if (!r) throw new NotFoundError('Price not found');
    return r;
  }
  private async usage(t: sql.Transaction, rateId: number): Promise<number> {
    const r = (await this.req(t).input('i', sql.Int, rateId).query(`
      SELECT (SELECT COUNT(*) FROM idoc.account_envelope WHERE postal_rate_id = @i)
           + (SELECT COUNT(*) FROM idoc.costing_model_postage WHERE postal_rate_id = @i)
           + (SELECT COUNT(*) FROM idoc.mailpiece WHERE postal_rate_id = @i) AS n`)).recordset[0] as R;
    return Number(r.n);
  }
  private async bands(t: sql.Transaction, serviceId: number, exceptId: number | null): Promise<BandRow[]> {
    const rows = (await this.req(t).input('s', sql.Int, serviceId).input('x', sql.Int, exceptId).query(`
      SELECT postal_rate_id, min_weight_g, max_weight_g, valid_from, valid_to FROM idoc.postal_rate WHERE postal_service_id = @s AND (@x IS NULL OR postal_rate_id <> @x)`)).recordset as R[];
    return rows.map((r) => ({ id: r.postal_rate_id, minWeightG: r.min_weight_g, maxWeightG: r.max_weight_g, validFrom: day(r.valid_from)!, validTo: day(r.valid_to) }));
  }
  /** Maps SQL duplicate and foreign key errors to messages a person can act on. */
  private mapErr(e: unknown, dup: string): never {
    const n = code(e);
    if (n === 2627 || n === 2601) throw new ConflictError(dup);
    if (n === 547) throw new ConflictError('Something still uses this, so it cannot be deleted.');
    throw e;
  }

  async overview(): Promise<PostalOverview> {
    const today = await this.today();
    const formats = ((await this.pool.request().query('SELECT postal_format_id AS id, name FROM idoc.postal_format ORDER BY rank_order, name')).recordset as R[]).map((r) => ({ id: r.id as number, name: r.name as string }));
    const prov = (await this.pool.request().query('SELECT postal_provider_id AS id, name FROM idoc.postal_provider ORDER BY name')).recordset as R[];
    const svcs = (await this.pool.request().query(`
      SELECT s.postal_service_id AS id, s.postal_provider_id AS provider_id, s.name, s.postal_format_id, f.name AS format, s.service_code, s.is_signed_for, s.is_tracked, s.is_recorded
      FROM idoc.postal_service AS s JOIN idoc.postal_format AS f ON f.postal_format_id = s.postal_format_id ORDER BY s.name, f.rank_order`)).recordset as R[];
    const rates = (await this.pool.request().query(`
      SELECT r.postal_rate_id AS id, r.postal_service_id, r.min_weight_g, r.max_weight_g, r.valid_from, r.valid_to, r.cost, r.sell_price,
             (SELECT COUNT(*) FROM idoc.account_envelope AS x WHERE x.postal_rate_id = r.postal_rate_id)
           + (SELECT COUNT(*) FROM idoc.costing_model_postage AS x WHERE x.postal_rate_id = r.postal_rate_id)
           + (SELECT COUNT(*) FROM idoc.mailpiece AS x WHERE x.postal_rate_id = r.postal_rate_id) AS used_by
      FROM idoc.postal_rate AS r ORDER BY r.min_weight_g, r.max_weight_g, r.valid_from DESC`)).recordset as R[];
    const providers: ProviderView[] = prov.map((p) => ({
      id: p.id, name: p.name,
      services: svcs.filter((s) => s.provider_id === p.id).map((s): ServiceView => ({
        id: s.id, name: s.name, formatId: s.postal_format_id, formatName: s.format, serviceCode: s.service_code, isSignedFor: !!s.is_signed_for, isTracked: !!s.is_tracked, isRecorded: !!s.is_recorded,
        rates: rates.filter((r) => r.postal_service_id === s.id).map((r) => ({
          id: r.id, minWeightG: r.min_weight_g, maxWeightG: r.max_weight_g, validFrom: day(r.valid_from)!, validTo: day(r.valid_to), cost: money(r.cost), sellPrice: money(r.sell_price),
          usedBy: Number(r.used_by), status: statusOf(day(r.valid_from)!, day(r.valid_to), today),
        })),
      })),
    }));
    return { today, formats, providers };
  }

  async createProvider(name: string, by: string): Promise<number> {
    return this.tx(async (t) => {
      let id: number;
      try { id = (await this.req(t).input('n', sql.NVarChar(100), name).query('INSERT INTO idoc.postal_provider (name) OUTPUT INSERTED.postal_provider_id AS id VALUES (@n)')).recordset[0].id; }
      catch (e) { this.mapErr(e, 'There is already a provider with that name.'); }
      await this.audit(t, by, D.describeProviderCreated(name));
      return id;
    });
  }
  async updateProvider(id: number, name: string, by: string): Promise<void> {
    await this.tx(async (t) => {
      const old = await this.providerName(t, id);
      if (old === name) return;
      try { await this.req(t).input('i', sql.Int, id).input('n', sql.NVarChar(100), name).query('UPDATE idoc.postal_provider SET name = @n WHERE postal_provider_id = @i'); }
      catch (e) { this.mapErr(e, 'There is already a provider with that name.'); }
      await this.audit(t, by, D.describeProviderRenamed(old, name));
    });
  }
  async deleteProvider(id: number, by: string): Promise<void> {
    await this.tx(async (t) => {
      const name = await this.providerName(t, id);
      const n = (await this.req(t).input('i', sql.Int, id).query('SELECT COUNT(*) AS n FROM idoc.postal_service WHERE postal_provider_id = @i')).recordset[0].n as number;
      if (n > 0) throw new ConflictError('This provider still has services. Delete them first, or end their prices with a last day.');
      await this.req(t).input('i', sql.Int, id).query('DELETE FROM idoc.postal_provider WHERE postal_provider_id = @i');
      await this.audit(t, by, D.describeProviderDeleted(name));
    });
  }

  private async checkFormat(t: sql.Transaction, id: number): Promise<string> {
    const f = (await this.req(t).input('i', sql.Int, id).query('SELECT name FROM idoc.postal_format WHERE postal_format_id = @i')).recordset[0] as R | undefined;
    if (!f) throw new ValidationError({ formatId: 'Unknown format' });
    return f.name as string;
  }
  private bindService(r: sql.Request, input: ServiceInput): sql.Request {
    return r.input('f', sql.Int, input.formatId).input('n', sql.NVarChar(100), input.name).input('c', sql.NVarChar(50), input.serviceCode)
      .input('sg', sql.Bit, input.isSignedFor).input('tr', sql.Bit, input.isTracked).input('rc', sql.Bit, input.isRecorded);
  }
  async createService(providerId: number, input: ServiceInput, by: string): Promise<number> {
    return this.tx(async (t) => {
      const p = await this.providerName(t, providerId); await this.checkFormat(t, input.formatId);
      let id: number;
      try {
        id = (await this.bindService(this.req(t).input('p', sql.Int, providerId), input).query(`
          INSERT INTO idoc.postal_service (postal_provider_id, postal_format_id, name, service_code, is_signed_for, is_tracked, is_recorded)
          OUTPUT INSERTED.postal_service_id AS id VALUES (@p, @f, @n, @c, @sg, @tr, @rc)`)).recordset[0].id;
      } catch (e) { this.mapErr(e, 'This provider already has a service with that name and format.'); }
      await this.audit(t, by, D.describeServiceCreated(p, input.name));
      return id;
    });
  }
  async updateService(id: number, input: ServiceInput, by: string): Promise<void> {
    await this.tx(async (t) => {
      const s = await this.service(t, id); const fname = await this.checkFormat(t, input.formatId);
      try {
        await this.bindService(this.req(t).input('i', sql.Int, id), input).query(`
          UPDATE idoc.postal_service SET postal_format_id = @f, name = @n, service_code = @c, is_signed_for = @sg, is_tracked = @tr, is_recorded = @rc WHERE postal_service_id = @i`);
      } catch (e) { this.mapErr(e, 'This provider already has a service with that name and format.'); }
      const before = { formatId: s.postal_format_id as number, name: s.name as string, serviceCode: s.service_code as string | null, isSignedFor: !!s.is_signed_for, isTracked: !!s.is_tracked, isRecorded: !!s.is_recorded, formatName: s.format as string };
      const line = D.describeServiceChange(s.provider, before, { ...input, formatName: fname });
      if (line) await this.audit(t, by, line);
    });
  }
  async deleteService(id: number, by: string): Promise<void> {
    await this.tx(async (t) => {
      const s = await this.service(t, id);
      const n = (await this.req(t).input('i', sql.Int, id).query('SELECT (SELECT COUNT(*) FROM idoc.postal_rate WHERE postal_service_id = @i) AS rates, (SELECT COUNT(*) FROM idoc.batch WHERE postal_service_id = @i) AS batches')).recordset[0] as R;
      if (n.rates > 0) throw new ConflictError('This service still has prices. Delete them, or end them with a last day to switch the service off.');
      if (n.batches > 0) throw new ConflictError('Batches have been made with this service, so it cannot be deleted.');
      await this.req(t).input('i', sql.Int, id).query('DELETE FROM idoc.postal_service WHERE postal_service_id = @i');
      await this.audit(t, by, D.describeServiceDeleted(s.provider, s.name));
    });
  }

  async createRate(serviceId: number, input: RateInput, by: string): Promise<number> {
    return this.tx(async (t) => {
      const s = await this.service(t, serviceId);
      checkNoOverlap(input, await this.bands(t, serviceId, null));
      let id: number;
      try {
        id = (await this.req(t).input('s', sql.Int, serviceId).input('mn', sql.Int, input.minWeightG).input('mx', sql.Int, input.maxWeightG).input('f', sql.Date, input.validFrom).input('to', sql.Date, input.validTo)
          .input('c', sql.Decimal(10, 4), input.cost).input('sp', sql.Decimal(10, 4), input.sellPrice).query(`
          INSERT INTO idoc.postal_rate (postal_service_id, min_weight_g, max_weight_g, valid_from, valid_to, cost, sell_price)
          OUTPUT INSERTED.postal_rate_id AS id VALUES (@s, @mn, @mx, @f, @to, @c, @sp)`)).recordset[0].id;
      } catch (e) { this.mapErr(e, 'There is already a price for these weights starting that day.'); }
      await this.audit(t, by, D.describeRateCreated(`${s.provider} – ${s.name}`, input));
      return id;
    });
  }
  async updateRate(id: number, input: RateInput, by: string): Promise<void> {
    await this.tx(async (t) => {
      const r = await this.rate(t, id); const s = await this.service(t, r.postal_service_id);
      const before: RateInput = { minWeightG: r.min_weight_g, maxWeightG: r.max_weight_g, validFrom: day(r.valid_from)!, validTo: day(r.valid_to), cost: money(r.cost), sellPrice: money(r.sell_price) };
      if ((before.minWeightG !== input.minWeightG || before.maxWeightG !== input.maxWeightG || before.validFrom !== input.validFrom) && (await this.usage(t, id)) > 0)
        throw new ConflictError('This price is in use, so its weights and first day cannot change. Use "Change prices from a date" instead.');
      checkNoOverlap(input, await this.bands(t, r.postal_service_id, id));
      try {
        await this.req(t).input('i', sql.Int, id).input('mn', sql.Int, input.minWeightG).input('mx', sql.Int, input.maxWeightG).input('f', sql.Date, input.validFrom).input('to', sql.Date, input.validTo)
          .input('c', sql.Decimal(10, 4), input.cost).input('sp', sql.Decimal(10, 4), input.sellPrice).query(`
          UPDATE idoc.postal_rate SET min_weight_g = @mn, max_weight_g = @mx, valid_from = @f, valid_to = @to, cost = @c, sell_price = @sp WHERE postal_rate_id = @i`);
      } catch (e) { this.mapErr(e, 'There is already a price for these weights starting that day.'); }
      const line = D.describeRateChange(`${s.provider} – ${s.name}`, before, input);
      if (line) await this.audit(t, by, line);
    });
  }
  async deleteRate(id: number, by: string): Promise<void> {
    await this.tx(async (t) => {
      const r = await this.rate(t, id); const s = await this.service(t, r.postal_service_id);
      if ((await this.usage(t, id)) > 0) throw new ConflictError('This price is in use by envelope settings, customer prices or mailpieces, so it cannot be deleted. Give it a last day instead.');
      try { await this.req(t).input('i', sql.Int, id).query('DELETE FROM idoc.postal_rate WHERE postal_rate_id = @i'); }
      catch (e) { this.mapErr(e, 'Something still uses this price.'); }
      await this.audit(t, by, D.describeRateDeleted(`${s.provider} – ${s.name}`, { minWeightG: r.min_weight_g, maxWeightG: r.max_weight_g, validFrom: day(r.valid_from)! }));
    });
  }

  async priceChange(serviceId: number, input: PriceChangeInput, by: string): Promise<number> {
    return this.tx(async (t) => {
      const s = await this.service(t, serviceId);
      const rows = await this.bands(t, serviceId, null);
      const plan = planPriceChange(input.effectiveFrom, await this.today(t), rows, input.changes);
      const lines: Parameters<typeof D.describePriceChange>[2] = [];
      for (const p of plan) {
        const old = await this.rate(t, p.row.id);
        lines.push({ min: old.min_weight_g, max: old.max_weight_g, cost: [money(old.cost), p.cost], sell: [money(old.sell_price), p.sellPrice] });
        await this.req(t).input('i', sql.Int, old.postal_rate_id).input('to', sql.Date, dayBefore(input.effectiveFrom)).query('UPDATE idoc.postal_rate SET valid_to = @to WHERE postal_rate_id = @i');
        const nid = (await this.req(t).input('s', sql.Int, serviceId).input('mn', sql.Int, old.min_weight_g).input('mx', sql.Int, old.max_weight_g).input('f', sql.Date, input.effectiveFrom).input('to', sql.Date, day(old.valid_to))
          .input('c', sql.Decimal(10, 4), p.cost).input('sp', sql.Decimal(10, 4), p.sellPrice).query(`
          INSERT INTO idoc.postal_rate (postal_service_id, min_weight_g, max_weight_g, valid_from, valid_to, cost, sell_price)
          OUTPUT INSERTED.postal_rate_id AS id VALUES (@s, @mn, @mx, @f, @to, @c, @sp)`)).recordset[0].id as number;
        // Customer costing adjustments follow the band to its new price.
        await this.req(t).input('o', sql.Int, old.postal_rate_id).input('n', sql.Int, nid).query(`
          INSERT INTO idoc.costing_model_postage (costing_model_id, postal_rate_id, adjustment)
          SELECT costing_model_id, @n, adjustment FROM idoc.costing_model_postage WHERE postal_rate_id = @o`);
      }
      await this.audit(t, by, D.describePriceChange(`${s.provider} – ${s.name}`, input.effectiveFrom, lines));
      return plan.length;
    });
  }

  async history(limit: number): Promise<HistoryEntry[]> {
    const rows = (await this.pool.request().input('n', sql.Int, limit).query(`SELECT TOP (@n) audit_id, changed_at, changed_by, summary FROM idoc.audit_log WHERE entity = N'postal' ORDER BY audit_id DESC`)).recordset as R[];
    return rows.map((r) => ({ id: Number(r.audit_id), changedAt: (r.changed_at as Date).toISOString(), changedBy: r.changed_by, summary: r.summary }));
  }
}
