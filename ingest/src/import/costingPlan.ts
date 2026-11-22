import type { ChargeCode } from '../costing/types.js';
import { type Row, json, lc, num } from './mer.js';
import type { PlanAccount, PlanEnvelope } from './plan.js';

export interface PlanCharge { code: ChargeCode; cost: number; sellPrice: number; adjustment: number }
export interface PlanCostingEnvelope { stockLegacyId: string; cost: number; sellPrice: number; adjustment: number }
/** One price list to add, as a switched-off draft with no dates, to the account that holds it. */
export interface PlanCostingModel {
  /** FileMaker's costing model id (customers.id_costingModel). */
  sourceId: string; hostLegacyId: string; name: string; comments: string;
  charges: PlanCharge[]; envelopes: PlanCostingEnvelope[];
}

type Json = Record<string, unknown>;
const at = (j: unknown, path: string[]): unknown => path.reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Json)[k] : undefined), j);
const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** costingModelJSON path of each priced charge (cost, sellPrice and adjustment). */
const PRICED: [ChargeCode, string[]][] = [
  ['HPOD', ['processing', 'hpod']], ['PROCESSING', ['processing', 'service']], ['ADDRESS_MATCHING', ['extras', 'addressMatching']], ['PAPER_SHEET', ['printing', 'paper']],
  ['COLOUR_PAGE', ['printing', 'colourPage']], ['MONO_PAGE', ['printing', 'monoPage']], ['BLANK_PAGE', ['printing', 'blankPage']], ['INSERT', ['extras', 'inserting']],
  ['MACHINE_ENCLOSING_SETUP', ['enclosing', 'machine', 'setup']], ['MACHINE_ENCLOSING_SHEET', ['enclosing', 'machine', 'run']],
  ['HAND_ENCLOSING_SETUP', ['enclosing', 'hand', 'setup']], ['HAND_ENCLOSING_SHEET', ['enclosing', 'hand', 'run']],
  ['BAGGING', ['admin', 'bagging']], ['OVERSTICKERING', ['extras', 'overstickering']],
];
/** Charges that are only an adjustment. */
const ADJUSTMENTS: [ChargeCode, string[]][] = [
  ['ADJUSTMENT', ['adjustment']], ['HAND_SMALL_BATCH_ADJUSTMENT', ['enclosing', 'hand', 'smallBatchAdjustment']],
  ['HAND_LETTER_ADJUSTMENT', ['enclosing', 'hand', 'letterAdjustment']], ['HAND_LARGE_LETTER_ADJUSTMENT', ['enclosing', 'hand', 'largeLetterAdjustment']],
];
/** Prices FileMaker holds that the web app has no charge for. Reported, not imported. */
const NOT_IMPORTED: [string, string[]][] = [['laminated sheet', ['extras', 'laminatedSheet']], ['geo', ['extras', 'geo']]];

export function chargesFrom(model: unknown): PlanCharge[] {
  const out: PlanCharge[] = [];
  for (const [code, path] of PRICED) {
    const node = at(model, path);
    if (node && typeof node === 'object') out.push({ code, cost: n((node as Json)['cost']), sellPrice: n((node as Json)['sellPrice']), adjustment: n((node as Json)['adjustment']) });
  }
  for (const [code, path] of ADJUSTMENTS) { const v = n(at(model, path)); if (v !== 0) out.push({ code, cost: 0, sellPrice: 0, adjustment: v }); }
  return out;
}

/**
 * FileMaker keeps each customer's price list in customers.costingModelJSON (and its id in id_costingModel); many customers share one list.
 * Price lists are only needed on the account that holds them: a sub-account that shares its parent's list is set to use the parent's prices
 * instead of getting a copy. Everything is added as a switched-off draft with no dates, so nothing is priced until someone dates and switches it on.
 * The outer envelope prices come from the stock items the accounts' envelope settings use.
 */
export function buildCostingPlan(
  x: { customers: Row[]; stock: Row[] }, accounts: PlanAccount[], envelopes: PlanEnvelope[], stockIds: Set<string>,
  owner: (a: PlanAccount) => PlanAccount, warn: (s: string) => void, count: (k: string) => void,
): { models: PlanCostingModel[]; inherit: string[] } {
  const accById = new Map(accounts.map((a) => [a.legacyId, a]));
  const row = new Map(x.customers.map((r) => [lc(r['id']), r]));
  const stockRow = new Map(x.stock.map((r) => [lc(r['id']), r]));
  // the price list of each account that has a readable one
  const listOf = new Map<string, { sourceId: string; model: unknown }>();
  for (const a of accounts) {
    const r = row.get(a.legacyId); if (!r) continue;
    const sourceId = lc(r['id_costingModel']); const model = json(r['costingModelJSON']);
    if (!sourceId || !model) { if (sourceId || (r['costingModelJSON'] ?? '').trim()) warn(`Account ${a.code}: its price list could not be read; nothing imported for it`); continue; }
    listOf.set(a.legacyId, { sourceId, model });
  }
  // The accounts that hold a list: those that hold their own settings. Others (inheriting everything) use their owner's.
  const holders = new Map<string, string>();      // holder legacy id -> source model id
  for (const a of accounts) {
    const o = owner(a);
    const own = listOf.get(o.legacyId) ?? listOf.get(a.legacyId);
    if (own && !holders.has(o.legacyId)) holders.set(o.legacyId, own.sourceId);
  }
  const parentHolder = (h: PlanAccount): PlanAccount | null => (h.parentLegacyId ? owner(accById.get(h.parentLegacyId)!) : null);
  const inherit: string[] = [];
  for (const [id, src] of holders) {
    const p = parentHolder(accById.get(id)!);
    if (p && holders.get(p.legacyId) === src) inherit.push(id);     // same list as the nearest account above that holds one
  }
  const inheriting = new Set(inherit);
  const hostOf = (a: PlanAccount): string => {
    let o = owner(a);
    for (let i = 0; i < 100 && inheriting.has(o.legacyId); i++) o = parentHolder(o)!;
    return o.legacyId;
  };
  const models: PlanCostingModel[] = [];
  for (const [id, src] of holders) {
    if (inheriting.has(id)) continue;
    const a = accById.get(id)!;
    const list = listOf.get(id) ?? listOf.get([...listOf.keys()].find((k) => listOf.get(k)!.sourceId === src && owner(accById.get(k)!).legacyId === id) ?? '');
    if (!list) continue;
    for (const [label, path] of NOT_IMPORTED) {
      const node = at(list.model, path) as Json | undefined;
      if (node && (n(node['cost']) !== 0 || n(node['sellPrice']) !== 0)) { count('costingPricesNotImported'); warn(`Price list of ${a.code}: ${label} (cost ${n(node['cost'])}, sell ${n(node['sellPrice'])}) has no matching charge in the web app and is not imported`); }
    }
    // envelope prices for every envelope this list will price: the holder's and those of the accounts that use it
    const stockOf = new Set<string>();
    for (const e of envelopes) { const ea = accById.get(e.customerLegacyId); if (ea && hostOf(ea) === id) stockOf.add(e.stockLegacyId); }
    const envs: PlanCostingEnvelope[] = [];
    for (const sid of stockOf) {
      const r = stockRow.get(sid); if (!r || !stockIds.has(sid)) continue;
      const cost = num(r['cost']); const sell = num(r['sellPrice']);
      if (cost === null && sell === null) { count('costingEnvelopesWithoutPrice'); continue; }
      envs.push({ stockLegacyId: sid, cost: cost ?? 0, sellPrice: sell ?? 0, adjustment: num(r['sellPriceAdjustment']) ?? 0 });
    }
    models.push({ sourceId: src, hostLegacyId: id, name: `${a.name.slice(0, 170)} prices (imported)`, comments: `Imported from FileMaker (costing model ${src}). No dates and switched off: give it a first day and switch it on to use it.`,
      charges: chargesFrom(list.model), envelopes: envs });
  }
  return { models, inherit };
}
