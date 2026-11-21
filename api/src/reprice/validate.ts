import { ValidationError } from '../errors.js';
import type { RepriceInput } from './types.js';

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

export function parseReprice(body: Record<string, unknown> | null | undefined): RepriceInput {
  const errs: Record<string, string> = {};
  const from = body?.['from'] ?? null; const to = body?.['to'] ?? null; const ow = body?.['overwrite'] ?? false;
  if (from !== null && !isDate(from)) errs['from'] = 'Enter a valid first day, or leave it empty';
  if (to !== null && !isDate(to)) errs['to'] = 'Enter a valid last day, or leave it empty';
  if (isDate(from) && isDate(to) && to < from) errs['to'] = 'The last day cannot be before the first day';
  if (typeof ow !== 'boolean') errs['overwrite'] = 'Must be on or off';
  if (Object.keys(errs).length) throw new ValidationError(errs);
  return { from: from as string | null, to: to as string | null, overwrite: ow as boolean };
}

export function describeReprice(i: RepriceInput, r: { priced: number; noModel: number; unknownColours: number }): string {
  const range = i.from || i.to ? ` for ${i.from ?? 'the start'} to ${i.to ?? 'today'}` : '';
  const left = [r.noModel ? `${r.noModel} had no costing model` : '', r.unknownColours ? `${r.unknownColours} had unknown page colours` : ''].filter(Boolean).join(', ');
  return `Priced mail again${range}${i.overwrite ? ' (including mail already priced)' : ''}: ${r.priced} priced${left ? `; ${left}` : ''}`;
}
