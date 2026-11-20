import { parseEnvelopeText } from './envelopeText.js';
import type { IngestPack } from './types.js';
import type { EnvelopeOption, ReferenceData, AccountConfig, StockItem } from './reference.js';

export interface Physical {
  sheets: number;
  weightG: number;
  thicknessMm: number;
  postalFormat: string;
  envelope: EnvelopeOption;
  insertCodes: { code: string; quantity: number }[];
  /** true when nothing configured fitted and the customer's own envelope selection was used instead */
  fallback: boolean;
}

export class PhysicalError extends Error {}

/** Expand linked stock (children) so their weight/thickness count too. */
function insertItems(codes: { code: string; quantity: number }[], ref: ReferenceData): { item: StockItem; qty: number }[] {
  const out: { item: StockItem; qty: number }[] = [];
  for (const c of codes) {
    const item = ref.stock.get(c.code);
    if (!item) throw new PhysicalError(`Unknown insert stock code ${c.code}`);
    out.push({ item, qty: c.quantity });
    for (const child of item.linked ?? []) {
      const ci = ref.stock.get(child);
      if (!ci) throw new PhysicalError(`Unknown linked stock code ${child} (child of ${c.code})`);
      out.push({ item: ci, qty: c.quantity });
    }
  }
  return out;
}

/**
 * Chooses postal format + outer envelope from the real make-up of the mailpiece, whatever envelope the customer asked for.
 *
 *  1. Weight of the CONTENTS only: sheets x A4 sheet weight + inserts. The envelope is not added yet because its own weight
 *     depends on which envelope is chosen (C5 8 g vs C4 17 g) and can change the postal format.
 *  2. Formats are tried smallest first (Letter, Large Letter, Small Parcel, Medium Parcel). For each, the account's envelopes for this
 *     brand / reference / delivery band are tried from the lowest weight band up; the pack weight INCLUDING that envelope must fit
 *     the band and the format's weight, thickness and sheet limits. The first fit wins.
 *  3. If nothing configured fits, fall back to the envelope the customer selected (same stock code, else same size) and flag it.
 */
export function choosePhysical(
  packs: IngestPack[],
  insertCodes: { code: string; quantity: number }[],
  account: AccountConfig,
  brand: string | null,
  reference: string,
  requested: { code: string; value: string },
  deliveryMethod: string,
  ref: ReferenceData,
): Physical {
  const s = ref.settings;
  const sheets = packs.reduce((n, p) => n + p.sheets, 0);
  const ins = insertItems(insertCodes, ref);
  const contentWeight = sheets * s.a4SheetWeightG + ins.reduce((n, i) => n + i.item.weightG * i.qty, 0);
  const thickness = sheets * s.a4SheetThicknessMm + ins.reduce((n, i) => n + i.item.thicknessMm * i.qty, 0);
  const formats = [...ref.postalFormats].sort((a, b) => a.rank - b.rank);
  const stockWeight = (code: string): number => {
    const item = ref.stock.get(code);
    if (!item) throw new PhysicalError(`Unknown envelope stock code ${code}`);
    return item.weightG;
  };
  const result = (fmt: string, opt: EnvelopeOption, weight: number, fallback: boolean): Physical =>
    ({ sheets, weightG: weight, thicknessMm: Math.round(thickness * 1000) / 1000, postalFormat: fmt, envelope: opt, insertCodes, fallback });

  for (const fmt of formats) {
    if (contentWeight > fmt.maxWeightG) continue;
    if (fmt.maxThicknessMm !== null && thickness > fmt.maxThicknessMm) continue;
    if (fmt.maxSheets !== null && sheets > fmt.maxSheets) continue;
    for (const opt of optionsFor(account, brand, reference, deliveryMethod).filter((e) => e.postalFormat === fmt.name)) {
      const weight = Math.ceil(contentWeight + stockWeight(opt.stockCode));
      if (weight <= fmt.maxWeightG && (opt.maxWeightG === undefined || weight <= opt.maxWeightG)) return result(fmt.name, opt, weight, false);
    }
  }

  // Fallback: what the customer selected
  const wanted = parseEnvelopeText(requested.value);
  const sameBand = (e: EnvelopeOption): boolean => e.deliveryBand === undefined || e.deliveryBand.toUpperCase() === deliveryMethod.toUpperCase();
  const sameBrand = (e: EnvelopeOption): boolean => (e.brand ?? null) === (brand ?? null);
  const pool = account.envelopes.filter((e) => sameBand(e) && (e.stockCode === requested.code || (wanted.size !== null && e.size.toUpperCase() === wanted.size)));
  // prefer the selected envelope for this brand and reference, then this brand, then anything the customer's selection points at
  const tiers = [pool.filter((e) => sameBrand(e) && e.reference === reference), pool.filter(sameBrand), pool];
  const selected = tiers.find((t) => t.length > 0) ?? [];
  const byFormat = (e: EnvelopeOption): number => formats.find((f) => f.name === e.postalFormat)?.rank ?? 99;
  for (const opt of [...selected].sort((a, b) => byFormat(a) - byFormat(b) || (a.maxWeightG ?? Infinity) - (b.maxWeightG ?? Infinity))) {
    const weight = Math.ceil(contentWeight + stockWeight(opt.stockCode));
    if (opt.maxWeightG === undefined || weight <= opt.maxWeightG) return result(opt.postalFormat, opt, weight, true);
  }
  const last = [...selected].sort((a, b) => byFormat(b) - byFormat(a) || (b.maxWeightG ?? Infinity) - (a.maxWeightG ?? Infinity))[0];
  if (last) return result(last.postalFormat, last, Math.ceil(contentWeight + stockWeight(last.stockCode)), true);
  throw new PhysicalError(`Account ${account.code}: no envelope configured for brand=${brand ?? '-'} ref=${reference || '-'} service=${deliveryMethod} that fits ${sheets} sheets / ${Math.ceil(contentWeight)}g, and none matches the selected envelope "${requested.value}"`);
}

/** Envelopes configured for this brand, reference (exact, else the customer-wide ones) and delivery band, lowest weight band first. */
function optionsFor(a: AccountConfig, brand: string | null, reference: string, deliveryMethod: string): EnvelopeOption[] {
  const base = a.envelopes.filter((e) => (e.brand ?? null) === (brand ?? null)
    && (e.deliveryBand === undefined || e.deliveryBand.toUpperCase() === deliveryMethod.toUpperCase()));
  const exact = base.filter((e) => e.reference === reference);
  return (exact.length ? exact : base.filter((e) => e.reference === '')).sort((x, y) => (x.maxWeightG ?? Infinity) - (y.maxWeightG ?? Infinity));
}
