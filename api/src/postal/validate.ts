import { ValidationError } from '../errors.js';
import type { PriceChangeInput, RateInput, ServiceInput } from './types.js';

type Body = Record<string, unknown> | null | undefined;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const done = (errs: Record<string, string>): void => { if (Object.keys(errs).length) throw new ValidationError(errs); };
function isDate(s: unknown): s is string {
  if (typeof s !== 'string' || !DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function text(errs: Record<string, string>, v: unknown, key: string, label: string, max: number, required: boolean): string | null {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) { if (required) errs[key] = `${label} is required`; return null; }
  if (typeof v !== 'string') { errs[key] = `${label} must be text`; return null; }
  const t = v.trim();
  if (t.length > max) { errs[key] = `${label} can be at most ${max} characters`; return null; }
  return t;
}
/** A price: empty (not set) or a number from 0 with at most 4 decimal places that fits DECIMAL(10,4). */
function price(errs: Record<string, string>, key: string, label: string, v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || !Number.isFinite(v)) { errs[key] = `${label} must be a number`; return null; }
  if (v < 0) { errs[key] = `${label} cannot be negative`; return null; }
  if (v >= 1e5) { errs[key] = `${label} is too large`; return null; }
  if (Math.abs(Math.round(v * 1e4) / 1e4 - v) > 1e-9) { errs[key] = `${label} can have at most 4 decimal places`; return null; }
  return Math.round(v * 1e4) / 1e4;
}

export function parseName(body: Body, label = 'Name'): string {
  const errs: Record<string, string> = {};
  const n = text(errs, body?.['name'], 'name', label, 100, true);
  done(errs);
  return n!;
}

export function parseService(body: Body): ServiceInput {
  const errs: Record<string, string> = {};
  const name = text(errs, body?.['name'], 'name', 'Name', 100, true);
  const code = text(errs, body?.['serviceCode'], 'serviceCode', 'Service code', 50, false);
  const f = body?.['formatId'];
  if (!Number.isInteger(f) || (f as number) < 1) errs['formatId'] = 'Choose a format';
  const flag = (k: string, label: string): boolean => { const v = body?.[k]; if (typeof v !== 'boolean') { errs[k] = `${label} must be on or off`; return false; } return v; };
  const signed = flag('isSignedFor', 'Signed for'); const tracked = flag('isTracked', 'Tracked'); const recorded = flag('isRecorded', 'Recorded');
  done(errs);
  return { formatId: f as number, name: name!, serviceCode: code, isSignedFor: signed, isTracked: tracked, isRecorded: recorded };
}

export function parseRate(body: Body): RateInput {
  const errs: Record<string, string> = {};
  const w = (k: string, label: string): number => {
    const v = body?.[k];
    if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 1_000_000) { errs[k] = `${label} must be a whole number of grams, 0 or more`; return 0; }
    return v as number;
  };
  const min = w('minWeightG', 'The lowest weight'); const max = w('maxWeightG', 'The highest weight');
  if (!errs['minWeightG'] && !errs['maxWeightG'] && max < min) errs['maxWeightG'] = 'The highest weight cannot be below the lowest';
  const from = body?.['validFrom']; const to = body?.['validTo'] ?? null;
  if (!isDate(from)) errs['validFrom'] = 'Enter the first day this price applies';
  if (to !== null && !isDate(to)) errs['validTo'] = 'Enter a valid last day, or leave it empty';
  if (isDate(from) && isDate(to) && to < from) errs['validTo'] = 'The last day cannot be before the first day';
  const cost = price(errs, 'cost', 'Cost', body?.['cost']); const sell = price(errs, 'sellPrice', 'Sell price', body?.['sellPrice']);
  done(errs);
  return { minWeightG: min, maxWeightG: max, validFrom: from as string, validTo: to as string | null, cost, sellPrice: sell };
}

export function parsePriceChange(body: Body): PriceChangeInput {
  const errs: Record<string, string> = {};
  const d = body?.['effectiveFrom'];
  if (!isDate(d)) errs['effectiveFrom'] = 'Enter the first day the new prices apply';
  const list = body?.['changes'];
  const changes: PriceChangeInput['changes'] = [];
  if (!Array.isArray(list) || list.length === 0) errs['changes'] = 'Enter at least one new price';
  else list.forEach((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    if (!Number.isInteger(r['rateId']) || (r['rateId'] as number) < 1) errs[`changes.${i}.rateId`] = 'Unknown price';
    changes.push({ rateId: r['rateId'] as number, cost: price(errs, `changes.${i}.cost`, 'Cost', r['cost']), sellPrice: price(errs, `changes.${i}.sellPrice`, 'Sell price', r['sellPrice']) });
  });
  done(errs);
  return { effectiveFrom: d as string, changes };
}
