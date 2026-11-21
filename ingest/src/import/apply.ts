import sql from 'mssql';
import type { Plan } from './plan.js';

type Input = [string, sql.ISqlType | (() => sql.ISqlType), unknown];
const GUID = sql.UniqueIdentifier;
const VALID_FROM = '2000-01-01'; // postal rates carry no history in the FileMaker export; prices belong to the pricing module

class Db {
  constructor(private readonly tx: sql.Transaction) {}
  async rows<T>(text: string, inputs: Input[] = []): Promise<T[]> {
    const r = new sql.Request(this.tx);
    for (const [n, t, v] of inputs) r.input(n, t, v);
    return (await r.query(text)).recordset as T[];
  }
  async id(text: string, inputs: Input[] = []): Promise<number | undefined> { const r = (await this.rows<{ id: number }>(text, inputs))[0]; return r?.id; }
  async exec(text: string, inputs: Input[] = []): Promise<void> { await this.rows(text, inputs); }
}

export interface ApplyCounts { accounts: number; brands: number; stock: number; rates: number; envelopes: number }

/** Writes the plan in ONE transaction. Re-runnable: rows are matched on the FileMaker id (legacy_id), then updated. */
export async function applyPlan(pool: sql.ConnectionPool, plan: Plan): Promise<ApplyCounts> {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const n = await run(new Db(tx), plan);
    await tx.commit();
    return n;
  } catch (e) { try { await tx.rollback(); } catch { /* already rolled back */ } throw e; }
}

async function run(db: Db, plan: Plan): Promise<ApplyCounts> {
  const T = sql.NVarChar;
  // ---- dictionaries --------------------------------------------------------------------------------------------
  const keyCache = new Map<string, number>();
  const key = async (name: string): Promise<number> => {
    const hit = keyCache.get(name); if (hit) return hit;
    const id = (await db.id('SELECT passthrough_key_id AS id FROM idoc.passthrough_key WHERE name = @n', [['n', T(100), name]]))
      ?? (await db.id('INSERT INTO idoc.passthrough_key (name) OUTPUT INSERTED.passthrough_key_id AS id VALUES (@n)', [['n', T(100), name]]))!;
    keyCache.set(name, id); return id;
  };
  const sizeId = new Map<string, number>();
  for (const s of plan.sizes) {
    const id = (await db.id('SELECT envelope_size_id AS id FROM idoc.envelope_size WHERE code = @c', [['c', T(20), s.code]]))
      ?? (await db.id('INSERT INTO idoc.envelope_size (code, description, width_mm, height_mm) OUTPUT INSERTED.envelope_size_id AS id VALUES (@c, @c, @w, @h)',
        [['c', T(100), s.code], ['w', sql.Decimal(7, 2), s.widthMm], ['h', sql.Decimal(7, 2), s.heightMm]]))!;
    sizeId.set(s.code, id);
  }

  // ---- postal catalogue ----------------------------------------------------------------------------------------
  const rateId = new Map<string, number>();
  for (const r of plan.rates) {
    const fmt = await db.id('SELECT postal_format_id AS id FROM idoc.postal_format WHERE name = @n', [['n', T(50), r.format]]);
    if (!fmt) throw new Error(`Unknown postal format "${r.format}": add it to idoc.postal_format first`);
    const prov = (await db.id('SELECT postal_provider_id AS id FROM idoc.postal_provider WHERE name = @n', [['n', T(100), r.provider]]))
      ?? (await db.id('INSERT INTO idoc.postal_provider (name) OUTPUT INSERTED.postal_provider_id AS id VALUES (@n)', [['n', T(100), r.provider]]))!;
    const svcIn: Input[] = [['p', sql.Int, prov], ['f', sql.Int, fmt], ['n', T(100), r.service], ['c', T(50), r.serviceCode]];
    const svc = (await db.id('SELECT postal_service_id AS id FROM idoc.postal_service WHERE postal_provider_id = @p AND postal_format_id = @f AND name = @n', svcIn))
      ?? (await db.id('INSERT INTO idoc.postal_service (postal_provider_id, postal_format_id, name, service_code) OUTPUT INSERTED.postal_service_id AS id VALUES (@p, @f, @n, @c)', svcIn))!;
    if (r.serviceCode) await db.exec('UPDATE idoc.postal_service SET service_code = @c WHERE postal_service_id = @s AND service_code IS NULL', [['c', T(50), r.serviceCode], ['s', sql.Int, svc]]);
    const rIn: Input[] = [['s', sql.Int, svc], ['mn', sql.Int, r.minG], ['mx', sql.Int, r.maxG], ['v', sql.Date, VALID_FROM]];
    const rid = (await db.id('SELECT postal_rate_id AS id FROM idoc.postal_rate WHERE postal_service_id = @s AND max_weight_g = @mx AND valid_from = @v', rIn))
      ?? (await db.id('INSERT INTO idoc.postal_rate (postal_service_id, min_weight_g, max_weight_g, valid_from) OUTPUT INSERTED.postal_rate_id AS id VALUES (@s, @mn, @mx, @v)', rIn))!;
    rateId.set(`${r.provider}|${r.format}|${r.service}|${r.maxG}`.toLowerCase(), rid);
  }

  // ---- accounts (two passes: rows first, then the self-references) -------------------------------------------
  const acc = new Map<string, number>();
  for (const a of plan.accounts) {
    const i: Input[] = [['l', GUID, a.legacyId], ['c', T(100), a.code], ['n', T(200), a.name], ['ia', sql.Bit, a.isAddressMatching], ['ib', sql.Bit, a.isArchiveMailpieces],
      ['ic', sql.Bit, a.isCreateOutputFiles], ['if', sql.Bit, a.isSso], ['ig', sql.Bit, a.isSameDayService],
      ['ih', sql.Bit, a.isUseMrdf], ['ii', sql.Bit, a.isTesting], ['ij', sql.Bit, a.isDeleted], ['cm', sql.TinyInt, a.colourMode], ['mj', T(50), a.misJobNumber], ['ra', T(500), a.returnAddress],
      ['sk', sql.Int, a.packSequenceKey ? await key(a.packSequenceKey) : null], ['bk', sql.Int, a.batchingKey ? await key(a.batchingKey) : null]];
    const set = `account_code = @c, name = @n, is_address_matching = @ia, is_archive_mailpieces = @ib, is_create_output_files = @ic, is_sso = @if,
      is_same_day_service = @ig, is_use_mrdf = @ih, is_testing = @ii, is_deleted = @ij, colour_mode = @cm, mis_job_number = @mj, return_address = @ra, pack_sequence_key_id = @sk, batching_key_id = @bk, legacy_id = @l`;
    let id = await db.id('SELECT account_id AS id FROM idoc.account WHERE legacy_id = @l', i) ?? await db.id('SELECT account_id AS id FROM idoc.account WHERE account_code = @c', i);
    if (id) await db.exec(`UPDATE idoc.account SET ${set} WHERE account_id = ${id}`, i);
    else id = (await db.id(`INSERT INTO idoc.account (account_code, name, is_address_matching, is_archive_mailpieces, is_create_output_files, is_sso,
      is_same_day_service, is_use_mrdf, is_testing, is_deleted, colour_mode, mis_job_number, return_address, pack_sequence_key_id, batching_key_id, legacy_id)
      OUTPUT INSERTED.account_id AS id VALUES (@c, @n, @ia, @ib, @ic, @if, @ig, @ih, @ii, @ij, @cm, @mj, @ra, @sk, @bk, @l)`, i))!;
    acc.set(a.legacyId, id);
  }
  for (const a of plan.accounts) {
    const id = acc.get(a.legacyId)!;
    await db.exec('UPDATE idoc.account SET parent_account_id = @p, inherits_settings = @g, invoicing_account_id = @v WHERE account_id = @a',
      [['p', sql.Int, a.parentLegacyId ? acc.get(a.parentLegacyId) : null], ['g', sql.Bit, a.inheritsSettings && a.parentLegacyId !== null], ['v', sql.Int, a.invoicingLegacyId ? acc.get(a.invoicingLegacyId) : null], ['a', sql.Int, id]]);
    for (const t of ['address_match_rule', 'pack_sequence_rule', 'account_notification_email']) await db.exec(`DELETE FROM idoc.${t} WHERE account_id = @a`, [['a', sql.Int, id]]);
    let seq = 0;
    for (const m of a.matchRules) await db.exec('INSERT INTO idoc.address_match_rule (account_id, sequence_no, is_include, passthrough_key_id, passthrough_value) VALUES (@a, @s, @i, @k, @v)',
      [['a', sql.Int, id], ['s', sql.Int, ++seq], ['i', sql.Bit, m.isInclude], ['k', sql.Int, await key(m.key)], ['v', T(400), m.value]]);
    for (const s of a.sequenceRules) await db.exec('INSERT INTO idoc.pack_sequence_rule (account_id, passthrough_value, sequence_number) VALUES (@a, @v, @n)',
      [['a', sql.Int, id], ['v', T(400), s.value], ['n', sql.Int, s.sequence]]);
    for (const e of a.emails) await db.exec('INSERT INTO idoc.account_notification_email (account_id, email) VALUES (@a, @e)', [['a', sql.Int, id], ['e', T(320), e]]);
  }

  // ---- brands --------------------------------------------------------------------------------------------------
  const brand = new Map<string, number>();
  for (const b of plan.brands) {
    const i: Input[] = [['l', GUID, b.legacyId], ['a', sql.Int, acc.get(b.customerLegacyId)], ['n', T(200), b.name]];
    let id = await db.id('SELECT brand_id AS id FROM idoc.brand WHERE legacy_id = @l', i) ?? await db.id('SELECT brand_id AS id FROM idoc.brand WHERE account_id = @a AND name = @n', i);
    if (id) await db.exec(`UPDATE idoc.brand SET name = @n, account_id = @a, legacy_id = @l WHERE brand_id = ${id}`, i);
    else id = (await db.id('INSERT INTO idoc.brand (account_id, name, legacy_id) OUTPUT INSERTED.brand_id AS id VALUES (@a, @n, @l)', i))!;
    brand.set(b.legacyId, id);
  }

  // ---- stock ---------------------------------------------------------------------------------------------------
  const stock = new Map<string, number>();
  for (const s of plan.stock) {
    const i: Input[] = [['l', GUID, s.legacyId], ['a', sql.Int, s.customerLegacyId ? acc.get(s.customerLegacyId) : null], ['b', sql.Int, s.brandLegacyId ? brand.get(s.brandLegacyId) : null],
      ['c', T(50), s.code], ['t', T(50), s.type], ['r', T(200), s.reference], ['pc', T(50), s.productCode], ['ms', sql.Int, s.maxSheets], ['cp', sql.Decimal(6, 2), s.capacityMm],
      ['d', T(300), s.description || s.code || s.type], ['ie', sql.Bit, s.isEnvelope], ['ii', sql.Bit, s.isInsert], ['sz', sql.Int, s.sizeCode ? sizeId.get(s.sizeCode) : null],
      ['w', sql.Decimal(8, 2), s.weightG], ['th', sql.Decimal(6, 2), s.thicknessMm], ['wd', sql.Decimal(7, 2), s.widthMm], ['ht', sql.Decimal(7, 2), s.heightMm],
      ['ww', sql.Decimal(7, 2), s.windowWidthMm], ['wh', sql.Decimal(7, 2), s.windowHeightMm], ['sm', sql.Bit, s.isStockManaged], ['ac', sql.Bit, s.isActive]];
    let id = await db.id('SELECT stock_item_id AS id FROM idoc.stock_item WHERE legacy_id = @l', i) ?? (s.code ? await db.id('SELECT stock_item_id AS id FROM idoc.stock_item WHERE stock_code = @c', i) : undefined);
    if (id) await db.exec(`UPDATE idoc.stock_item SET legacy_id = @l, account_id = @a, brand_id = @b, stock_code = COALESCE(@c, stock_code), stock_type = @t, reference = @r, product_code = @pc, max_sheets = @ms, capacity_mm = @cp,
      description = @d, is_envelope = @ie, is_insert = @ii, envelope_size_id = @sz, weight_g = @w, thickness_mm = @th, width_mm = @wd, height_mm = @ht, window_width_mm = @ww, window_height_mm = @wh,
      is_stock_managed = @sm, is_active = @ac WHERE stock_item_id = ${id}`, i);
    else id = (await db.id(`INSERT INTO idoc.stock_item (legacy_id, account_id, brand_id, stock_code, stock_type, reference, product_code, max_sheets, capacity_mm, description, is_envelope, is_insert,
      envelope_size_id, weight_g, thickness_mm, width_mm, height_mm, window_width_mm, window_height_mm, is_stock_managed, is_active) OUTPUT INSERTED.stock_item_id AS id
      VALUES (@l, @a, @b, @c, @t, @r, @pc, @ms, @cp, @d, @ie, @ii, @sz, @w, @th, @wd, @ht, @ww, @wh, @sm, @ac)`, i))!;
    stock.set(s.legacyId, id);
  }
  for (const s of plan.stock.filter((x) => x.parentLegacyId))
    await db.exec('UPDATE idoc.stock_item SET parent_stock_item_id = @p WHERE stock_item_id = @s', [['p', sql.Int, stock.get(s.parentLegacyId!)], ['s', sql.Int, stock.get(s.legacyId)]]);

  // stock the business decided must not exist (only when nothing refers to it)
  for (const legacy of plan.excludedStock)
    await db.exec(`DELETE FROM idoc.stock_item WHERE legacy_id = @l
      AND NOT EXISTS (SELECT 1 FROM idoc.account_envelope WHERE outer_stock_item_id = stock_item.stock_item_id)
      AND NOT EXISTS (SELECT 1 FROM idoc.batch WHERE outer_stock_item_id = stock_item.stock_item_id)
      AND NOT EXISTS (SELECT 1 FROM idoc.batch_insert WHERE stock_item_id = stock_item.stock_item_id)
      AND NOT EXISTS (SELECT 1 FROM idoc.pack_insert WHERE stock_item_id = stock_item.stock_item_id)
      AND NOT EXISTS (SELECT 1 FROM idoc.stock_item c WHERE c.parent_stock_item_id = stock_item.stock_item_id)`, [['l', GUID, legacy]]);

  // ---- envelopes -----------------------------------------------------------------------------------------------
  for (const e of plan.envelopes) {
    const rk = `${e.rate.provider}|${e.rate.format}|${e.rate.service}|${e.rate.maxG}`.toLowerCase();
    const i: Input[] = [['l', GUID, e.legacyId], ['a', sql.Int, acc.get(e.customerLegacyId)], ['b', sql.Int, e.brandLegacyId ? brand.get(e.brandLegacyId) : null], ['d', T(50), e.deliveryBand],
      ['r', sql.Int, rateId.get(rk)], ['s', sql.Int, stock.get(e.stockLegacyId)], ['n', T(200), e.externalName], ['f', T(100), e.reference], ['o', sql.Bit, e.isOversticker]];
    const id = await db.id('SELECT account_envelope_id AS id FROM idoc.account_envelope WHERE legacy_id = @l', i);
    if (id) await db.exec(`UPDATE idoc.account_envelope SET account_id = @a, brand_id = @b, delivery_band = @d, postal_rate_id = @r, outer_stock_item_id = @s, external_name = @n, reference = @f,
      is_oversticker = @o, is_deleted = 0 WHERE account_envelope_id = ${id}`, i);
    else await db.exec(`INSERT INTO idoc.account_envelope (legacy_id, account_id, brand_id, delivery_band, postal_rate_id, outer_stock_item_id, external_name, reference, is_oversticker)
      VALUES (@l, @a, @b, @d, @r, @s, @n, @f, @o)`, i);
  }
  return { accounts: plan.accounts.length, brands: plan.brands.length, stock: plan.stock.length, rates: plan.rates.length, envelopes: plan.envelopes.length };
}
