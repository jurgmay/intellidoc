import { type Row, flag, json, lc, num } from './mer.js';
import { buildCostingPlan, type PlanCostingModel } from './costingPlan.js';

/**
 * Turns the four FileMaker exports into a plan of rows to load. Pure: no database access, so the dry run and
 * the tests exercise exactly what --apply will write.
 *
 * Deliberately NOT read: hpodAccountLogin / hpodAccountPassword / hpodAccountEmail (credentials) and every
 * stock-control quantity (quantityInStock, quantityUsed, lastUsed, totalUsage, averageUsagePerMonth, minimumStockLevel).
 */
/** FileMaker colourMode values: 0 no change, 1 all mono, 2 colour first page of each pack, 3 colour first page of each mailpiece. */
const FM_COLOUR_MODES: Record<number, string> = { 0: 'ORIGINAL', 1: 'ALL_MONO', 2: 'FIRST_PACK_PAGE', 3: 'FIRST_MAILPIECE_PAGE' };

export interface PlanAccount {
  legacyId: string; code: string; name: string; parentLegacyId: string | null;
  /** true: the settings are read from the parent (resolved up the tree). false: this account holds its own (a customer). */
  inheritsSettings: boolean;
  /** The account invoiced for this account's mail: itself or an ancestor. null = the account that holds the settings. */
  invoicingLegacyId: string | null;
  isAddressMatching: boolean; isArchiveMailpieces: boolean; isCreateOutputFiles: boolean;
  isSso: boolean; isSameDayService: boolean; isUseMrdf: boolean; isTesting: boolean; isDeleted: boolean;
  misJobNumber: string | null; returnAddress: string | null;
  /** Mapped from the FileMaker colourMode (0/1/2/3). Written when the account is first created only. */
  colourMode: string;
  packSequenceKey: string | null; batchingKey: string | null;
  emails: string[];
  matchRules: { isInclude: boolean; key: string; value: string | null }[];
  sequenceRules: { value: string; sequence: number }[];
}
/** The account that holds the settings for `a`: itself, or the nearest ancestor that does not inherit. */
export function settingsOwner(byId: Map<string, PlanAccount>, a: PlanAccount): PlanAccount {
  let cur = a;
  for (let i = 0; i < 100 && cur.inheritsSettings && cur.parentLegacyId; i++) cur = byId.get(cur.parentLegacyId) ?? cur;
  return cur;
}
/** The top of the tree this account sits in: the batching boundary. */
export function rootOf(byId: Map<string, PlanAccount>, a: PlanAccount): PlanAccount {
  let cur = a;
  for (let i = 0; i < 100 && cur.parentLegacyId; i++) cur = byId.get(cur.parentLegacyId) ?? cur;
  return cur;
}
export interface PlanBrand { legacyId: string; customerLegacyId: string; name: string }
export interface PlanSize { code: string; widthMm: number | null; heightMm: number | null }
export interface PlanStock {
  legacyId: string; parentLegacyId: string | null; customerLegacyId: string | null; brandLegacyId: string | null;
  code: string | null; type: string; description: string; reference: string | null; productCode: string | null;
  isEnvelope: boolean; isInsert: boolean; sizeCode: string | null; weightG: number; thicknessMm: number;
  widthMm: number | null; heightMm: number | null; windowWidthMm: number | null; windowHeightMm: number | null;
  isStockManaged: boolean; isActive: boolean; maxSheets: number | null; capacityMm: number | null;
}
export interface PlanRate { provider: string; format: string; service: string; serviceCode: string | null; minG: number; maxG: number }
export interface PlanEnvelope {
  legacyId: string; customerLegacyId: string; brandLegacyId: string | null; stockLegacyId: string; deliveryBand: string;
  rate: { provider: string; format: string; service: string; maxG: number }; externalName: string | null; reference: string | null;
  isOversticker: boolean;
}
export interface Plan {
  /** FileMaker ids of stock items that must NOT exist (business decision); apply deletes them if present and unreferenced. */
  excludedStock: string[];
  accounts: PlanAccount[]; brands: PlanBrand[]; sizes: PlanSize[]; stock: PlanStock[]; rates: PlanRate[]; envelopes: PlanEnvelope[];
  /** Price lists to add (switched off, no dates) and the accounts that take their parent's prices instead of having a list of their own. */
  costing: PlanCostingModel[]; costingInherit: string[];
  warnings: string[]; skipped: Record<string, number>;
}
export interface Exports { customers: Row[]; brands: Row[]; stock: Row[]; envelopes: Row[] }

const WINDOW_NA = (n: number | null): number | null => (n === null || n === 0 ? null : n);

/** Leaf envelope records (objects holding both "id" and "stockCode") at any nesting depth of an envelopesJSON. */
function envelopeIds(v: unknown, out: Set<string>): void {
  if (Array.isArray(v)) { for (const x of v) envelopeIds(x, out); return; }
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o['id'] === 'string' && 'stockCode' in o) { out.add(o['id'].toLowerCase()); return; }
    for (const x of Object.values(o)) envelopeIds(x, out);
  }
}

export function buildPlan(x: Exports): Plan {
  const warnings: string[] = [];
  const skipped: Record<string, number> = {};
  const skip = (k: string, why: string, detail?: string): void => { skipped[k] = (skipped[k] ?? 0) + 1; if (detail) warnings.push(`${why}: ${detail}`); };

  // ---- accounts -----------------------------------------------------------------------------------------------
  const byId = new Map(x.customers.map((r) => [lc(r['id']), r]));
  const codes = new Set<string>();
  const accounts: PlanAccount[] = [];
  const groupingOf = new Map<string, string>();
  const envelopeIdSet = new Set<string>();
  for (const r of x.customers) {
    const legacyId = lc(r['id']); const code = (r['accountCode'] ?? '').trim();
    envelopeIds(json(r['envelopesJSON']), envelopeIdSet);
    if (!code) { skip('accounts', 'Account without a code skipped', legacyId); continue; }
    if (codes.has(code.toLowerCase())) { skip('accounts', 'Duplicate account code skipped', code); continue; }
    codes.add(code.toLowerCase());
    let grouping: string | null = lc(r['id_groupingAccount']);
    if (!grouping || grouping === legacyId) grouping = null;
    else if (!byId.has(grouping)) { warnings.push(`Account ${code}: grouping account ${grouping} is not in the export; treated as its own customer`); grouping = null; }
    if (grouping) groupingOf.set(legacyId, grouping);
    const parent = lc(r['id_parentAccount']);
    // The FileMaker field name is assumed to be id_invoicingAccount; an export without it simply leaves every account on its default.
    const invoicingRaw = lc(r['id_invoicingAccount']);
    const invoicing = invoicingRaw && invoicingRaw !== legacyId ? invoicingRaw : null;
    const am = json<{ addressMatching?: string[]; addressMatchingExclude?: { passthroughKey: string; passthroughValue: string }[] }>(r['addressMatchJSON']);
    const ps = json<{ passthroughKey?: string; sequences?: { passthroughValue: string; sequenceNumber: number }[] }>(r['packSequenceJSON']);
    const bt = json<{ passthroughKey?: string; passthroughValue?: string }>(r['batchingJSON']);
    const matchRules: PlanAccount['matchRules'] = [
      ...(am?.addressMatching ?? []).map((k) => ({ isInclude: true, key: k, value: null })),
      ...(am?.addressMatchingExclude ?? []).map((e) => ({ isInclude: false, key: e.passthroughKey, value: e.passthroughValue })),
    ];
    const batchingKey = (r['batchingPassthroughKey'] ?? '').trim() || bt?.passthroughKey || null;
    if (batchingKey && (bt?.passthroughValue || (r['batchingPassthroughValue'] ?? '').trim()))
      warnings.push(`Account ${code}: batching key "${batchingKey}" has a fixed value "${bt?.passthroughValue ?? r['batchingPassthroughValue']}"; the value is not imported (see notes)`);
    const fmColour = num(r['colourMode']) ?? 0;
    const colourMode = FM_COLOUR_MODES[fmColour] ?? 'ORIGINAL';
    if (!(fmColour in FM_COLOUR_MODES)) warnings.push(`Account ${code}: FileMaker colour mode ${fmColour} is not understood; imported as ORIGINAL`);
    accounts.push({
      legacyId, code, name: (r['accountName'] ?? '').trim() || code,
      parentLegacyId: parent && byId.has(parent) && parent !== legacyId ? parent : null, inheritsSettings: grouping !== null, invoicingLegacyId: invoicing,
      isAddressMatching: flag(r['isAddressMatching']), isArchiveMailpieces: flag(r['isArchiveMailpieces']),
      isCreateOutputFiles: flag(r['isCreateOutputFiles']),
      isSso: flag(r['isSSO']), isSameDayService: flag(r['isSameDayService']), isUseMrdf: flag(r['isUseMRDF']),
      isTesting: flag(r['isTesting']), isDeleted: flag(r['isDeleted']),
      colourMode, misJobNumber: (r['misJobNumber'] ?? '').trim() || null, returnAddress: (r['returnAddress'] ?? '').trim() || null,
      packSequenceKey: (r['packSequencePassthroughKey'] ?? '').trim() || ps?.passthroughKey || null, batchingKey,
      emails: [...new Set((r['notificationEmails'] ?? '').split(/[\s;,]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@')))],
      matchRules, sequenceRules: (ps?.sequences ?? []).map((s) => ({ value: s.passthroughValue, sequence: s.sequenceNumber })),
    });
  }
  const accountIds = new Set(accounts.map((a) => a.legacyId));
  // One tree. FileMaker had a parent and a grouping account; the parent wins, and an account that had a grouping customer inherits its settings.
  const accById = new Map(accounts.map((a) => [a.legacyId, a]));
  for (const a of accounts) {
    if (a.parentLegacyId && !accountIds.has(a.parentLegacyId)) a.parentLegacyId = null;
    const g = groupingOf.get(a.legacyId);
    if (g && !accountIds.has(g)) { a.inheritsSettings = false; continue; }
    if (a.inheritsSettings && !a.parentLegacyId && g) a.parentLegacyId = g;
  }
  for (const a of accounts) {
    // a loop in the parent links would make the tree unusable: cut it here
    const seen = new Set<string>([a.legacyId]);
    for (let n = a.parentLegacyId ? accById.get(a.parentLegacyId) : undefined; n; n = n.parentLegacyId ? accById.get(n.parentLegacyId) : undefined) {
      if (seen.has(n.legacyId)) { warnings.push(`Account ${a.code}: the parent links form a loop; ${a.code} is made a top-level customer`); a.parentLegacyId = null; a.inheritsSettings = false; break; }
      seen.add(n.legacyId);
    }
  }
  // The invoicing account must be the account itself or one of its ancestors.
  for (const a of accounts) {
    if (!a.invoicingLegacyId) continue;
    const chain = new Set<string>();
    for (let n = a.parentLegacyId ? accById.get(a.parentLegacyId) : undefined; n && !chain.has(n.legacyId); n = n.parentLegacyId ? accById.get(n.parentLegacyId) : undefined) chain.add(n.legacyId);
    if (!chain.has(a.invoicingLegacyId)) {
      warnings.push(`Account ${a.code}: its invoicing account ${accById.get(a.invoicingLegacyId)?.code ?? a.invoicingLegacyId} is not the account or one of its ancestors; the default is used instead`);
      a.invoicingLegacyId = null;
    }
  }
  for (const a of accounts) {
    const g = groupingOf.get(a.legacyId);
    if (g && a.inheritsSettings && settingsOwner(accById, a).legacyId !== g)
      warnings.push(`Account ${a.code}: its parent is ${accById.get(a.parentLegacyId ?? '')?.code ?? '(none)'}, not its grouping customer ${accById.get(g)?.code}; the parent wins, so its settings now come from ${settingsOwner(accById, a).code}`);
  }

  // ---- brands -------------------------------------------------------------------------------------------------
  const brands: PlanBrand[] = []; const brandSeen = new Set<string>(); const brandIds = new Set<string>();
  for (const r of x.brands) {
    const legacyId = lc(r['id']); const cust = lc(r['id_customer']); const name = (r['name'] ?? '').trim();
    if (!name || !accountIds.has(cust)) { skip('brands', 'Brand skipped (no name or unknown customer)', `${name || legacyId}`); continue; }
    if (name.includes('�')) warnings.push(`Brand "${name}" contains a corrupted character (export encoding); correct the name by hand after import`);
    const k = `${cust}|${name.toLowerCase()}`;
    if (brandSeen.has(k)) { skip('brands', 'Duplicate brand skipped', name); continue; }
    brandSeen.add(k); brandIds.add(legacyId); brands.push({ legacyId, customerLegacyId: cust, name });
  }

  // ---- stock --------------------------------------------------------------------------------------------------
  const sizes = new Map<string, PlanSize>();
  const stock: PlanStock[] = [];
  const codeOwner = new Map<string, string>();
  const ordered = [...x.stock].sort((a, b) => Number(flag(b['isActive'])) - Number(flag(a['isActive']))); // active items win a duplicate code
  const stockIds = new Set(x.stock.map((r) => lc(r['id'])));
  for (const r of ordered) {
    const legacyId = lc(r['id']); const type = (r['type'] ?? '').trim();
    let code: string | null = (r['stockCode'] ?? '').trim() || null;
    if (code) {
      const k = code.toLowerCase();
      if (codeOwner.has(k)) { warnings.push(`Stock code ${code} is used by more than one item (${r['description']}); the extra item is imported WITHOUT a code`); code = null; }
      else codeOwner.set(k, legacyId);
    } else warnings.push(`Stock item "${r['description']}" (${type}) has no stock code; imported without one`);
    const sizeCode = (r['size'] ?? '').trim() || null;
    const isEnvelope = type === 'Outer Envelope';
    if (flag(r['isEnvelope']) !== isEnvelope) skip('stockEnvelopeFlagCorrected', 'isEnvelope flag corrected from type');
    if (sizeCode && !sizes.has(sizeCode)) sizes.set(sizeCode, { code: sizeCode, widthMm: num(r['width']), heightMm: num(r['height']) });
    const wh = !!code && /^WH/i.test(code);
    if (flag(r['isStockManaged']) !== wh) skip('stockManagedFlagFromCode', 'isStockManaged set from WH code');
    stock.push({
      legacyId, parentLegacyId: stockIds.has(lc(r['id_parent'])) ? lc(r['id_parent']) : null,
      customerLegacyId: accountIds.has(lc(r['id_customer'])) ? lc(r['id_customer']) : null, brandLegacyId: brandIds.has(lc(r['id_brand'])) ? lc(r['id_brand']) : null,
      code, type, description: (r['description'] ?? '').trim(), reference: (r['reference'] ?? '').trim() || null, productCode: (r['productCode'] ?? '').trim() || null,
      isEnvelope, isInsert: flag(r['isInsert']), sizeCode, weightG: num(r['weight']) ?? 0, thicknessMm: num(r['thickness']) ?? 0,
      widthMm: num(r['width']), heightMm: num(r['height']),
      windowWidthMm: WINDOW_NA(num(r['windowWidth'])), windowHeightMm: WINDOW_NA(num(r['windowHeight'])),
      isStockManaged: wh, isActive: flag(r['isActive']), maxSheets: num(r['maximumSheets']), capacityMm: num(r['capacity']),
    });
  }
  // Business decision: stock with no resolvable owner and no warehouse (WH) code is junk and is dropped.
  const excludedStock = stock.filter((s) => s.customerLegacyId === null && !(s.code && /^WH/i.test(s.code))).map((s) => s.legacyId);
  if (excludedStock.length) {
    const gone = new Set(excludedStock);
    for (let i = stock.length - 1; i >= 0; i--) if (gone.has(stock[i]!.legacyId)) stock.splice(i, 1);
    for (const s of stock) if (s.parentLegacyId && gone.has(s.parentLegacyId)) s.parentLegacyId = null;
    skipped['stockDroppedNoOwner'] = excludedStock.length;
  }
  const stockById = new Map(stock.map((s) => [s.legacyId, s]));

  // ---- postal catalogue (bands from the account configuration, services from the live envelope rows) -------------
  const bands = new Map<string, number[]>();   // provider|format|service -> [min,max,min,max...]
  for (const r of x.customers) {
    const pr = json<Record<string, Record<string, Record<string, Record<string, { minWeight: number; maxWeight: number }>>>>>(r['postageRatesJSON']);
    for (const [prov, fm] of Object.entries(pr ?? {})) for (const [fmt, sv] of Object.entries(fm)) for (const [svc, wb] of Object.entries(sv))
      for (const b of Object.values(wb)) {
        const k = `${prov}|${fmt}|${svc}`; const list = bands.get(k) ?? [];
        if (!list.some((_, i) => i % 2 === 0 && list[i] === b.minWeight && list[i + 1] === b.maxWeight)) list.push(b.minWeight, b.maxWeight);
        bands.set(k, list);
      }
  }
  const rates = new Map<string, PlanRate>();
  const addRate = (provider: string, format: string, service: string, serviceCode: string | null, minG: number, maxG: number): void => {
    const k = `${provider}|${format}|${service}|${maxG}`.toLowerCase();
    const have = rates.get(k);
    if (!have) rates.set(k, { provider, format, service, serviceCode, minG, maxG });
    else { have.minG = Math.min(have.minG, minG); have.serviceCode ??= serviceCode; }
  };
  for (const [k, list] of bands) { const [p, f, s] = k.split('|') as [string, string, string]; for (let i = 0; i < list.length; i += 2) addRate(p, f, s, null, list[i]!, list[i + 1]!); }

  // ---- envelopes ----------------------------------------------------------------------------------------------
  const envelopes: PlanEnvelope[] = []; const seen = new Map<string, string>();
  let fallbackBand = 0;
  for (const r of x.envelopes) {
    const id = lc(r['id']);
    if (!envelopeIdSet.has(id)) { skip('envelopesStale', ''); continue; }      // not referenced by any account: stale (confirmed)
    if (flag(r['isDeleted'])) { skip('envelopesDeleted', ''); continue; }
    const cust = lc(r['id_customer']); const stockId = lc(r['id_stockItem']);
    if (!accountIds.has(cust)) { skip('envelopesUnknownCustomer', 'Envelope skipped (customer not in export)', id); continue; }
    if (!stockById.has(stockId)) { skip('envelopesMissingStock', ''); continue; }   // confirmed: dropped
    const provider = (r['postalProvider'] ?? '').trim(); const format = (r['postalFormat'] ?? '').trim(); const service = (r['postalService'] ?? '').trim(); const maxG = num(r['maxWeight']);
    if (!provider || !format || !service || maxG === null) { skip('envelopesNoPostal', 'Envelope skipped (no provider/format/service/weight)', id); continue; }
    addRate(provider, format, service, (r['postalServiceCode'] ?? '').trim() || null, 0, maxG);
    let band = (r['externalService'] ?? '').trim();
    if (!band) { band = service; fallbackBand++; }
    const brand = lc(r['id_brand']);
    const reference = (r['externalReference'] ?? '').trim() || (r['internalReference'] ?? '').trim() || null;
    const key = [cust, brand, band.toLowerCase(), provider, format, service, maxG, (reference ?? '').toLowerCase()].join('|');
    if (seen.has(key)) { skip('envelopesCollision', 'Envelope skipped (same customer/brand/band/rate/reference as another)', `${r['customer']} / ${r['brand']} / ${band} / ${format} / ${service} / ${maxG}g / ${reference ?? ''}`); continue; }
    seen.set(key, id);
    envelopes.push({ legacyId: id, customerLegacyId: cust, brandLegacyId: brandIds.has(brand) ? brand : null, stockLegacyId: stockId, deliveryBand: band,
      rate: { provider, format, service, maxG }, externalName: (r['externalName'] ?? '').trim() || null, reference, isOversticker: flag(r['isOverSticker']) });
  }
  if (fallbackBand) skipped['envelopesBandFromService'] = fallbackBand;
  const { models: costing, inherit: costingInherit } = buildCostingPlan(x, accounts, envelopes, new Set(stock.map((s) => s.legacyId)), (a) => settingsOwner(accById, a), (w) => warnings.push(w),
    (k) => { skipped[k] = (skipped[k] ?? 0) + 1; });
  return { excludedStock, accounts, brands, sizes: [...sizes.values()], stock, rates: [...rates.values()], envelopes, costing, costingInherit, warnings, skipped };
}

export function summarise(p: Plan): string[] {
  const own = p.accounts.filter((a) => !a.inheritsSettings).length;
  const L = [
    `Accounts   ${p.accounts.length} (${own} customers, ${p.accounts.length - own} inheriting settings, ${p.accounts.filter((a) => a.isDeleted).length} deleted)`,
    `           ${p.accounts.reduce((n, a) => n + a.matchRules.length, 0)} address-match rules, ${p.accounts.reduce((n, a) => n + a.sequenceRules.length, 0)} pack-sequence rules, ${p.accounts.reduce((n, a) => n + a.emails.length, 0)} notification emails`,
    `Brands     ${p.brands.length}`,
    `Stock      ${p.stock.length} items (${p.stock.filter((s) => s.code === null).length} without a code, ${p.stock.filter((s) => s.code && !/^WH/i.test(s.code)).length} with a provisional non-WH code), ${p.sizes.length} envelope sizes`,
    `Postal     ${new Set(p.rates.map((r) => r.provider)).size} providers, ${new Set(p.rates.map((r) => `${r.provider}|${r.format}|${r.service}`)).size} services, ${p.rates.length} weight-band rates`,
    `Envelopes  ${p.envelopes.length}`,
    `Prices     ${p.costing.length} price lists to add (switched off, no dates; ${p.costing.reduce((n, m) => n + m.envelopes.length, 0)} envelope prices), ${p.costingInherit.length} accounts use their parent's prices`,
  ];
  for (const [k, v] of Object.entries(p.skipped)) L.push(`  note: ${k} = ${v}`);
  return L;
}
