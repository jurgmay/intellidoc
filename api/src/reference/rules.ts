import { ConflictError, ValidationError } from '../errors.js';
import type { FormatInput, FormatView } from './types.js';

/**
 * The form an anonymous addressee is stored and matched in: the same as the import's line normalisation (upper case, "&" -> AND, punctuation to spaces,
 * spaces squeezed) with the spaces then removed, so "The Occupier", "THE  OCCUPIER" and "the-occupier" are one entry.
 */
export function normaliseAnonymous(s: string): string {
  return s.toUpperCase().replace(/&/g, ' AND ').replace(/[-.,'’`/]/g, ' ').replace(/\s+/g, ' ').trim().replace(/ /g, '');
}

/** The formats are tried smallest first, so a bigger format cannot take less weight, thickness or sheets than a smaller one. `others` excludes the one being changed. */
export function checkFormatLimits(self: FormatView, input: FormatInput, others: FormatView[]): void {
  const errs: Record<string, string> = {};
  const smaller = others.filter((o) => o.rank < self.rank).sort((a, b) => b.rank - a.rank)[0];
  const larger = others.filter((o) => o.rank > self.rank).sort((a, b) => a.rank - b.rank)[0];
  const check = (key: string, label: string, v: number | null, get: (f: FormatView) => number | null): void => {
    if (v === null) return;
    const lo = smaller ? get(smaller) : null, hi = larger ? get(larger) : null;
    if (lo !== null && v < lo) errs[key] = `${label} cannot be less than ${smaller!.name} (${lo})`;
    else if (hi !== null && v > hi) errs[key] = `${label} cannot be more than ${larger!.name} (${hi})`;
  };
  check('maxWeightG', 'Most weight', input.maxWeightG, (f) => f.maxWeightG);
  check('maxThicknessMm', 'Most thickness', input.maxThicknessMm, (f) => f.maxThicknessMm);
  check('maxSheets', 'Most sheets', input.maxSheets, (f) => f.maxSheets);
  check('maxWidthMm', 'Most width', input.maxWidthMm, (f) => f.maxWidthMm);
  check('maxHeightMm', 'Most height', input.maxHeightMm, (f) => f.maxHeightMm);
  if (Object.keys(errs).length) throw new ValidationError(errs);
}

export const paperInUse = (name: string, n: number): ConflictError => new ConflictError(`${name} is used by ${n} print option${n === 1 ? '' : 's'}, so it cannot be deleted.`);
