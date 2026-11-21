import sql from 'mssql';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { describeDetailsChange, describeEnvelope, describeMatchRules, describeSequenceRules } from './describe.js';
import {
  FLAGS, type AuditEntry, type CustomerDetail, type CustomerDetailsInput, type CustomerRow, type CustomerStore, type EnvelopeInput, type FlagKey, type Lookups, type MatchRule, type SequenceRule,
} from './types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

const FLAG_COLUMNS: Record<FlagKey, string> = {
  isAddressMatching: 'is_address_matching', isArchiveMailpieces: 'is_archive_mailpieces', isCreateOutputFiles: 'is_create_output_files',
  isSso: 'is_sso', isSameDayService: 'is_same_day_service',
  isUseMrdf: 'is_use_mrdf', isTesting: 'is_testing', isDeleted: 'is_deleted',
};

const isDuplicate = (e: unknown): boolean => { const n = (e as { number?: number }).number; return n === 2627 || n === 2601; };
const rateLabel = (r: R): string => `${r.provider} – ${r.service} (${r.format}), ${r.min_weight_g <= 1 ? 'up to ' : `${r.min_weight_g}–`}${r.max_weight_g}g`;

/** The SQL behind the Customers screens. Anything written here also writes its audit line in the same transaction. */
export class MssqlCustomerStore implements CustomerStore {
  constructor(private readonly pool: sql.ConnectionPool) {}

  private async tx<T>(fn: (t: sql.Transaction) => Promise<T>, dupMessage?: string): Promise<T> {
    const t = new sql.Transaction(this.pool);
    await t.begin();
    try {
      const out = await fn(t);
      await t.commit();
      return out;
    } catch (e) {
      try { await t.rollback(); } catch { /* already rolled back */ }
      if (dupMessage && isDuplicate(e)) throw new ConflictError(dupMessage);
      throw e;
    }
  }
  private req(t?: sql.Transaction): sql.Request { return t ? new sql.Request(t) : this.pool.request(); }
  private async audit(t: sql.Transaction, customerId: number, by: string, summary: string): Promise<void> {
    await this.req(t).input('c', sql.BigInt, customerId).input('by', sql.NVarChar(200), by).input('s', sql.NVarChar(1000), summary.slice(0, 1000))
      .query(`INSERT INTO idoc.audit_log (changed_by, entity, entity_id, summary) VALUES (@by, N'customer', @c, @s)`);
  }
  private async keyId(t: sql.Transaction, name: string | null): Promise<number | null> {
    if (!name) return null;
    const found = (await this.req(t).input('n', sql.NVarChar(100), name).query('SELECT passthrough_key_id AS id FROM idoc.passthrough_key WHERE name = @n')).recordset[0];
    if (found) return found.id as number;
    return (await this.req(t).input('n', sql.NVarChar(100), name).query('INSERT INTO idoc.passthrough_key (name) OUTPUT INSERTED.passthrough_key_id AS id VALUES (@n)')).recordset[0].id as number;
  }
  /** Throws NotFound unless the id is a customer (not a sub-account). */
  private async mustBeCustomer(t: sql.Transaction | undefined, id: number): Promise<void> {
    const r = await this.req(t).input('id', sql.Int, id).query('SELECT 1 AS x FROM idoc.account WHERE account_id = @id AND grouping_account_id IS NULL');
    if (r.recordset.length === 0) throw new NotFoundError('Customer not found');
  }

  async list(search: string, includeDeleted: boolean): Promise<CustomerRow[]> {
    const rows = (await this.pool.request().input('q', sql.NVarChar(200), `%${search.trim().replace(/[%_[]/g, '[$&]')}%`).input('d', sql.Bit, includeDeleted).query(`
      SELECT a.account_id, a.account_code, a.name, a.mis_job_number, a.pending_mis_job_number, a.is_address_matching, a.is_testing, a.is_deleted, a.parent_account_id, par.account_code AS parent_code,
        (SELECT COUNT(*) FROM idoc.account s WHERE s.grouping_account_id = a.account_id AND s.is_deleted = 0) AS accounts,
        (SELECT COUNT(*) FROM idoc.brand b WHERE b.account_id = a.account_id) AS brands,
        (SELECT COUNT(*) FROM idoc.account_envelope e WHERE e.account_id = a.account_id AND e.is_deleted = 0) AS envelopes
      FROM idoc.account a
      LEFT JOIN idoc.account par ON par.account_id = a.parent_account_id
      WHERE a.grouping_account_id IS NULL AND (@d = 1 OR a.is_deleted = 0)
        AND (a.account_code LIKE @q ESCAPE '[' OR a.name LIKE @q ESCAPE '[' OR a.mis_job_number LIKE @q ESCAPE '[' OR a.pending_mis_job_number LIKE @q ESCAPE '[')
      ORDER BY a.name`)).recordset as R[];
    return rows.map((r) => ({
      id: r.account_id, code: r.account_code, name: r.name, misJobNumber: r.mis_job_number, pendingJobNumber: r.pending_mis_job_number ?? null, parentId: r.parent_account_id ?? null, parentCode: r.parent_code ?? null, isAddressMatching: !!r.is_address_matching, isTesting: !!r.is_testing, isDeleted: !!r.is_deleted,
      accountCount: r.accounts, brandCount: r.brands, envelopeCount: r.envelopes,
    }));
  }

  async get(id: number): Promise<CustomerDetail> {
    const q = (text: string) => this.pool.request().input('id', sql.Int, id).query(text);
    const [c, accts, brands, envs, match, seq, emails, kids] = await Promise.all([
      q(`SELECT a.*, bk.name AS batching_key, sk.name AS pack_sequence_key, par.account_id AS p_id, par.account_code AS p_code, par.name AS p_name FROM idoc.account a
         LEFT JOIN idoc.account par ON par.account_id = a.parent_account_id
         LEFT JOIN idoc.passthrough_key bk ON bk.passthrough_key_id = a.batching_key_id
         LEFT JOIN idoc.passthrough_key sk ON sk.passthrough_key_id = a.pack_sequence_key_id
         WHERE a.account_id = @id AND a.grouping_account_id IS NULL`),
      q('SELECT account_id, account_code, name, is_deleted FROM idoc.account WHERE grouping_account_id = @id ORDER BY account_code'),
      q(`SELECT b.brand_id, b.name,
           (SELECT COUNT(*) FROM idoc.account_envelope e WHERE e.brand_id = b.brand_id AND e.is_deleted = 0)
         + (SELECT COUNT(*) FROM idoc.stock_item s WHERE s.brand_id = b.brand_id)
         + (SELECT COUNT(*) FROM idoc.batch x WHERE x.brand_id = b.brand_id)
         + (SELECT COUNT(*) FROM idoc.mailpiece m WHERE m.brand_id = b.brand_id)
         + (SELECT COUNT(*) FROM idoc.pack p WHERE p.brand_id = b.brand_id) AS usage
         FROM idoc.brand b WHERE b.account_id = @id ORDER BY b.name`),
      q(`SELECT e.account_envelope_id, e.brand_id, b.name AS brand, e.delivery_band, e.postal_rate_id, e.outer_stock_item_id, e.external_name, e.reference, e.is_oversticker,
           pp.name AS provider, ps.name AS service, pf.name AS format, r.min_weight_g, r.max_weight_g, s.stock_code, s.description
         FROM idoc.account_envelope e
         JOIN idoc.postal_rate r ON r.postal_rate_id = e.postal_rate_id
         JOIN idoc.postal_service ps ON ps.postal_service_id = r.postal_service_id
         JOIN idoc.postal_provider pp ON pp.postal_provider_id = ps.postal_provider_id
         JOIN idoc.postal_format pf ON pf.postal_format_id = ps.postal_format_id
         JOIN idoc.stock_item s ON s.stock_item_id = e.outer_stock_item_id
         LEFT JOIN idoc.brand b ON b.brand_id = e.brand_id
         WHERE e.account_id = @id AND e.is_deleted = 0
         ORDER BY b.name, e.delivery_band, r.max_weight_g, e.reference`),
      q(`SELECT m.is_include, k.name, m.passthrough_value FROM idoc.address_match_rule m JOIN idoc.passthrough_key k ON k.passthrough_key_id = m.passthrough_key_id WHERE m.account_id = @id ORDER BY m.sequence_no`),
      q('SELECT passthrough_value, sequence_number FROM idoc.pack_sequence_rule WHERE account_id = @id ORDER BY sequence_number, passthrough_value'),
      q('SELECT email FROM idoc.account_notification_email WHERE account_id = @id ORDER BY email'),
      q('SELECT account_id, account_code, name, is_deleted FROM idoc.account WHERE parent_account_id = @id AND grouping_account_id IS NULL ORDER BY name'),
    ]);
    const a = c.recordset[0] as R | undefined;
    if (!a) throw new NotFoundError('Customer not found');
    const flags = {} as Record<FlagKey, boolean>;
    for (const f of FLAGS) flags[f] = !!a[FLAG_COLUMNS[f]];
    return {
      id: a.account_id, code: a.account_code, name: a.name, misJobNumber: a.mis_job_number, pendingJobNumber: a.pending_mis_job_number ?? null,
      jobNumberRolloverDay: a.job_number_rollover_day,
      pendingFrom: a.pending_job_number_from ? (a.pending_job_number_from as Date).toISOString().slice(0, 10) : null, returnAddress: a.return_address, colourMode: a.colour_mode ?? null, flags,
      batchingKey: a.batching_key, packSequenceKey: a.pack_sequence_key,
      parent: a.p_id ? { id: a.p_id, code: a.p_code, name: a.p_name } : null,
      children: (kids.recordset as R[]).map((r) => ({ id: r.account_id, code: r.account_code, name: r.name, isDeleted: !!r.is_deleted })),
      accounts: (accts.recordset as R[]).map((r) => ({ id: r.account_id, code: r.account_code, name: r.name, isDeleted: !!r.is_deleted })),
      brands: (brands.recordset as R[]).map((r) => ({ id: r.brand_id, name: r.name, usage: r.usage })),
      envelopes: (envs.recordset as R[]).map((r) => ({
        id: r.account_envelope_id, brandId: r.brand_id, brandName: r.brand, deliveryBand: r.delivery_band, postalRateId: r.postal_rate_id, rateLabel: rateLabel(r),
        stockItemId: r.outer_stock_item_id, stockCode: r.stock_code, stockDescription: r.description, reference: r.reference, externalName: r.external_name, isOversticker: !!r.is_oversticker,
      })),
      matchRules: (match.recordset as R[]).map((r) => ({ isInclude: !!r.is_include, key: r.name, value: r.passthrough_value })),
      sequenceRules: (seq.recordset as R[]).map((r) => ({ value: r.passthrough_value, number: r.sequence_number })),
      emails: (emails.recordset as R[]).map((r) => r.email),
    };
  }

  async lookups(): Promise<Lookups> {
    const [keys, bands, rates, custs, stock] = await Promise.all([
      this.pool.request().query('SELECT name FROM idoc.passthrough_key ORDER BY name'),
      this.pool.request().query(`SELECT DISTINCT delivery_band FROM idoc.account_envelope WHERE is_deleted = 0 ORDER BY delivery_band`),
      this.pool.request().query(`SELECT r.postal_rate_id, pp.name AS provider, ps.name AS service, pf.name AS format, r.min_weight_g, r.max_weight_g
        FROM idoc.postal_rate r JOIN idoc.postal_service ps ON ps.postal_service_id = r.postal_service_id
        JOIN idoc.postal_provider pp ON pp.postal_provider_id = ps.postal_provider_id JOIN idoc.postal_format pf ON pf.postal_format_id = ps.postal_format_id
        WHERE r.valid_from <= CAST(SYSUTCDATETIME() AS DATE) AND (r.valid_to IS NULL OR r.valid_to >= CAST(SYSUTCDATETIME() AS DATE))
        ORDER BY pp.name, ps.name, pf.rank_order, r.max_weight_g`),
      this.pool.request().query('SELECT account_id, account_code, name FROM idoc.account WHERE grouping_account_id IS NULL AND is_deleted = 0 ORDER BY name'),
      this.pool.request().query(`SELECT s.stock_item_id, s.stock_code, s.description, z.code AS size FROM idoc.stock_item s LEFT JOIN idoc.envelope_size z ON z.envelope_size_id = s.envelope_size_id
        WHERE s.is_envelope = 1 AND s.is_active = 1 AND s.envelope_size_id IS NOT NULL ORDER BY s.description`),
    ]);
    return {
      passthroughKeys: (keys.recordset as R[]).map((r) => r.name),
      customers: (custs.recordset as R[]).map((r) => ({ id: r.account_id, code: r.account_code, name: r.name })),
      deliveryBands: [...new Set(['1st Class', '2nd Class', ...(bands.recordset as R[]).map((r) => r.delivery_band as string)])].sort(),
      postalRates: (rates.recordset as R[]).map((r) => ({ id: r.postal_rate_id, label: rateLabel(r), format: r.format })),
      envelopeStock: (stock.recordset as R[]).map((r) => ({ id: r.stock_item_id, code: r.stock_code, description: r.description, size: r.size })),
    };
  }

  async create(input: { code: string; name: string }, by: string): Promise<number> {
    return this.tx(async (t) => {
      const id = (await this.req(t).input('c', sql.NVarChar(100), input.code).input('n', sql.NVarChar(200), input.name)
        .query('INSERT INTO idoc.account (account_code, name) OUTPUT INSERTED.account_id AS id VALUES (@c, @n)')).recordset[0].id as number;
      await this.audit(t, id, by, `Created customer ${input.code} "${input.name}"`);
      return id;
    }, `Account code "${input.code}" is already in use`);
  }

  async updateDetails(id: number, input: CustomerDetailsInput, by: string): Promise<void> {
    const old = await this.get(id);
    const parentCode = await this.checkParent(id, input.parentId);
    // A new pending number (or a new rollover day) starts on the next occurrence of the rollover day after today (London); an unchanged one keeps its date.
    const pendingFrom = input.pendingJobNumber === null ? null
      : input.pendingJobNumber === old.pendingJobNumber && input.jobNumberRolloverDay === old.jobNumberRolloverDay ? old.pendingFrom
        : (await this.pool.request().input('day', sql.Int, input.jobNumberRolloverDay).query(`
            SELECT CONVERT(CHAR(10), CASE WHEN c > d THEN c ELSE DATEADD(MONTH, 1, c) END, 23) AS f
            FROM (SELECT d, DATEFROMPARTS(YEAR(d), MONTH(d), @day) AS c
                  FROM (SELECT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'GMT Standard Time' AS DATE) AS d) t) x`)).recordset[0].f as string;
    const lines = describeDetailsChange(old, input, parentCode, pendingFrom);
    await this.tx(async (t) => {
      const req = this.req(t).input('id', sql.Int, id).input('par', sql.Int, input.parentId).input('code', sql.NVarChar(100), input.code).input('name', sql.NVarChar(200), input.name)
        .input('mis', sql.NVarChar(50), input.misJobNumber).input('pmis', sql.NVarChar(50), input.pendingJobNumber).input('rday', sql.TinyInt, input.jobNumberRolloverDay).input('pfrom', sql.NVarChar(10), pendingFrom).input('ret', sql.NVarChar(500), input.returnAddress)
        .input('bk', sql.Int, await this.keyId(t, input.batchingKey)).input('sk', sql.Int, await this.keyId(t, input.packSequenceKey));
      const sets = FLAGS.map((f) => { req.input(f, sql.Bit, input.flags[f]); return `${FLAG_COLUMNS[f]} = @${f}`; });
      await req.query(`UPDATE idoc.account SET parent_account_id = @par, account_code = @code, name = @name, mis_job_number = @mis, pending_mis_job_number = @pmis, pending_job_number_from = CAST(@pfrom AS DATE), job_number_rollover_day = @rday, return_address = @ret, batching_key_id = @bk, pack_sequence_key_id = @sk, ${sets.join(', ')} WHERE account_id = @id`);
      for (const l of lines) await this.audit(t, id, by, l);
    }, `Account code "${input.code}" is already in use`);
  }

  /** A parent must be another customer, never this customer or one of its descendants. Returns the parent's code. */
  private async checkParent(id: number, parentId: number | null): Promise<string | null> {
    if (parentId === null) return null;
    if (parentId === id) throw new ValidationError({ parentId: 'A customer cannot be its own parent' });
    const p = (await this.pool.request().input('p', sql.Int, parentId).query('SELECT account_code FROM idoc.account WHERE account_id = @p AND grouping_account_id IS NULL')).recordset[0] as R | undefined;
    if (!p) throw new ValidationError({ parentId: 'Parent customer not found' });
    const loop = await this.pool.request().input('p', sql.Int, parentId).input('id', sql.Int, id).query(`
      WITH up AS (
        SELECT account_id, parent_account_id FROM idoc.account WHERE account_id = @p
        UNION ALL
        SELECT a.account_id, a.parent_account_id FROM idoc.account a JOIN up ON a.account_id = up.parent_account_id)
      SELECT 1 AS x FROM up WHERE account_id = @id OPTION (MAXRECURSION 100)`);
    if (loop.recordset.length > 0) throw new ValidationError({ parentId: 'That customer is below this one in the hierarchy, so it cannot be its parent' });
    return p.account_code as string;
  }

  async addAccount(customerId: number, input: { code: string; name: string }, by: string): Promise<number> {
    await this.mustBeCustomer(undefined, customerId);
    return this.tx(async (t) => {
      const id = (await this.req(t).input('g', sql.Int, customerId).input('c', sql.NVarChar(100), input.code).input('n', sql.NVarChar(200), input.name)
        .query('INSERT INTO idoc.account (account_code, name, grouping_account_id) OUTPUT INSERTED.account_id AS id VALUES (@c, @n, @g)')).recordset[0].id as number;
      await this.audit(t, customerId, by, `Added account ${input.code} "${input.name}"`);
      return id;
    }, `Account code "${input.code}" is already in use`);
  }

  async updateAccount(accountId: number, input: { code: string; name: string; isDeleted: boolean }, by: string): Promise<void> {
    const cur = (await this.pool.request().input('id', sql.Int, accountId).query('SELECT grouping_account_id AS g, account_code, name FROM idoc.account WHERE account_id = @id AND grouping_account_id IS NOT NULL')).recordset[0] as R | undefined;
    if (!cur) throw new NotFoundError('Account not found');
    await this.tx(async (t) => {
      await this.req(t).input('id', sql.Int, accountId).input('c', sql.NVarChar(100), input.code).input('n', sql.NVarChar(200), input.name).input('d', sql.Bit, input.isDeleted)
        .query('UPDATE idoc.account SET account_code = @c, name = @n, is_deleted = @d WHERE account_id = @id');
      const was = `${cur.account_code} "${cur.name}"`;
      await this.audit(t, cur.g, by, input.isDeleted ? `Removed account ${was}` : `Updated account ${was} → ${input.code} "${input.name}"`);
    }, `Account code "${input.code}" is already in use`);
  }

  async addBrand(customerId: number, name: string, by: string): Promise<number> {
    await this.mustBeCustomer(undefined, customerId);
    return this.tx(async (t) => {
      const id = (await this.req(t).input('a', sql.Int, customerId).input('n', sql.NVarChar(200), name)
        .query('INSERT INTO idoc.brand (account_id, name) OUTPUT INSERTED.brand_id AS id VALUES (@a, @n)')).recordset[0].id as number;
      await this.audit(t, customerId, by, `Added brand "${name}"`);
      return id;
    }, `Brand "${name}" already exists for this customer`);
  }

  private async brand(brandId: number): Promise<R> {
    const b = (await this.pool.request().input('id', sql.Int, brandId).query('SELECT brand_id, account_id, name FROM idoc.brand WHERE brand_id = @id')).recordset[0] as R | undefined;
    if (!b) throw new NotFoundError('Brand not found');
    return b;
  }

  async renameBrand(brandId: number, name: string, by: string): Promise<void> {
    const b = await this.brand(brandId);
    await this.tx(async (t) => {
      await this.req(t).input('id', sql.Int, brandId).input('n', sql.NVarChar(200), name).query('UPDATE idoc.brand SET name = @n WHERE brand_id = @id');
      await this.audit(t, b.account_id, by, `Renamed brand "${b.name}" → "${name}"`);
    }, `Brand "${name}" already exists for this customer`);
  }

  async deleteBrand(brandId: number, by: string): Promise<void> {
    const b = await this.brand(brandId);
    const used = (await this.pool.request().input('id', sql.Int, brandId).query(`
      SELECT (SELECT COUNT(*) FROM idoc.account_envelope e WHERE e.brand_id = @id AND e.is_deleted = 0)
           + (SELECT COUNT(*) FROM idoc.stock_item s WHERE s.brand_id = @id)
           + (SELECT COUNT(*) FROM idoc.batch x WHERE x.brand_id = @id)
           + (SELECT COUNT(*) FROM idoc.mailpiece m WHERE m.brand_id = @id)
           + (SELECT COUNT(*) FROM idoc.pack p WHERE p.brand_id = @id) AS n`)).recordset[0].n as number;
    if (used > 0) throw new ConflictError(`Brand "${b.name}" is in use (${used} record${used === 1 ? '' : 's'} refer to it), so it cannot be deleted. Remove its envelope settings first.`);
    await this.tx(async (t) => {
      await this.req(t).input('id', sql.Int, brandId).query('UPDATE idoc.account_envelope SET brand_id = NULL WHERE brand_id = @id AND is_deleted = 1'); // removed settings keep no claim on the brand
      await this.req(t).input('id', sql.Int, brandId).query('DELETE FROM idoc.brand WHERE brand_id = @id');
      await this.audit(t, b.account_id, by, `Deleted brand "${b.name}"`);
    });
  }

  private async envelopeText(t: sql.Transaction, i: EnvelopeInput): Promise<string> {
    const r = (await this.req(t).input('b', sql.Int, i.brandId).input('r', sql.Int, i.postalRateId).input('s', sql.Int, i.stockItemId).query(`
      SELECT (SELECT name FROM idoc.brand WHERE brand_id = @b) AS brand,
             (SELECT description FROM idoc.stock_item WHERE stock_item_id = @s) AS stock,
             (SELECT pp.name AS provider, ps.name AS service, pf.name AS format, x.min_weight_g, x.max_weight_g
                FROM idoc.postal_rate x JOIN idoc.postal_service ps ON ps.postal_service_id = x.postal_service_id
                JOIN idoc.postal_provider pp ON pp.postal_provider_id = ps.postal_provider_id JOIN idoc.postal_format pf ON pf.postal_format_id = ps.postal_format_id
                WHERE x.postal_rate_id = @r FOR JSON PATH, WITHOUT_ARRAY_WRAPPER) AS rate`)).recordset[0] as R;
    if (!r.rate) throw new ValidationError({ postalRateId: 'Postal service and weight band not found' });
    if (!r.stock) throw new ValidationError({ stockItemId: 'Envelope not found' });
    return describeEnvelope(r.brand, i.deliveryBand, rateLabel(JSON.parse(r.rate)), r.stock);
  }

  /** The envelope must be envelope stock and the brand must belong to this customer. */
  private async checkEnvelope(t: sql.Transaction, customerId: number, i: EnvelopeInput): Promise<void> {
    const s = (await this.req(t).input('s', sql.Int, i.stockItemId).query('SELECT is_envelope FROM idoc.stock_item WHERE stock_item_id = @s')).recordset[0] as R | undefined;
    if (!s || !s.is_envelope) throw new ValidationError({ stockItemId: 'Choose an item of envelope stock' });
    if (i.brandId !== null) {
      const b = await this.req(t).input('b', sql.Int, i.brandId).input('a', sql.Int, customerId).query('SELECT 1 AS x FROM idoc.brand WHERE brand_id = @b AND account_id = @a');
      if (b.recordset.length === 0) throw new ValidationError({ brandId: 'That brand does not belong to this customer' });
    }
  }
  private static readonly ENV_DUP = 'There is already an envelope setting for this brand, delivery band, postal service and reference';

  async addEnvelope(customerId: number, i: EnvelopeInput, by: string): Promise<number> {
    await this.mustBeCustomer(undefined, customerId);
    return this.tx(async (t) => {
      await this.checkEnvelope(t, customerId, i);
      const id = (await this.req(t).input('a', sql.Int, customerId).input('b', sql.Int, i.brandId).input('d', sql.NVarChar(50), i.deliveryBand).input('r', sql.Int, i.postalRateId)
        .input('s', sql.Int, i.stockItemId).input('x', sql.NVarChar(200), i.externalName).input('f', sql.NVarChar(100), i.reference).input('o', sql.Bit, i.isOversticker)
        .query(`INSERT INTO idoc.account_envelope (account_id, brand_id, delivery_band, postal_rate_id, outer_stock_item_id, external_name, reference, is_oversticker)
                OUTPUT INSERTED.account_envelope_id AS id VALUES (@a, @b, @d, @r, @s, @x, @f, @o)`)).recordset[0].id as number;
      await this.audit(t, customerId, by, `Added envelope: ${await this.envelopeText(t, i)}`);
      return id;
    }, MssqlCustomerStore.ENV_DUP);
  }

  private async envelopeOwner(envelopeId: number): Promise<{ account: number; text: (t: sql.Transaction) => Promise<string> }> {
    const e = (await this.pool.request().input('id', sql.Int, envelopeId).query(
      'SELECT account_id, brand_id, delivery_band, postal_rate_id, outer_stock_item_id FROM idoc.account_envelope WHERE account_envelope_id = @id AND is_deleted = 0')).recordset[0] as R | undefined;
    if (!e) throw new NotFoundError('Envelope setting not found');
    const was: EnvelopeInput = { brandId: e.brand_id, deliveryBand: e.delivery_band, postalRateId: e.postal_rate_id, stockItemId: e.outer_stock_item_id, reference: null, externalName: null, isOversticker: false };
    return { account: e.account_id, text: (t) => this.envelopeText(t, was) };
  }

  async updateEnvelope(envelopeId: number, i: EnvelopeInput, by: string): Promise<void> {
    const cur = await this.envelopeOwner(envelopeId);
    await this.tx(async (t) => {
      await this.checkEnvelope(t, cur.account, i);
      const was = await cur.text(t);
      await this.req(t).input('id', sql.Int, envelopeId).input('b', sql.Int, i.brandId).input('d', sql.NVarChar(50), i.deliveryBand).input('r', sql.Int, i.postalRateId)
        .input('s', sql.Int, i.stockItemId).input('x', sql.NVarChar(200), i.externalName).input('f', sql.NVarChar(100), i.reference).input('o', sql.Bit, i.isOversticker)
        .query(`UPDATE idoc.account_envelope SET brand_id = @b, delivery_band = @d, postal_rate_id = @r, outer_stock_item_id = @s, external_name = @x, reference = @f, is_oversticker = @o WHERE account_envelope_id = @id`);
      await this.audit(t, cur.account, by, `Changed envelope: ${was} → ${await this.envelopeText(t, i)}`);
    }, MssqlCustomerStore.ENV_DUP);
  }

  async deleteEnvelope(envelopeId: number, by: string): Promise<void> {
    const cur = await this.envelopeOwner(envelopeId);
    await this.tx(async (t) => {
      const was = await cur.text(t);
      await this.req(t).input('id', sql.Int, envelopeId).query('UPDATE idoc.account_envelope SET is_deleted = 1 WHERE account_envelope_id = @id');
      await this.audit(t, cur.account, by, `Removed envelope: ${was}`);
    });
  }

  async setMatchRules(customerId: number, rules: MatchRule[], by: string): Promise<void> {
    const was = describeMatchRules((await this.get(customerId)).matchRules);
    await this.tx(async (t) => {
      await this.req(t).input('a', sql.Int, customerId).query('DELETE FROM idoc.address_match_rule WHERE account_id = @a');
      for (const [n, r] of rules.entries()) {
        await this.req(t).input('a', sql.Int, customerId).input('n', sql.Int, n + 1).input('i', sql.Bit, r.isInclude).input('k', sql.Int, await this.keyId(t, r.key)).input('v', sql.NVarChar(400), r.value)
          .query('INSERT INTO idoc.address_match_rule (account_id, sequence_no, is_include, passthrough_key_id, passthrough_value) VALUES (@a, @n, @i, @k, @v)');
      }
      const now = describeMatchRules(rules);
      if (was !== now) await this.audit(t, customerId, by, `Address-matching rules: ${was} → ${now}`);
    });
  }

  async setSequenceRules(customerId: number, rules: SequenceRule[], by: string): Promise<void> {
    const was = describeSequenceRules((await this.get(customerId)).sequenceRules);
    await this.tx(async (t) => {
      await this.req(t).input('a', sql.Int, customerId).query('DELETE FROM idoc.pack_sequence_rule WHERE account_id = @a');
      for (const r of rules) {
        await this.req(t).input('a', sql.Int, customerId).input('v', sql.NVarChar(400), r.value).input('n', sql.Int, r.number)
          .query('INSERT INTO idoc.pack_sequence_rule (account_id, passthrough_value, sequence_number) VALUES (@a, @v, @n)');
      }
      const now = describeSequenceRules(rules);
      if (was !== now) await this.audit(t, customerId, by, `Pack sequence: ${was} → ${now}`);
    });
  }

  async setEmails(customerId: number, emails: string[], by: string): Promise<void> {
    const was = (await this.get(customerId)).emails.join(', ') || 'none';
    await this.tx(async (t) => {
      await this.req(t).input('a', sql.Int, customerId).query('DELETE FROM idoc.account_notification_email WHERE account_id = @a');
      for (const e of emails) await this.req(t).input('a', sql.Int, customerId).input('e', sql.NVarChar(320), e).query('INSERT INTO idoc.account_notification_email (account_id, email) VALUES (@a, @e)');
      const now = emails.join(', ') || 'none';
      if (was !== now) await this.audit(t, customerId, by, `Notification e-mails: ${was} → ${now}`);
    });
  }

  /** Same statement as ingest/src/mssql/jobNumbers.ts, which the watcher and the run sheet command use. */
  async applyDuePending(): Promise<number> {
    const r = await this.pool.request().query(`
      SET XACT_ABORT ON;
      BEGIN TRAN;
      DECLARE @moved TABLE (account_id INT, old_job NVARCHAR(50), new_job NVARCHAR(50));
      UPDATE idoc.account
         SET mis_job_number = pending_mis_job_number, pending_mis_job_number = NULL, pending_job_number_from = NULL
      OUTPUT inserted.account_id, deleted.mis_job_number, inserted.mis_job_number INTO @moved (account_id, old_job, new_job)
       WHERE pending_mis_job_number IS NOT NULL
         AND pending_job_number_from <= CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'GMT Standard Time' AS DATE);
      INSERT INTO idoc.audit_log (changed_by, entity, entity_id, summary)
      SELECT N'system', N'customer', account_id,
             CONCAT(N'Job number: ', COALESCE(N'"' + old_job + N'"', N'(none)'), N' → "', new_job, N'" (the pending job number took effect)')
        FROM @moved;
      SELECT COUNT(*) AS moved FROM @moved;
      COMMIT;`);
    return Number(r.recordset[0].moved);
  }

  async history(customerId: number, limit: number): Promise<AuditEntry[]> {
    const rows = (await this.pool.request().input('c', sql.BigInt, customerId).input('n', sql.Int, limit)
      .query(`SELECT TOP (@n) audit_id, changed_at, changed_by, summary FROM idoc.audit_log WHERE entity = N'customer' AND entity_id = @c ORDER BY audit_id DESC`)).recordset as R[];
    return rows.map((r) => ({ id: Number(r.audit_id), changedAt: (r.changed_at as Date).toISOString(), changedBy: r.changed_by, summary: r.summary }));
  }
}
