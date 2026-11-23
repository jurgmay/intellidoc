import sql from 'mssql';
import type { AccountConfig, EnvelopeOption, PostalFormat, ReferenceData, Settings, StockItem } from '../reference.js';

/** Loads everything the ingest needs from the idoc.* tables. One round of read-only queries. */
/** An account's effective envelope rows, nearest source first. Where a nearer source has the same brand, band, rate and reference, it replaces the further one. */
function nearestWins<T extends { depth: number; brand: string | null; delivery_band: string; postal_rate_id: number; reference: string | null }>(rows: T[]): T[] {
  const seen = new Set<string>(); const out: T[] = [];
  for (const r of [...rows].sort((a, b) => a.depth - b.depth)) {
    const k = `${(r.brand ?? '').toLowerCase()}|${r.delivery_band.toLowerCase()}|${r.postal_rate_id}|${(r.reference ?? '').toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k); out.push(r);
  }
  return out;
}

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

  const stockRows = await q<{ stock_item_id: number; parent_stock_item_id: number | null; stock_code: string; description: string; weight_g: number; thickness_mm: number }>(
    'SELECT stock_item_id, parent_stock_item_id, stock_code, description, CAST(weight_g AS FLOAT) AS weight_g, CAST(thickness_mm AS FLOAT) AS thickness_mm FROM idoc.stock_item WHERE stock_code IS NOT NULL');
  const codeById = new Map(stockRows.map((r) => [r.stock_item_id, r.stock_code]));
  const stock = new Map<string, StockItem>();
  for (const r of stockRows) stock.set(r.stock_code, { code: r.stock_code, weightG: Number(r.weight_g), thicknessMm: Number(r.thickness_mm), description: r.description, linked: [] });
  for (const r of stockRows) {
    if (r.parent_stock_item_id === null) continue;
    const parent = stock.get(codeById.get(r.parent_stock_item_id)!);
    parent?.linked?.push(r.stock_code);
  }

  const anonymousAddressees = new Set((await q<{ normalised_text: string }>('SELECT normalised_text FROM idoc.anonymous_addressee')).map((r) => r.normalised_text));
  const paperBatchNames = new Map((await q<{ name: string; batch_name: string }>('SELECT name, batch_name FROM idoc.paper')).map((r) => [r.name, r.batch_name]));

  // Accounts. Each settings group (brands, matching, pack sequence, envelopes) is read from the accounts that make it up (v_account_setting_source): the
  // account itself, its parents, or both, as its inheritance choice says. The batching boundary is the root of the tree; the invoicing account comes from v_account_invoicing.
  const accounts = await q<{ account_id: number; account_code: string; invoicing_account_id: number }>(`
    SELECT a.account_id, a.account_code, iv.invoicing_account_id
    FROM idoc.account AS a
    INNER JOIN idoc.v_account_invoicing AS iv ON iv.account_id = a.account_id
    WHERE a.is_deleted = 0`);
  // What each account holds itself: the on/off and the two keys.
  const held = new Map((await q<{ account_id: number; is_address_matching: boolean; batching_key: string | null; seq_key: string | null }>(`
    SELECT c.account_id, c.is_address_matching, bk.name AS batching_key, sk.name AS seq_key
    FROM idoc.account AS c
    LEFT JOIN idoc.passthrough_key AS bk ON bk.passthrough_key_id = c.batching_key_id
    LEFT JOIN idoc.passthrough_key AS sk ON sk.passthrough_key_id = c.pack_sequence_key_id`)).map((r) => [r.account_id, r]));
  const sourceRows = await q<{ account_id: number; setting: string; source_account_id: number; depth: number }>('SELECT account_id, setting, source_account_id, depth FROM idoc.v_account_setting_source');
  const sourcesOf = new Map<string, number[]>(); // `${setting}|${account}` -> source accounts, nearest first
  for (const r of [...sourceRows].sort((x, y) => x.depth - y.depth)) {
    const k = `${r.setting}|${r.account_id}`; const l = sourcesOf.get(k); if (l) l.push(r.source_account_id); else sourcesOf.set(k, [r.source_account_id]);
  }
  // The whole tree (deleted accounts too), for the root of each account and for invoicing account codes.
  const tree = await q<{ account_id: number; account_code: string; parent_account_id: number | null; inherits_settings: boolean }>('SELECT account_id, account_code, parent_account_id, inherits_settings FROM idoc.account');
  const codeOf = new Map(tree.map((a) => [a.account_id, a.account_code]));
  const parentOf = new Map(tree.map((a) => [a.account_id, a.parent_account_id]));
  const inheritsOf = new Map(tree.map((a) => [a.account_id, Boolean(a.inherits_settings)]));
  /** The account that holds the settings: the account itself, or the nearest ancestor above it that does not inherit (idoc.v_account_owner). A job, its batches and mailpieces belong to it. */
  const holderOf = (id: number): number => { let cur = id; for (let i = 0; i < 100 && inheritsOf.get(cur); i++) { const p = parentOf.get(cur); if (p === null || p === undefined) break; cur = p; } return cur; };

  const brands = await q<{ account_id: number; name: string }>('SELECT account_id, name FROM idoc.brand');
  const rules = await q<{ account_id: number; is_include: boolean; key_name: string; passthrough_value: string | null }>(`
    SELECT r.account_id, r.is_include, k.name AS key_name, r.passthrough_value
    FROM idoc.address_match_rule AS r INNER JOIN idoc.passthrough_key AS k ON k.passthrough_key_id = r.passthrough_key_id ORDER BY r.sequence_no`);
  const seqRules = await q<{ account_id: number; passthrough_value: string; sequence_number: number }>('SELECT account_id, passthrough_value, sequence_number FROM idoc.pack_sequence_rule');
  const envRows = await q<{
    account_envelope_id: number; account_id: number; depth: number; brand: string | null; delivery_band: string; reference: string | null;
    postal_rate_id: number; min_weight_g: number; max_weight_g: number; postal_service_id: number; provider_name: string; service_name: string; service_code: string | null; format_name: string; size: string; stock_code: string;
  }>(`
    SELECT ae.account_envelope_id, src.account_id AS account_id, src.depth, b.name AS brand, ae.delivery_band, ae.reference,
           r.postal_rate_id, r.min_weight_g, r.max_weight_g, r.postal_service_id,
           pp.name AS provider_name, ps.name AS service_name, ps.service_code, pf.name AS format_name, es.code AS size, si.stock_code
    FROM idoc.v_account_envelope_source AS src
    INNER JOIN idoc.account_envelope AS ae ON ae.account_id = src.source_account_id
    LEFT JOIN idoc.brand AS b ON b.brand_id = ae.brand_id
    -- An envelope setting is linked to a weight band of a service. The row that prices that band today is the one used, so a dated price change
    -- (the old row ends, a new row starts) needs no change to the envelope settings.
    INNER JOIN idoc.postal_rate AS r0 ON r0.postal_rate_id = ae.postal_rate_id
    CROSS APPLY (SELECT TOP 1 x.postal_rate_id, x.min_weight_g, x.max_weight_g, x.postal_service_id FROM idoc.postal_rate AS x
                 WHERE x.postal_service_id = r0.postal_service_id AND x.min_weight_g = r0.min_weight_g AND x.max_weight_g = r0.max_weight_g
                   AND x.valid_from <= CAST(SYSUTCDATETIME() AS DATE) AND (x.valid_to IS NULL OR x.valid_to >= CAST(SYSUTCDATETIME() AS DATE))
                 ORDER BY x.valid_from DESC) AS r
    INNER JOIN idoc.postal_service AS ps ON ps.postal_service_id = r.postal_service_id
    INNER JOIN idoc.postal_provider AS pp ON pp.postal_provider_id = ps.postal_provider_id
    INNER JOIN idoc.postal_format AS pf ON pf.postal_format_id = ps.postal_format_id
    INNER JOIN idoc.stock_item AS si ON si.stock_item_id = ae.outer_stock_item_id
    INNER JOIN idoc.envelope_size AS es ON es.envelope_size_id = si.envelope_size_id
    WHERE ae.is_deleted = 0`);

  const out = new Map<string, AccountConfig>();
  for (const a of accounts) {
    const from = (setting: string): number[] => sourcesOf.get(`${setting}|${a.account_id}`) ?? [];
    const nearest = (setting: string) => held.get(from(setting)[0] ?? -1);
    const myRules = from('matching').flatMap((id) => rules.filter((r) => r.account_id === id));
    // Pack sequence: the key is the nearest source's; a nearer source's number for a value replaces a further one's.
    const seqKey = nearest('sequence')?.seq_key ?? null;
    const seq = new Map<string, number>();
    for (const id of from('sequence')) for (const r of seqRules.filter((x) => x.account_id === id)) if (!seq.has(r.passthrough_value)) seq.set(r.passthrough_value, r.sequence_number);
    const brandNames: string[] = [];
    for (const id of from('brands')) for (const b of brands.filter((x) => x.account_id === id)) if (!brandNames.some((n) => n.toLowerCase() === b.name.toLowerCase())) brandNames.push(b.name);
    out.set(a.account_code, {
      code: a.account_code,
      customerCode: codeOf.get(holderOf(a.account_id)) ?? a.account_code,
      invoicingCode: codeOf.get(a.invoicing_account_id) ?? a.account_code,
      brands: brandNames,
      batchingKey: nearest('matching')?.batching_key ?? null,
      matchingEnabled: Boolean(nearest('matching')?.is_address_matching),
      matchIncludeKeys: [...new Set(myRules.filter((r) => r.is_include).map((r) => r.key_name))],
      matchExclude: myRules.filter((r) => !r.is_include).map((r) => ({ key: r.key_name, value: r.passthrough_value ?? '' })),
      packSequence: seqKey && seq.size ? { key: seqKey, rules: seq } : undefined,
      envelopes: nearestWins(envRows.filter((e) => e.account_id === a.account_id)).map((e): EnvelopeOption => ({
        brand: e.brand, reference: e.reference ?? '', postalFormat: e.format_name, size: e.size, stockCode: e.stock_code,
        deliveryBand: e.delivery_band, minWeightG: e.min_weight_g, maxWeightG: e.max_weight_g,
        accountEnvelopeId: e.account_envelope_id, postalRateId: e.postal_rate_id, postalServiceId: e.postal_service_id,
        postalProvider: e.provider_name, postalServiceName: e.service_name, serviceCode: e.service_code,
      })),
    });
  }
  return { settings, postalFormats, stock, accounts: out, anonymousAddressees, paperBatchNames };
}
