import sql from 'mssql';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { describeBecameCustomer, describeBecameSubAccount, describeDetailsChange, describeEnvelope, describeInsert, describeInsertChange, describeMode, describeLeftAsCustomer, describeMatchRules, describeSequenceRules, describeSubAccountOf, noChildCustomers } from './describe.js';
import {
  FLAGS, SETTINGS, marginOf, type AuditEntry, type InheritedInsertView, type InsertInput, type InsertView, type ColourMode, type CustomerDetail, type CustomerDetailsInput, type CustomerRow, type CustomerStore, type EnvelopeInput, type InheritMode, type FlagKey, type InheritedEnvelopeView, type InheritedSettings, type Lookups, type MatchRule, type ParentView, type SequenceRule, type SettingKey, type Modes,
} from './types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;

const FLAG_COLUMNS: Record<FlagKey, string> = {
  isAddressMatching: 'is_address_matching', isArchiveMailpieces: 'is_archive_mailpieces', isCreateOutputFiles: 'is_create_output_files',
  isSso: 'is_sso', isSameDayService: 'is_same_day_service',
  isUseMrdf: 'is_use_mrdf', isTesting: 'is_testing', isDeleted: 'is_deleted',
};

const MODE_COLUMNS: Record<SettingKey, string> = { envelopes: 'envelopes_mode', brands: 'brands_mode', matching: 'matching_mode', sequence: 'sequence_mode', emails: 'emails_mode', inserts: 'inserts_mode' };
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
    const r = await this.req(t).input('id', sql.Int, id).query('SELECT 1 AS x FROM idoc.account WHERE account_id = @id AND inherits_settings = 0');
    if (r.recordset.length === 0) throw new NotFoundError('Customer not found');
  }

  async list(search: string, includeDeleted: boolean): Promise<CustomerRow[]> {
    const rows = (await this.pool.request().input('q', sql.NVarChar(200), `%${search.trim().replace(/[%_[]/g, '[$&]')}%`).input('d', sql.Bit, includeDeleted).query(`
      SELECT a.account_id, a.account_code, a.name, a.mis_job_number, a.pending_mis_job_number, a.is_address_matching, a.is_use_mrdf, a.is_sso, a.is_testing, a.is_deleted, a.parent_account_id, par.account_code AS parent_code,
        (SELECT COUNT(*) FROM idoc.v_account_owner o JOIN idoc.account s ON s.account_id = o.account_id WHERE o.owner_account_id = a.account_id AND o.account_id <> a.account_id AND s.is_deleted = 0) AS accounts,
        (SELECT COUNT(*) FROM idoc.brand b WHERE b.account_id = a.account_id) AS brands,
        (SELECT COUNT(*) FROM idoc.account_envelope e WHERE e.account_id = a.account_id AND e.is_deleted = 0) AS envelopes
      FROM idoc.account a
      LEFT JOIN idoc.account par ON par.account_id = a.parent_account_id
      WHERE a.inherits_settings = 0 AND (@d = 1 OR a.is_deleted = 0)
        AND (a.account_code LIKE @q ESCAPE '[' OR a.name LIKE @q ESCAPE '[' OR a.mis_job_number LIKE @q ESCAPE '[' OR a.pending_mis_job_number LIKE @q ESCAPE '[')
      ORDER BY a.name`)).recordset as R[];
    return rows.map((r) => ({
      id: r.account_id, code: r.account_code, name: r.name, misJobNumber: r.mis_job_number, pendingJobNumber: r.pending_mis_job_number ?? null, parentId: r.parent_account_id ?? null, parentCode: r.parent_code ?? null, isAddressMatching: !!r.is_address_matching, isUseMrdf: !!r.is_use_mrdf, isSso: !!r.is_sso, isTesting: !!r.is_testing, isDeleted: !!r.is_deleted,
      accountCount: r.accounts, brandCount: r.brands, envelopeCount: r.envelopes,
    }));
  }

  async get(id: number): Promise<CustomerDetail> {
    const q = (text: string) => this.pool.request().input('id', sql.Int, id).query(text);
    const [c, accts, brands, envs, match, seq, emails, kids, invOpts, inheritedRows, inhBrands, inhRules, inhSeq, inhEmails, inhSingles] = await Promise.all([
      q(`SELECT a.*, bk.name AS batching_key, sk.name AS pack_sequence_key, par.account_id AS p_id, par.account_code AS p_code, par.name AS p_name, inv.account_id AS i_id, inv.account_code AS i_code, inv.name AS i_name FROM idoc.account a
         LEFT JOIN idoc.account par ON par.account_id = a.parent_account_id
         LEFT JOIN idoc.account inv ON inv.account_id = a.invoicing_account_id
         LEFT JOIN idoc.passthrough_key bk ON bk.passthrough_key_id = a.batching_key_id
         LEFT JOIN idoc.passthrough_key sk ON sk.passthrough_key_id = a.pack_sequence_key_id
         WHERE a.account_id = @id AND a.inherits_settings = 0`),
      q('SELECT s.account_id, s.account_code, s.name, s.is_deleted FROM idoc.v_account_owner o JOIN idoc.account s ON s.account_id = o.account_id WHERE o.owner_account_id = @id AND o.account_id <> @id ORDER BY s.account_code'),
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
      q('SELECT account_id, account_code, name, is_deleted FROM idoc.account WHERE parent_account_id = @id AND inherits_settings = 0 ORDER BY name'),
      q(`WITH up AS (
           SELECT account_id, account_code, name, parent_account_id, 0 AS depth FROM idoc.account WHERE account_id = @id
           UNION ALL
           SELECT a.account_id, a.account_code, a.name, a.parent_account_id, up.depth + 1 FROM idoc.account a JOIN up ON a.account_id = up.parent_account_id)
         SELECT account_id, account_code, name FROM up ORDER BY depth OPTION (MAXRECURSION 100)`),
      // envelope rows that come from the parents, nearest first (rows of this account itself are in `envs`)
      q(`SELECT e.account_envelope_id, e.brand_id, b.name AS brand, e.delivery_band, e.postal_rate_id, e.outer_stock_item_id, e.external_name, e.reference, e.is_oversticker,
           pp.name AS provider, ps.name AS service, pf.name AS format, r.min_weight_g, r.max_weight_g, s.stock_code, s.description,
           sa.account_id AS from_id, sa.account_code AS from_code, sa.name AS from_name, src.depth
         FROM idoc.v_account_envelope_source src
         JOIN idoc.account sa ON sa.account_id = src.source_account_id
         JOIN idoc.account_envelope e ON e.account_id = src.source_account_id
         JOIN idoc.postal_rate r ON r.postal_rate_id = e.postal_rate_id
         JOIN idoc.postal_service ps ON ps.postal_service_id = r.postal_service_id
         JOIN idoc.postal_provider pp ON pp.postal_provider_id = ps.postal_provider_id
         JOIN idoc.postal_format pf ON pf.postal_format_id = ps.postal_format_id
         JOIN idoc.stock_item s ON s.stock_item_id = e.outer_stock_item_id
         LEFT JOIN idoc.brand b ON b.brand_id = e.brand_id
         WHERE src.account_id = @id AND src.source_account_id <> @id AND e.is_deleted = 0
         ORDER BY src.depth, b.name, e.delivery_band, r.max_weight_g, e.reference`),
      // the other groups: rows that come from the parents, nearest first
      q(`SELECT x.name, src.depth, sa.account_id AS from_id, sa.account_code AS from_code, sa.name AS from_name
         FROM idoc.v_account_setting_source src JOIN idoc.account sa ON sa.account_id = src.source_account_id JOIN idoc.brand x ON x.account_id = src.source_account_id
         WHERE src.account_id = @id AND src.setting = N'brands' AND src.source_account_id <> @id ORDER BY src.depth, x.name`),
      q(`SELECT m.is_include, k.name, m.passthrough_value, src.depth, sa.account_id AS from_id, sa.account_code AS from_code, sa.name AS from_name
         FROM idoc.v_account_setting_source src JOIN idoc.account sa ON sa.account_id = src.source_account_id
         JOIN idoc.address_match_rule m ON m.account_id = src.source_account_id JOIN idoc.passthrough_key k ON k.passthrough_key_id = m.passthrough_key_id
         WHERE src.account_id = @id AND src.setting = N'matching' AND src.source_account_id <> @id ORDER BY src.depth, m.sequence_no`),
      q(`SELECT x.passthrough_value, x.sequence_number, src.depth, sa.account_id AS from_id, sa.account_code AS from_code, sa.name AS from_name
         FROM idoc.v_account_setting_source src JOIN idoc.account sa ON sa.account_id = src.source_account_id JOIN idoc.pack_sequence_rule x ON x.account_id = src.source_account_id
         WHERE src.account_id = @id AND src.setting = N'sequence' AND src.source_account_id <> @id ORDER BY src.depth, x.sequence_number, x.passthrough_value`),
      q(`SELECT x.email, src.depth, sa.account_id AS from_id, sa.account_code AS from_code, sa.name AS from_name
         FROM idoc.v_account_setting_source src JOIN idoc.account sa ON sa.account_id = src.source_account_id JOIN idoc.account_notification_email x ON x.account_id = src.source_account_id
         WHERE src.account_id = @id AND src.setting = N'emails' AND src.source_account_id <> @id ORDER BY src.depth, x.email`),
      // the single values (address matching, batching key, pack sequence key) of the nearest source of the matching and sequence groups
      q(`SELECT src.setting, src.depth, a.is_address_matching, bk.name AS batching_key, sk.name AS seq_key, a.account_id AS from_id, a.account_code AS from_code, a.name AS from_name
         FROM idoc.v_account_setting_source src JOIN idoc.account a ON a.account_id = src.source_account_id
         LEFT JOIN idoc.passthrough_key bk ON bk.passthrough_key_id = a.batching_key_id LEFT JOIN idoc.passthrough_key sk ON sk.passthrough_key_id = a.pack_sequence_key_id
         WHERE src.account_id = @id AND src.setting IN (N'matching', N'sequence') ORDER BY src.depth`),
    ]);
    const a = c.recordset[0] as R | undefined;
    if (!a) throw new NotFoundError('Customer not found');
    const flags = {} as Record<FlagKey, boolean>;
    for (const f of FLAGS) flags[f] = !!a[FLAG_COLUMNS[f]];
    const { own: inserts, inherited: inheritedInserts } = await this.insertsOf(id);
    return {
      id: a.account_id, code: a.account_code, name: a.name, misJobNumber: a.mis_job_number, pendingJobNumber: a.pending_mis_job_number ?? null,
      jobNumberRolloverDay: a.job_number_rollover_day,
      pendingFrom: a.pending_job_number_from ? (a.pending_job_number_from as Date).toISOString().slice(0, 10) : null, returnAddress: a.return_address, archiveCustomerTag: a.archive_customer_tag, archiveProviderTag: a.archive_provider_tag, archiveDirectoryTag: a.archive_directory_tag, logo1: a.logo1, logo2: a.logo2, colourMode: a.colour_mode as ColourMode, flags,
      batchingKey: a.batching_key, packSequenceKey: a.pack_sequence_key,
      parent: a.p_id ? { id: a.p_id, code: a.p_code, name: a.p_name } : null,
      invoicing: a.i_id ? { id: a.i_id, code: a.i_code, name: a.i_name } : null,
      invoicingOptions: (invOpts.recordset as R[]).map((r) => ({ id: r.account_id, code: r.account_code, name: r.name })),
      children: (kids.recordset as R[]).map((r) => ({ id: r.account_id, code: r.account_code, name: r.name, isDeleted: !!r.is_deleted })),
      accounts: (accts.recordset as R[]).map((r) => ({ id: r.account_id, code: r.account_code, name: r.name, isDeleted: !!r.is_deleted })),
      brands: (brands.recordset as R[]).map((r) => ({ id: r.brand_id, name: r.name, usage: r.usage })),
      envelopes: (envs.recordset as R[]).map((r) => ({
        id: r.account_envelope_id, brandId: r.brand_id, brandName: r.brand, deliveryBand: r.delivery_band, postalRateId: r.postal_rate_id, rateLabel: rateLabel(r),
        stockItemId: r.outer_stock_item_id, stockCode: r.stock_code, stockDescription: r.description, reference: r.reference, externalName: r.external_name, isOversticker: !!r.is_oversticker,
      })),
      modes: Object.fromEntries(SETTINGS.map((k) => [k, a[MODE_COLUMNS[k]] as InheritMode])) as Modes,
      inserts, inheritedInserts,
      inheritedEnvelopes: this.inherited(inheritedRows.recordset as R[], (envs.recordset as R[])),
      inherited: this.inheritedSettings(a, { brands: brands.recordset, match: match.recordset, seq: seq.recordset, emails: emails.recordset }, { brands: inhBrands.recordset, rules: inhRules.recordset, seq: inhSeq.recordset, emails: inhEmails.recordset, singles: inhSingles.recordset }),
      matchRules: (match.recordset as R[]).map((r) => ({ isInclude: !!r.is_include, key: r.name, value: r.passthrough_value })),
      sequenceRules: (seq.recordset as R[]).map((r) => ({ value: r.passthrough_value, number: r.sequence_number })),
      emails: (emails.recordset as R[]).map((r) => r.email),
    };
  }

  private static readonly INSERT_SELECT = `SELECT s.stock_item_id, s.stock_code, s.brand_id, b.name AS brand, s.reference, s.description, s.hpod_guid, s.insert_size_id, z.name AS size,
      CAST(s.width_mm AS FLOAT) AS width_mm, CAST(s.height_mm AS FLOAT) AS height_mm, CAST(s.thickness_mm AS FLOAT) AS thickness_mm, CAST(s.weight_g AS FLOAT) AS weight_g,
      s.is_chargeable, CAST(s.cost_price AS FLOAT) AS cost_price, CAST(s.sell_price AS FLOAT) AS sell_price, s.parent_stock_item_id, p.stock_code AS parent_code, p.description AS parent_description,
      s.account_id AS owner_id`;
  private static readonly INSERT_FROM = `FROM idoc.stock_item s LEFT JOIN idoc.brand b ON b.brand_id = s.brand_id LEFT JOIN idoc.insert_size z ON z.insert_size_id = s.insert_size_id
      LEFT JOIN idoc.stock_item p ON p.stock_item_id = s.parent_stock_item_id`;

  private insertView(r: R, linked: Map<number, number[]>): InsertView {
    const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
    const cost = num(r.cost_price), sell = num(r.sell_price);
    return {
      id: r.stock_item_id, stockCode: r.stock_code, brandId: r.brand_id, brandName: r.brand, reference: r.reference, description: r.description,
      hpodGuid: r.hpod_guid ? String(r.hpod_guid).toLowerCase() : null, insertSizeId: r.insert_size_id, sizeName: r.size, widthMm: num(r.width_mm), heightMm: num(r.height_mm),
      thicknessMm: Number(r.thickness_mm), weightG: Number(r.weight_g), isChargeable: !!r.is_chargeable, costPrice: cost, sellPrice: sell, margin: marginOf(cost, sell),
      linkedIds: linked.get(r.stock_item_id) ?? [], parent: r.parent_stock_item_id === null ? null : { id: r.parent_stock_item_id, stockCode: r.parent_code, description: r.parent_description },
    };
  }

  /** This customer's own inserts, and the inserts of the parents that its inserts setting takes in (nearest first). */
  private async insertsOf(id: number): Promise<{ own: InsertView[]; inherited: InheritedInsertView[] }> {
    const [own, inh, kids] = await Promise.all([
      this.pool.request().input('id', sql.Int, id).query(`${MssqlCustomerStore.INSERT_SELECT} ${MssqlCustomerStore.INSERT_FROM}
        WHERE s.account_id = @id AND s.is_insert = 1 AND s.is_active = 1 ORDER BY b.name, s.stock_code`),
      this.pool.request().input('id', sql.Int, id).query(`${MssqlCustomerStore.INSERT_SELECT}, sa.account_code AS from_code, sa.name AS from_name, src.depth
        ${MssqlCustomerStore.INSERT_FROM} JOIN idoc.v_account_setting_source src ON src.source_account_id = s.account_id AND src.setting = N'inserts' JOIN idoc.account sa ON sa.account_id = s.account_id
        WHERE src.account_id = @id AND src.source_account_id <> @id AND s.is_insert = 1 AND s.is_active = 1 ORDER BY src.depth, b.name, s.stock_code`),
      this.pool.request().input('id', sql.Int, id).query(`SELECT c.parent_stock_item_id AS parent_id, c.stock_item_id AS child_id FROM idoc.stock_item c JOIN idoc.stock_item pr ON pr.stock_item_id = c.parent_stock_item_id
        WHERE c.is_active = 1 AND c.is_insert = 1 AND (pr.account_id = @id OR pr.account_id IN (SELECT source_account_id FROM idoc.v_account_setting_source WHERE account_id = @id AND setting = N'inserts'))
        ORDER BY c.stock_code`),
    ]);
    const linked = new Map<number, number[]>();
    for (const k of kids.recordset as R[]) linked.set(k.parent_id, [...(linked.get(k.parent_id) ?? []), k.child_id]);
    return {
      own: (own.recordset as R[]).map((r) => this.insertView(r, linked)),
      inherited: (inh.recordset as R[]).map((r) => ({ ...this.insertView(r, linked), from: { id: r.owner_id, code: r.from_code, name: r.from_name } })),
    };
  }

  /** The brand and size must exist and belong where they should, the code and H-POD GUID must be unused, and each linked insert must be one of this customer's that is free to be linked. */
  private async checkInsert(t: sql.Transaction, customerId: number, i: InsertInput, selfId: number | null): Promise<void> {
    const errs: Record<string, string> = {};
    if (i.brandId !== null && (await this.req(t).input('b', sql.Int, i.brandId).input('a', sql.Int, customerId).query('SELECT 1 AS x FROM idoc.brand WHERE brand_id = @b AND account_id = @a')).recordset.length === 0) errs['brandId'] = 'That brand does not belong to this customer';
    if (i.insertSizeId !== null && (await this.req(t).input('z', sql.Int, i.insertSizeId).query('SELECT 1 AS x FROM idoc.insert_size WHERE insert_size_id = @z')).recordset.length === 0) errs['insertSizeId'] = 'Size not found';
    if (Object.keys(errs).length) throw new ValidationError(errs);
    const code = await this.req(t).input('c', sql.NVarChar(50), i.stockCode).input('s', sql.Int, selfId).query('SELECT 1 AS x FROM idoc.stock_item WHERE stock_code = @c AND (@s IS NULL OR stock_item_id <> @s)');
    if (code.recordset.length) throw new ConflictError(`Stock code ${i.stockCode} is already in use`);
    if (i.hpodGuid !== null) {
      const g = await this.req(t).input('g', sql.UniqueIdentifier, i.hpodGuid).input('s', sql.Int, selfId).query('SELECT 1 AS x FROM idoc.stock_item WHERE hpod_guid = @g AND (@s IS NULL OR stock_item_id <> @s)');
      if (g.recordset.length) throw new ConflictError('That H-POD GUID is already used by another insert');
    }
    if (i.linkedIds.length === 0) return;
    const self = selfId === null ? null : ((await this.req(t).input('s', sql.Int, selfId).query('SELECT parent_stock_item_id FROM idoc.stock_item WHERE stock_item_id = @s')).recordset[0] as R | undefined) ?? null;
    if (self && self.parent_stock_item_id !== null) throw new ValidationError({ linkedIds: 'This insert is itself linked under another insert, so it cannot have linked inserts of its own' });
    for (const l of i.linkedIds) {
      const c = (await this.req(t).input('l', sql.Int, l).query(`SELECT c.stock_code, c.account_id, c.parent_stock_item_id, c.is_insert, c.is_active,
        (SELECT COUNT(*) FROM idoc.stock_item k WHERE k.parent_stock_item_id = c.stock_item_id AND k.is_active = 1) AS children FROM idoc.stock_item c WHERE c.stock_item_id = @l`)).recordset[0] as R | undefined;
      if (!c || !c.is_insert || !c.is_active || c.account_id !== customerId || l === selfId) throw new ValidationError({ linkedIds: 'Linked inserts must be other inserts of this customer' });
      if (c.children > 0) throw new ValidationError({ linkedIds: `${c.stock_code} has linked inserts of its own, so it cannot be linked under another` });
      if (c.parent_stock_item_id !== null && c.parent_stock_item_id !== selfId) throw new ValidationError({ linkedIds: `${c.stock_code} is already linked under another insert` });
    }
  }
  private async setLinks(t: sql.Transaction, parentId: number, ids: number[]): Promise<void> {
    await this.req(t).input('p', sql.Int, parentId).query('UPDATE idoc.stock_item SET parent_stock_item_id = NULL WHERE parent_stock_item_id = @p');
    for (const c of ids) await this.req(t).input('p', sql.Int, parentId).input('c', sql.Int, c).query('UPDATE idoc.stock_item SET parent_stock_item_id = @p WHERE stock_item_id = @c');
  }
  private insertInputs(r: sql.Request, i: InsertInput): sql.Request {
    return r.input('b', sql.Int, i.brandId).input('code', sql.NVarChar(50), i.stockCode).input('ref', sql.NVarChar(200), i.reference).input('d', sql.NVarChar(300), i.description)
      .input('g', sql.UniqueIdentifier, i.hpodGuid).input('z', sql.Int, i.insertSizeId).input('w', sql.Decimal(7, 2), i.widthMm).input('h', sql.Decimal(7, 2), i.heightMm)
      .input('th', sql.Decimal(6, 2), i.thicknessMm).input('wt', sql.Decimal(8, 2), i.weightG).input('ch', sql.Bit, i.isChargeable)
      .input('cost', sql.Decimal(10, 4), i.costPrice).input('sell', sql.Decimal(10, 4), i.sellPrice);
  }

  async addInsert(customerId: number, i: InsertInput, by: string): Promise<number> {
    await this.mustBeCustomer(undefined, customerId);
    return this.tx(async (t) => {
      await this.checkInsert(t, customerId, i, null);
      const id = (await this.insertInputs(this.req(t).input('a', sql.Int, customerId), i).query(
        `INSERT INTO idoc.stock_item (account_id, brand_id, stock_code, reference, description, hpod_guid, insert_size_id, width_mm, height_mm, thickness_mm, weight_g, is_chargeable, cost_price, sell_price, is_insert)
         OUTPUT INSERTED.stock_item_id AS id VALUES (@a, @b, @code, @ref, @d, @g, @z, @w, @h, @th, @wt, @ch, @cost, @sell, 1)`)).recordset[0].id as number;
      await this.setLinks(t, id, i.linkedIds);
      await this.audit(t, customerId, by, `Added insert: ${describeInsert(i)}`);
      return id;
    }, 'That stock code or H-POD GUID is already in use');
  }

  private async insertOwner(insertId: number): Promise<{ account: number; was: InsertInput; names: { brand: string | null; size: string | null } }> {
    const r = (await this.pool.request().input('id', sql.Int, insertId).query(`${MssqlCustomerStore.INSERT_SELECT} ${MssqlCustomerStore.INSERT_FROM} WHERE s.stock_item_id = @id AND s.is_insert = 1 AND s.is_active = 1`)).recordset[0] as R | undefined;
    if (!r) throw new NotFoundError('Insert not found');
    const kids = (await this.pool.request().input('id', sql.Int, insertId).query('SELECT stock_item_id FROM idoc.stock_item WHERE parent_stock_item_id = @id AND is_active = 1 ORDER BY stock_item_id')).recordset as R[];
    const v = this.insertView(r, new Map([[insertId, kids.map((k) => k.stock_item_id as number)]]));
    return { account: r.owner_id, names: { brand: v.brandName, size: v.sizeName }, was: {
      stockCode: v.stockCode ?? '', brandId: v.brandId, reference: v.reference, description: v.description, hpodGuid: v.hpodGuid, insertSizeId: v.insertSizeId, widthMm: v.widthMm, heightMm: v.heightMm,
      thicknessMm: v.thicknessMm, weightG: v.weightG, isChargeable: v.isChargeable, costPrice: v.costPrice, sellPrice: v.sellPrice, linkedIds: v.linkedIds } };
  }
  private async namesOf(t: sql.Transaction, i: InsertInput): Promise<{ brand: string | null; size: string | null }> {
    const r = (await this.req(t).input('b', sql.Int, i.brandId).input('z', sql.Int, i.insertSizeId).query(
      'SELECT (SELECT name FROM idoc.brand WHERE brand_id = @b) AS brand, (SELECT name FROM idoc.insert_size WHERE insert_size_id = @z) AS size')).recordset[0] as R;
    return { brand: r.brand, size: r.size };
  }

  async updateInsert(insertId: number, i: InsertInput, by: string): Promise<void> {
    const cur = await this.insertOwner(insertId);
    await this.tx(async (t) => {
      await this.checkInsert(t, cur.account, i, insertId);
      await this.insertInputs(this.req(t).input('id', sql.Int, insertId), i).query(
        `UPDATE idoc.stock_item SET brand_id = @b, stock_code = @code, reference = @ref, description = @d, hpod_guid = @g, insert_size_id = @z, width_mm = @w, height_mm = @h,
           thickness_mm = @th, weight_g = @wt, is_chargeable = @ch, cost_price = @cost, sell_price = @sell WHERE stock_item_id = @id`);
      await this.setLinks(t, insertId, i.linkedIds);
      const changes = describeInsertChange(cur.was, i, { was: cur.names, next: await this.namesOf(t, i) });
      if (changes.length) await this.audit(t, cur.account, by, `Changed insert ${i.stockCode}: ${changes.join('; ')}`);
    }, 'That stock code or H-POD GUID is already in use');
  }

  async deleteInsert(insertId: number, by: string): Promise<void> {
    const cur = await this.insertOwner(insertId);
    await this.tx(async (t) => {
      // Retired, not deleted: jobs that used the insert keep it. Its links go with it.
      await this.req(t).input('id', sql.Int, insertId).query('UPDATE idoc.stock_item SET is_active = 0, parent_stock_item_id = NULL WHERE stock_item_id = @id');
      await this.req(t).input('id', sql.Int, insertId).query('UPDATE idoc.stock_item SET parent_stock_item_id = NULL WHERE parent_stock_item_id = @id');
      await this.audit(t, cur.account, by, `Removed insert: ${describeInsert(cur.was)}`);
    });
  }

  /** Parent envelope rows as views; a nearer entry, or this customer's own, with the same brand name, band, rate and reference replaces a further one. */
  private inherited(rows: R[], own: R[]): InheritedEnvelopeView[] {
    const key = (r: R): string => `${(r.brand ?? '').toLowerCase()}|${String(r.delivery_band).toLowerCase()}|${r.postal_rate_id}|${(r.reference ?? '').toLowerCase()}`;
    const seen = new Set(own.map(key)); const out: InheritedEnvelopeView[] = [];
    for (const r of rows) {
      const k = key(r); if (seen.has(k)) continue; seen.add(k);
      out.push({
        id: r.account_envelope_id, brandId: r.brand_id, brandName: r.brand, deliveryBand: r.delivery_band, postalRateId: r.postal_rate_id, rateLabel: rateLabel(r),
        stockItemId: r.outer_stock_item_id, stockCode: r.stock_code, stockDescription: r.description, reference: r.reference, externalName: r.external_name, isOversticker: !!r.is_oversticker,
        from: { id: r.from_id, code: r.from_code, name: r.from_name },
      });
    }
    return out;
  }

  /** What the parents add to each list (a nearer entry, or this customer's own, with the same key replaces a further one) and, for INHERIT, the single values. */
  private inheritedSettings(a: R, own: { brands: R[]; match: R[]; seq: R[]; emails: R[] }, from: { brands: R[]; rules: R[]; seq: R[]; emails: R[]; singles: R[] }): InheritedSettings {
    const src = (r: R): ParentView => ({ id: r.from_id, code: r.from_code, name: r.from_name });
    const pick = <T>(rows: R[], key: (r: R) => string, ownKeys: string[], make: (r: R) => T): T[] => {
      const seen = new Set(ownKeys); const out: T[] = [];
      for (const r of rows) { const k = key(r); if (seen.has(k)) continue; seen.add(k); out.push(make(r)); }
      return out;
    };
    const ruleKey = (inc: boolean, key: string, value: string | null): string => `${inc}|${key.toLowerCase()}|${(value ?? '').toLowerCase()}`;
    const single = (setting: string): R | undefined => (from.singles.find((r) => r.setting === setting));
    const m = a.matching_mode === 'INHERIT' ? single('matching') : undefined; const q = a.sequence_mode === 'INHERIT' ? single('sequence') : undefined;
    return {
      brands: pick(from.brands, (r) => String(r.name).toLowerCase(), own.brands.map((r) => String(r.name).toLowerCase()), (r) => ({ name: r.name, from: src(r) })),
      matchRules: pick(from.rules, (r) => ruleKey(!!r.is_include, r.name, r.passthrough_value), own.match.map((r) => ruleKey(!!r.is_include, r.name, r.passthrough_value)),
        (r) => ({ isInclude: !!r.is_include, key: r.name, value: r.passthrough_value, from: src(r) })),
      sequenceRules: pick(from.seq, (r) => String(r.passthrough_value).toLowerCase(), own.seq.map((r) => String(r.passthrough_value).toLowerCase()), (r) => ({ value: r.passthrough_value, number: r.sequence_number, from: src(r) })),
      emails: pick(from.emails, (r) => String(r.email).toLowerCase(), own.emails.map((r) => String(r.email).toLowerCase()), (r) => ({ email: r.email, from: src(r) })),
      matching: m ? { isAddressMatching: !!m.is_address_matching, batchingKey: m.batching_key ?? null, from: src(m) } : null,
      sequence: q ? { key: q.seq_key ?? null, from: src(q) } : null,
    };
  }

  async setMode(customerId: number, setting: SettingKey, mode: InheritMode, by: string): Promise<void> {
    await this.mustBeCustomer(undefined, customerId);
    const col = MODE_COLUMNS[setting];
    const cur = (await this.pool.request().input('id', sql.Int, customerId).query(`SELECT ${col} AS mode, parent_account_id FROM idoc.account WHERE account_id = @id`)).recordset[0] as R;
    if (mode !== 'OWN' && cur.parent_account_id === null) throw new ValidationError({ mode: 'This customer has no parent to take these settings from. Choose a parent on the Details tab first.' });
    if (cur.mode === mode) return;
    await this.tx(async (t) => {
      await this.req(t).input('id', sql.Int, customerId).input('m', sql.NVarChar(10), mode).query(`UPDATE idoc.account SET ${col} = @m WHERE account_id = @id`);
      await this.audit(t, customerId, by, describeMode(setting, cur.mode as InheritMode, mode));
    });
  }

  async makeSubAccount(customerId: number, by: string): Promise<void> {
    await this.mustBeCustomer(undefined, customerId);
    const cur = (await this.pool.request().input('id', sql.Int, customerId).query(`
      SELECT a.account_code, a.name, par.account_code AS parent_code, a.parent_account_id FROM idoc.account a LEFT JOIN idoc.account par ON par.account_id = a.parent_account_id WHERE a.account_id = @id`)).recordset[0] as R;
    if (cur.parent_account_id === null) throw new ValidationError({ parentId: 'Choose a parent customer on the Details tab first. A sub-account takes its settings from its parent.' });
    const kids = (await this.pool.request().input('id', sql.Int, customerId).query('SELECT name FROM idoc.account WHERE parent_account_id = @id AND inherits_settings = 0 AND is_deleted = 0 ORDER BY name')).recordset as R[];
    if (kids.length > 0) throw new ValidationError({ parentId: noChildCustomers(kids.map((k) => k.name as string)) });
    await this.tx(async (t) => {
      await this.req(t).input('id', sql.Int, customerId).query('UPDATE idoc.account SET inherits_settings = 1 WHERE account_id = @id');
      const owner = (await this.req(t).input('id', sql.Int, customerId).query('SELECT o.owner_account_id AS id FROM idoc.v_account_owner o WHERE o.account_id = @id')).recordset[0] as R;
      const ownerCode = (await this.req(t).input('o', sql.Int, owner.id).query('SELECT account_code FROM idoc.account WHERE account_id = @o')).recordset[0].account_code as string;
      await this.audit(t, customerId, by, describeBecameSubAccount(cur.parent_code, ownerCode));
      if (owner.id !== customerId) await this.audit(t, owner.id, by, describeSubAccountOf(cur.account_code, cur.name));
    });
  }

  async makeCustomer(accountId: number, by: string): Promise<void> {
    const cur = (await this.pool.request().input('id', sql.Int, accountId).query(`
      SELECT a.account_code, a.name, o.owner_account_id AS owner FROM idoc.account a JOIN idoc.v_account_owner o ON o.account_id = a.account_id WHERE a.account_id = @id AND a.inherits_settings = 1`)).recordset[0] as R | undefined;
    if (!cur) throw new NotFoundError('Account not found');
    await this.tx(async (t) => {
      await this.req(t).input('id', sql.Int, accountId).query('UPDATE idoc.account SET inherits_settings = 0 WHERE account_id = @id');
      await this.audit(t, accountId, by, describeBecameCustomer(cur.account_code, cur.name));
      await this.audit(t, cur.owner, by, describeLeftAsCustomer(cur.account_code, cur.name));
    });
  }

  async lookups(): Promise<Lookups> {
    const [keys, bands, rates, custs, stock, sizes] = await Promise.all([
      this.pool.request().query('SELECT name FROM idoc.passthrough_key ORDER BY name'),
      this.pool.request().query(`SELECT DISTINCT delivery_band FROM idoc.account_envelope WHERE is_deleted = 0 ORDER BY delivery_band`),
      this.pool.request().query(`SELECT r.postal_rate_id, pp.name AS provider, ps.name AS service, pf.name AS format, r.min_weight_g, r.max_weight_g
        FROM idoc.postal_rate r JOIN idoc.postal_service ps ON ps.postal_service_id = r.postal_service_id
        JOIN idoc.postal_provider pp ON pp.postal_provider_id = ps.postal_provider_id JOIN idoc.postal_format pf ON pf.postal_format_id = ps.postal_format_id
        WHERE r.valid_from <= CAST(SYSUTCDATETIME() AS DATE) AND (r.valid_to IS NULL OR r.valid_to >= CAST(SYSUTCDATETIME() AS DATE))
        ORDER BY pp.name, ps.name, pf.rank_order, r.max_weight_g`),
      this.pool.request().query('SELECT account_id, account_code, name FROM idoc.account WHERE inherits_settings = 0 AND is_deleted = 0 ORDER BY name'),
      this.pool.request().query(`SELECT s.stock_item_id, s.stock_code, s.description, z.code AS size FROM idoc.stock_item s LEFT JOIN idoc.envelope_size z ON z.envelope_size_id = s.envelope_size_id
        WHERE s.is_envelope = 1 AND s.is_active = 1 AND s.envelope_size_id IS NOT NULL ORDER BY s.description`),
      this.pool.request().query('SELECT insert_size_id, name FROM idoc.insert_size ORDER BY name'),
    ]);
    return {
      passthroughKeys: (keys.recordset as R[]).map((r) => r.name),
      customers: (custs.recordset as R[]).map((r) => ({ id: r.account_id, code: r.account_code, name: r.name })),
      deliveryBands: [...new Set(['1st Class', '2nd Class', ...(bands.recordset as R[]).map((r) => r.delivery_band as string)])].sort(),
      postalRates: (rates.recordset as R[]).map((r) => ({ id: r.postal_rate_id, label: rateLabel(r), format: r.format })),
      insertSizes: (sizes.recordset as R[]).map((r) => ({ id: r.insert_size_id, name: r.name })),
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
    const invoicingCode = await this.checkInvoicing(id, input.parentId, input.invoicingAccountId);
    // A new pending number (or a new rollover day) starts on the next occurrence of the rollover day after today (London); an unchanged one keeps its date.
    const pendingFrom = input.pendingJobNumber === null ? null
      : input.pendingJobNumber === old.pendingJobNumber && input.jobNumberRolloverDay === old.jobNumberRolloverDay ? old.pendingFrom
        : (await this.pool.request().input('day', sql.Int, input.jobNumberRolloverDay).query(`
            SELECT CONVERT(CHAR(10), CASE WHEN c > d THEN c ELSE DATEADD(MONTH, 1, c) END, 23) AS f
            FROM (SELECT d, DATEFROMPARTS(YEAR(d), MONTH(d), @day) AS c
                  FROM (SELECT CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'GMT Standard Time' AS DATE) AS d) t) x`)).recordset[0].f as string;
    const lines = describeDetailsChange(old, input, parentCode, pendingFrom, invoicingCode);
    await this.tx(async (t) => {
      const req = this.req(t).input('id', sql.Int, id).input('par', sql.Int, input.parentId).input('inv', sql.Int, input.invoicingAccountId).input('code', sql.NVarChar(100), input.code).input('name', sql.NVarChar(200), input.name)
        .input('mis', sql.NVarChar(50), input.misJobNumber).input('pmis', sql.NVarChar(50), input.pendingJobNumber).input('rday', sql.TinyInt, input.jobNumberRolloverDay).input('pfrom', sql.NVarChar(10), pendingFrom).input('ret', sql.NVarChar(500), input.returnAddress).input('act', sql.NVarChar(100), input.archiveCustomerTag).input('apt', sql.NVarChar(100), input.archiveProviderTag).input('adt', sql.NVarChar(100), input.archiveDirectoryTag).input('lg1', sql.NVarChar(8), input.logo1).input('lg2', sql.NVarChar(8), input.logo2).input('cmode', sql.NVarChar(25), input.colourMode)
        .input('bk', sql.Int, await this.keyId(t, input.batchingKey)).input('sk', sql.Int, await this.keyId(t, input.packSequenceKey));
      const sets = FLAGS.map((f) => { req.input(f, sql.Bit, input.flags[f]); return `${FLAG_COLUMNS[f]} = @${f}`; });
      await req.query(`UPDATE idoc.account SET ${SETTINGS.map((k) => `${MODE_COLUMNS[k]} = CASE WHEN @par IS NULL THEN N'OWN' ELSE ${MODE_COLUMNS[k]} END`).join(', ')}, parent_account_id = @par, invoicing_account_id = @inv, account_code = @code, name = @name, mis_job_number = @mis, pending_mis_job_number = @pmis, pending_job_number_from = CAST(@pfrom AS DATE), job_number_rollover_day = @rday, return_address = @ret, archive_customer_tag = @act, archive_provider_tag = @apt, archive_directory_tag = @adt, logo1 = @lg1, logo2 = @lg2, colour_mode = @cmode, batching_key_id = @bk, pack_sequence_key_id = @sk, ${sets.join(', ')} WHERE account_id = @id`);
      for (const l of lines) await this.audit(t, id, by, l);
      if (input.parentId === null) for (const k of SETTINGS) if (old.modes[k] !== 'OWN') await this.audit(t, id, by, describeMode(k, old.modes[k], 'OWN'));
    }, `Account code "${input.code}" is already in use`);
  }

  /** The invoicing account must be this customer or one of its ancestors (as they will be after this save). Returns its code, or null for the default. */
  private async checkInvoicing(id: number, newParentId: number | null, invoicingId: number | null): Promise<string | null> {
    if (invoicingId === null) return null;
    const r = await this.pool.request().input('i', sql.Int, invoicingId).input('id', sql.Int, id).input('p', sql.Int, newParentId).query(`
      WITH up AS (
        SELECT account_id, account_code, parent_account_id FROM idoc.account WHERE account_id = @p
        UNION ALL
        SELECT a.account_id, a.account_code, a.parent_account_id FROM idoc.account a JOIN up ON a.account_id = up.parent_account_id)
      SELECT account_code FROM up WHERE account_id = @i
      UNION ALL
      SELECT account_code FROM idoc.account WHERE account_id = @id AND account_id = @i
      OPTION (MAXRECURSION 100)`);
    const row = r.recordset[0] as R | undefined;
    if (!row) throw new ValidationError({ invoicingAccountId: 'The invoicing account must be this customer or one of its parents' });
    return row.account_code as string;
  }

  /** A parent must be another customer, never this customer or one of its descendants. Returns the parent's code. */
  private async checkParent(id: number, parentId: number | null): Promise<string | null> {
    if (parentId === null) return null;
    if (parentId === id) throw new ValidationError({ parentId: 'A customer cannot be its own parent' });
    const p = (await this.pool.request().input('p', sql.Int, parentId).query('SELECT account_code FROM idoc.account WHERE account_id = @p AND inherits_settings = 0')).recordset[0] as R | undefined;
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
        .query('INSERT INTO idoc.account (account_code, name, parent_account_id, inherits_settings) OUTPUT INSERTED.account_id AS id VALUES (@c, @n, @g, 1)')).recordset[0].id as number;
      await this.audit(t, customerId, by, `Added account ${input.code} "${input.name}"`);
      return id;
    }, `Account code "${input.code}" is already in use`);
  }

  async updateAccount(accountId: number, input: { code: string; name: string; isDeleted: boolean }, by: string): Promise<void> {
    const cur = (await this.pool.request().input('id', sql.Int, accountId).query('SELECT o.owner_account_id AS g, a.account_code, a.name FROM idoc.account a JOIN idoc.v_account_owner o ON o.account_id = a.account_id WHERE a.account_id = @id AND a.inherits_settings = 1')).recordset[0] as R | undefined;
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
