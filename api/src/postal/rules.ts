import { ConflictError, ValidationError } from '../errors.js';
import type { RateStatus } from './types.js';

export const bandLabel = (min: number, max: number): string => `${min <= 1 ? 'up to ' : `${min}–`}${max}g`;
const FAR = '9999-12-31';

/** Two date ranges (a last day of null = open) share at least one day. */
export const overlaps = (aFrom: string, aTo: string | null, bFrom: string, bTo: string | null): boolean => aFrom <= (bTo ?? FAR) && bFrom <= (aTo ?? FAR);

export function statusOf(validFrom: string, validTo: string | null, today: string): RateStatus {
  if (validFrom > today) return 'planned';
  if (validTo !== null && validTo < today) return 'ended';
  return 'current';
}
export const dayBefore = (d: string): string => new Date(Date.parse(`${d}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

export interface BandRow { id: number; minWeightG: number; maxWeightG: number; validFrom: string; validTo: string | null }

/** A band (same service, same weights) can only be priced by one row on any day. `others` are the other rows of the service. */
export function checkNoOverlap(candidate: Omit<BandRow, 'id'>, others: BandRow[]): void {
  const clash = others.find((o) => o.minWeightG === candidate.minWeightG && o.maxWeightG === candidate.maxWeightG && overlaps(candidate.validFrom, candidate.validTo, o.validFrom, o.validTo));
  if (clash) throw new ConflictError(`Another price for ${bandLabel(clash.minWeightG, clash.maxWeightG)} already covers ${clash.validFrom} to ${clash.validTo ?? 'until replaced'}. Change that one, or choose dates that do not overlap.`);
}

export interface PlannedChange { row: BandRow; cost: number | null; sellPrice: number | null }

/** Works out which rows end and which start for a dated price change, or says why it cannot be done. */
export function planPriceChange(effectiveFrom: string, today: string, rows: BandRow[], changes: { rateId: number; cost: number | null; sellPrice: number | null }[]): PlannedChange[] {
  if (effectiveFrom < today) throw new ValidationError({ effectiveFrom: 'The new prices must start today or later. Earlier mail was priced with the prices of its day.' });
  const out: PlannedChange[] = [];
  changes.forEach((c, i) => {
    const row = rows.find((r) => r.id === c.rateId);
    if (!row) throw new ValidationError({ [`changes.${i}.rateId`]: 'That price does not belong to this service' });
    if (row.validFrom >= effectiveFrom) throw new ConflictError(`The price for ${bandLabel(row.minWeightG, row.maxWeightG)} already starts on ${row.validFrom}. Edit that row instead.`);
    if (row.validTo !== null && row.validTo < effectiveFrom) throw new ConflictError(`The price for ${bandLabel(row.minWeightG, row.maxWeightG)} has already ended before ${effectiveFrom}.`);
    const later = rows.find((o) => o.id !== row.id && o.minWeightG === row.minWeightG && o.maxWeightG === row.maxWeightG && o.validFrom > row.validFrom && o.validFrom >= effectiveFrom);
    if (later) throw new ConflictError(`A price for ${bandLabel(row.minWeightG, row.maxWeightG)} already starts on ${later.validFrom}. Edit that row instead.`);
    out.push({ row, cost: c.cost, sellPrice: c.sellPrice });
  });
  return out;
}
