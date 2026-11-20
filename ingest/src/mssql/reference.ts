import sql from 'mssql';
import type { AccountConfig, EnvelopeOption, PostalFormat, ReferenceData, Settings, StockItem } from '../reference.js';

/** Loads everything the ingest needs from the idoc.* tables. One round of read-only queries. */
export async function loadReferenceData(pool: sql.ConnectionPool): Promise<ReferenceData> {
  const q = async <T>(text: string): Promise<T[]> => (await pool.request().query(text)).recordset as T[];

  const [s] = await q<{
    a4_sheet_weight_g: number; a4_sheet_thickness_mm: number; machine_enclosing_min_mailpieces: number;
    machine_enclosing_max_sheets: number; machine_enclosing_envelope_code: string; hand_enclosing_max_sheets: number;
  }>('SELECT * FROM idoc.settings WHERE settings_id = 1');
  if (!s) throw new Error('idoc.settings has no row');
  const settings: Settings = {
    a4SheetWeightG: Number(s.a4_sheet_weight_g), a4SheetThicknessMm: Number(s.a4_sheet_thickness_mm),
    machineEnclosingMinMailpieces: s.machine_enclosing_min_mailpieces, machineEnclosingMaxSheets: s.machine_enclosing_max_sheets,
    machineEnclosingEnvelopeSize: s.machine_enclosing_envelope_code, handEnclosingMaxSheets: s.hand_enclosing_max_sheets,
  };

  const postalFormats = (await q<{ name: string; rank_order: number; max_weight_g: number; max_thickness_mm: number | null; max_sheets: number | null }>(
    'SELECT name, rank_order, max_weight_g, max_thickness_mm, max_sheets FROM idoc.postal_format ORDER BY rank_order'))
    .map((f): PostalFormat => ({ name: f.name, rank: f.rank_order, maxWeightG: f.max_weight_g,
      maxThicknessMm: f.max_thickness_mm === null ? null : Number(f.max_thickness_mm), maxSheets: f.max_sheets }));

  const stockRows = await q<{ stock_item_id: number; parent_stock_item_id: number | null; stock_code: string; weight_g: number; thickness_mm: number }>(
    'SELECT stock_item_id, parent_stock_item_id, stock_code, CAST(weight_g AS FLOAT) AS weight_g, CAST(thickness_mm AS FLOAT) AS thickness_mm FROM idoc.stock_item');
  const codeById = new Map(stockRows.map((r) => [r.stock_item_id, r.stock_code]));
  const stock = new Map<string, StockItem>();
  for (const r of stockRows) stock.set(r.stock_code, { code: r.stock_code, weightG: Number(r.weight_g), thicknessMm: Number(r.thickness_mm), linked: [] });
  for (const r of stockRows) {
    if (r.parent_stock_item_id === null) continue;
    const parent = stock.get(codeById.get(r.parent_stock_item_id)!);
    parent?.linked?.push(r.stock_code);
  }

  const anonymousAddressees = new Set((await q<{ normalised_text: string }>('SELECT normalised_text FROM idoc.anonymous_addressee')).map((r) => r.normalised_text));
  const paperBatchNames = new Map((await q<{ name: string; batch_name: string }>('SELECT name, batch_name FROM idoc.paper')).map((r) => [r.name, r.batch_name]));

  // Accounts. Configuration (flags, rules, brands, envelopes) is read from the customer = grouping account.
  const accounts = await q<{ account_id: number; account_code: string; grouping_account_id: number | null; is_address_matching: boolean; batching_key: string | null; seq_key: string | null }>(`
    SELECT a.account_id, a.account_code, a.grouping_account_id,
           c.is_address_matching, bk.name AS batching_key, sk.name AS seq_key
    FROM idoc.account AS a
    INNER JOIN idoc.account AS c ON c.account_id = COALESCE(a.grouping_account_id, a.account_id)
    LEFT JOIN idoc.passthrough_key AS bk ON bk.passthrough_key_id = c.batching_key_id
    LEFT JOIN idoc.passthrough_key AS sk ON sk.passthrough_key_id = c.pack_sequence_key_id
    WHERE a.is_deleted = 0`);
  const customerOf = new Map(accounts.map((a) => [a.account_id, a.grouping_account_id ?? a.account_id]));
  const codeOf = new Map(accounts.map((a) => [a.account_id, a.account_code]));

  const brands = await q<{ account_id: number; name: string }>('SELECT account_id, name FROM idoc.brand');
  const rules = await q<{ account_id: number; is_include: boolean; key_name: string; passthrough_value: string | null }>(`
    SELECT r.account_id, r.is_include, k.name AS key_name, r.passthrough_value
    FROM idoc.address_match_rule AS r INNER JOIN idoc.passthrough_key AS k ON k.passthrough_key_id = r.passthrough_key_id ORDER BY r.sequence_no`);
  const seqRules = await q<{ account_id: number; passthrough_value: string; sequence_number: number }>('SELECT account_id, passthrough_value, sequence_number FROM idoc.pack_sequence_rule');
  const envRows = await q<{
    account_envelope_id: number; account_id: number; brand: string | null; delivery_band: string; reference: string | null;
    postal_rate_id: number; min_weight_g: number; max_weight_g: number; postal_service_id: number; format_name: string; size: string; stock_code: string;
  }>(`
    SELECT ae.account_envelope_id, ae.account_id, b.name AS brand, ae.delivery_band, ae.reference,
           ae.postal_rate_id, r.min_weight_g, r.max_weight_g, r.postal_service_id,
           pf.name AS format_name, es.code AS size, si.stock_code
    FROM idoc.account_envelope AS ae
    LEFT JOIN idoc.brand AS b ON b.brand_id = ae.brand_id
    INNER JOIN idoc.postal_rate AS r ON r.postal_rate_id = ae.postal_rate_id
    INNER JOIN idoc.postal_service AS ps ON ps.postal_service_id = r.postal_service_id
    INNER JOIN idoc.postal_format AS pf ON pf.postal_format_id = ps.postal_format_id
    INNER JOIN idoc.stock_item AS si ON si.stock_item_id = ae.outer_stock_item_id
    INNER JOIN idoc.envelope_size AS es ON es.envelope_size_id = si.envelope_size_id
    WHERE ae.is_deleted = 0
      AND r.valid_from <= CAST(SYSUTCDATETIME() AS DATE) AND (r.valid_to IS NULL OR r.valid_to >= CAST(SYSUTCDATETIME() AS DATE))`);

  const out = new Map<string, AccountConfig>();
  for (const a of accounts) {
    const cust = customerOf.get(a.account_id)!;
    const seq = seqRules.filter((r) => r.account_id === cust);
    const myRules = rules.filter((r) => r.account_id === cust);
    out.set(a.account_code, {
      code: a.account_code,
      customerCode: codeOf.get(cust) ?? a.account_code,
      brands: brands.filter((b) => b.account_id === cust).map((b) => b.name),
      batchingKey: a.batching_key,
      matchingEnabled: Boolean(a.is_address_matching),
      matchIncludeKeys: myRules.filter((r) => r.is_include).map((r) => r.key_name),
      matchExclude: myRules.filter((r) => !r.is_include).map((r) => ({ key: r.key_name, value: r.passthrough_value ?? '' })),
      packSequence: a.seq_key && seq.length ? { key: a.seq_key, rules: new Map(seq.map((r) => [r.passthrough_value, r.sequence_number])) } : undefined,
      envelopes: envRows.filter((e) => e.account_id === cust).map((e): EnvelopeOption => ({
        brand: e.brand, reference: e.reference ?? '', postalFormat: e.format_name, size: e.size, stockCode: e.stock_code,
        deliveryBand: e.delivery_band, minWeightG: e.min_weight_g, maxWeightG: e.max_weight_g,
        accountEnvelopeId: e.account_envelope_id, postalRateId: e.postal_rate_id, postalServiceId: e.postal_service_id,
      })),
    });
  }
  return { settings, postalFormats, stock, accounts: out, anonymousAddressees, paperBatchNames };
}
