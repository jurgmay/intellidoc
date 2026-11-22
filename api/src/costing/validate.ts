import { ValidationError } from '../errors.js';
import { CHARGE_CODES, type ChargeCode, type CostingMode, type ModelInput, type NewModelInput } from './types.js';

type Body = Record<string, unknown> | null | undefined;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const done = (errs: Record<string, string>): void => { if (Object.keys(errs).length) throw new ValidationError(errs); };

function isDate(s: unknown): s is string {
  if (typeof s !== 'string' || !DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
/** A price: a number with at most 4 decimal places that fits DECIMAL(12,4). Adjustments may be negative; costs and sell prices may not. */
function money(errs: Record<string, string>, key: string, label: string, v: unknown, allowNegative: boolean): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) { errs[key] = `${label} must be a number`; return 0; }
  if (!allowNegative && v < 0) { errs[key] = `${label} cannot be negative`; return 0; }
  if (Math.abs(v) >= 1e7) { errs[key] = `${label} is too large`; return 0; }
  if (Math.abs(Math.round(v * 1e4) / 1e4 - v) > 1e-9) { errs[key] = `${label} can have at most 4 decimal places`; return 0; }
  return Math.round(v * 1e4) / 1e4;
}
/** A new model needs a first day. An existing one may have none (a draft from the FileMaker import) but cannot be switched on without one. */
function header(errs: Record<string, string>, body: Body, startRequired: boolean): { name: string; validFrom: string | null; validTo: string | null; isActive: boolean } {
  const rawName = body?.['name'];
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  if (!name) errs['name'] = 'Name is required'; else if (name.length > 200) errs['name'] = 'Name can be at most 200 characters';
  const rawFrom = body?.['validFrom']; const from = rawFrom === undefined || rawFrom === '' ? null : rawFrom; const to = body?.['validTo'] ?? null;
  if (from === null) { if (startRequired) errs['validFrom'] = 'Enter the first day the prices apply'; }
  else if (!isDate(from)) errs['validFrom'] = 'Enter a valid first day';
  if (to !== null && !isDate(to)) errs['validTo'] = 'Enter a valid last day, or leave it empty';
  if (isDate(from) && isDate(to) && to < from) errs['validTo'] = 'The last day cannot be before the first day';
  if (from === null && to !== null && !errs['validTo']) errs['validTo'] = 'Give it a first day before a last day';
  const active = body?.['isActive'];
  if (typeof active !== 'boolean') errs['isActive'] = 'Active must be on or off';
  else if (active && from === null && !errs['validFrom']) errs['isActive'] = 'Give it a first day before switching it on';
  return { name, validFrom: isDate(from) ? from : null, validTo: isDate(to) ? to : null, isActive: active === true };
}

export function parseMode(body: Body): CostingMode {
  const m = body?.['mode'];
  if (m !== 'OWN' && m !== 'INHERIT') throw new ValidationError({ mode: 'Choose own prices or the parent’s prices' });
  return m;
}

export function parseNewModel(body: Body): NewModelInput {
  const errs: Record<string, string> = {};
  const h = header(errs, body, true);
  const c = body?.['copyFromId'] ?? null;
  if (c !== null && !(Number.isInteger(c) && (c as number) > 0)) errs['copyFromId'] = 'Choose a model to copy, or none';
  done(errs);
  return { ...h, validFrom: h.validFrom as string, copyFromId: c as number | null };
}

export function parseModel(body: Body): ModelInput {
  const errs: Record<string, string> = {};
  const h = header(errs, body, false);
  const rawComments = body?.['comments'] ?? null;
  let comments: string | null = null;
  if (rawComments !== null) {
    if (typeof rawComments !== 'string') errs['comments'] = 'Comments must be text';
    else if (rawComments.length > 1000) errs['comments'] = 'Comments can be at most 1000 characters';
    else comments = rawComments.trim() === '' ? null : rawComments.trim();
  }
  const list = (key: string): unknown[] => { const v = body?.[key]; if (!Array.isArray(v)) { errs[key] = 'Expected a list'; return []; } return v; };
  const seen = new Set<string>();
  const charges = list('charges').map((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>; const k = `charges.${i}`;
    if (typeof r['code'] !== 'string' || !CHARGE_CODES.includes(r['code'])) errs[`${k}.code`] = 'Unknown charge';
    else if (seen.has(r['code'])) errs[`${k}.code`] = 'Each charge can only appear once';
    else seen.add(r['code']);
    return { code: r['code'] as ChargeCode, cost: money(errs, `${k}.cost`, 'Cost', r['cost'], false), sellPrice: money(errs, `${k}.sellPrice`, 'Sell price', r['sellPrice'], false), adjustment: money(errs, `${k}.adjustment`, 'Adjustment', r['adjustment'], true) };
  });
  const stock = new Set<number>();
  const envelopes = list('envelopes').map((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>; const k = `envelopes.${i}`;
    const id = r['stockItemId'];
    if (!Number.isInteger(id) || (id as number) < 1) errs[`${k}.stockItemId`] = 'Choose an envelope';
    else if (stock.has(id as number)) errs[`${k}.stockItemId`] = 'Each envelope can only be priced once';
    else stock.add(id as number);
    return { stockItemId: id as number, cost: money(errs, `${k}.cost`, 'Cost', r['cost'], false), sellPrice: money(errs, `${k}.sellPrice`, 'Sell price', r['sellPrice'], false), adjustment: money(errs, `${k}.adjustment`, 'Adjustment', r['adjustment'], true) };
  });
  const rates = new Set<number>();
  const postage = list('postage').map((raw, i) => {
    const r = (raw ?? {}) as Record<string, unknown>; const k = `postage.${i}`;
    const id = r['postalRateId'];
    if (!Number.isInteger(id) || (id as number) < 1) errs[`${k}.postalRateId`] = 'Choose a postal rate';
    else if (rates.has(id as number)) errs[`${k}.postalRateId`] = 'Each postal rate can only appear once';
    else rates.add(id as number);
    return { postalRateId: id as number, adjustment: money(errs, `${k}.adjustment`, 'Adjustment', r['adjustment'], true) };
  });
  done(errs);
  return { ...h, comments, charges, envelopes, postage };
}
