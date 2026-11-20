import type { IngestPack } from './types.js';
import type { EnvelopeOption, ReferenceData, AccountConfig, StockItem } from './reference.js';

export interface Physical {
  sheets: number;
  weightG: number;
  thicknessMm: number;
  postalFormat: string;
  envelope: EnvelopeOption;
  insertCodes: { code: string; quantity: number }[];
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
 * Chooses postal format + outer envelope from the real physical make-up (sheets, inserts, envelope),
 * regardless of the envelope size the customer asked for. Formats are walked smallest first; because the
 * envelope's own weight depends on the envelope chosen, we iterate until stable (formats only move up).
 */
export function choosePhysical(
  packs: IngestPack[],
  insertCodes: { code: string; quantity: number }[],
  account: AccountConfig,
  brand: string | null,
  reference: string,
  requestedEnvelopeCode: string,
  ref: ReferenceData,
): Physical {
  const s = ref.settings;
  const sheets = packs.reduce((n, p) => n + p.sheets, 0);
  const ins = insertItems(insertCodes, ref);
  const insWeight = ins.reduce((n, i) => n + i.item.weightG * i.qty, 0);
  const insThick = ins.reduce((n, i) => n + i.item.thicknessMm * i.qty, 0);
  const thickness = sheets * s.a4SheetThicknessMm + insThick;
  const formats = [...ref.postalFormats].sort((a, b) => a.rank - b.rank);

  const requested = ref.stock.get(requestedEnvelopeCode);
  if (!requested) throw new PhysicalError(`Unknown envelope stock code ${requestedEnvelopeCode}`);
  let envWeight = requested.weightG;
  let fmtIdx = 0;

  for (let guard = 0; guard <= formats.length + 1; guard++) {
    const weight = Math.ceil(sheets * s.a4SheetWeightG + insWeight + envWeight);
    // smallest format at or above the current one that fits
    let idx = fmtIdx;
    while (idx < formats.length) {
      const f = formats[idx]!;
      const fits = weight <= f.maxWeightG
        && (f.maxThicknessMm === null || thickness <= f.maxThicknessMm)
        && (f.maxSheets === null || sheets <= f.maxSheets);
      if (fits) break;
      idx++;
    }
    if (idx >= formats.length) throw new PhysicalError(`No postal format fits ${sheets} sheets / ${weight}g / ${thickness.toFixed(2)}mm`);
    fmtIdx = idx;
    const fmt = formats[idx]!;
    const opt = pickEnvelope(account, brand, reference, fmt.name);
    if (!opt) throw new PhysicalError(`Account ${account.code}: no envelope configured for brand=${brand ?? '-'} ref=${reference || '-'} format=${fmt.name}`);
    const chosen = ref.stock.get(opt.stockCode);
    if (!chosen) throw new PhysicalError(`Unknown envelope stock code ${opt.stockCode}`);
    if (chosen.weightG === envWeight) {
      return { sheets, weightG: weight, thicknessMm: Math.round(thickness * 1000) / 1000, postalFormat: fmt.name, envelope: opt, insertCodes };
    }
    envWeight = chosen.weightG; // recompute with the real envelope; format can only go up
  }
  throw new PhysicalError('Envelope/format selection did not converge');
}

function pickEnvelope(a: AccountConfig, brand: string | null, reference: string, format: string): EnvelopeOption | undefined {
  const base = a.envelopes.filter((e) => e.postalFormat === format && (e.brand ?? null) === (brand ?? null));
  return base.find((e) => e.reference === reference) ?? base.find((e) => e.reference === '');
}
