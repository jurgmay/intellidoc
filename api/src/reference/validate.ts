import { ValidationError } from '../errors.js';
import { normaliseAnonymous } from './rules.js';
import type { FormatInput, PaperInput } from './types.js';

type Body = Record<string, unknown> | null | undefined;
const done = (errs: Record<string, string>): void => { if (Object.keys(errs).length) throw new ValidationError(errs); };

function text(errs: Record<string, string>, v: unknown, key: string, label: string, max: number, required: boolean): string | null {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) { if (required) errs[key] = `${label} is required`; return null; }
  if (typeof v !== 'string') { errs[key] = `${label} must be text`; return null; }
  const t = v.trim();
  if (t.length > max) { errs[key] = `${label} can be at most ${max} characters`; return null; }
  return t;
}
function whole(errs: Record<string, string>, v: unknown, key: string, label: string, max: number, required: boolean): number | null {
  if (v === undefined || v === null) { if (required) errs[key] = `${label} is required`; return null; }
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) { errs[key] = `${label} must be a whole number of at least 1`; return null; }
  if (v > max) { errs[key] = `${label} is too large`; return null; }
  return v;
}

export function parsePaper(body: Body): PaperInput {
  const errs: Record<string, string> = {};
  const batchName = text(errs, body?.['batchName'], 'batchName', 'Batch name', 100, true);
  const paperCode = text(errs, body?.['paperCode'], 'paperCode', 'Paper code', 50, false);
  done(errs);
  return { batchName: batchName!, paperCode };
}

export function parseFormat(body: Body): FormatInput {
  const errs: Record<string, string> = {};
  const maxWeightG = whole(errs, body?.['maxWeightG'], 'maxWeightG', 'Most weight', 1_000_000, true);
  const t = body?.['maxThicknessMm'];
  let maxThicknessMm: number | null = null;
  if (t !== undefined && t !== null) {
    if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) errs['maxThicknessMm'] = 'Most thickness must be a number above 0';
    else if (t >= 10000) errs['maxThicknessMm'] = 'Most thickness is too large';
    else if (Math.abs(Math.round(t * 100) / 100 - t) > 1e-9) errs['maxThicknessMm'] = 'Most thickness can have at most 2 decimal places';
    else maxThicknessMm = Math.round(t * 100) / 100;
  }
  const maxSheets = whole(errs, body?.['maxSheets'], 'maxSheets', 'Most sheets', 1_000_000, false);
  done(errs);
  return { maxWeightG: maxWeightG!, maxThicknessMm, maxSheets };
}

/** The normalised text of a new anonymous addressee; the field must hold some letters or digits. */
export function parseAnonymous(body: Body): string {
  const errs: Record<string, string> = {};
  const raw = text(errs, body?.['text'], 'text', 'Addressee', 200, true);
  done(errs);
  const n = normaliseAnonymous(raw!);
  if (!/[A-Z0-9]/.test(n)) throw new ValidationError({ text: 'Addressee must contain letters or numbers' });
  return n;
}
