import { ValidationError } from '../errors.js';
import { eachDay } from './aggregate.js';
import { MAX_DAYS, type UsageQuery } from './types.js';

const validDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s) && !Number.isNaN(Date.parse(s));

/** A usage report is for one invoicing account and a range of days. Both ends are required: nothing is assumed. */
export function parseUsageQuery(raw: Record<string, unknown>): UsageQuery {
  const errors: Record<string, string> = {};
  const id = typeof raw['invoicingAccountId'] === 'string' ? raw['invoicingAccountId'].trim() : '';
  if (!/^\d+$/.test(id) || Number(id) < 1) errors['invoicingAccountId'] = 'Choose the invoicing account to report on.';
  const from = typeof raw['from'] === 'string' ? raw['from'].trim() : '';
  const to = typeof raw['to'] === 'string' ? raw['to'].trim() : '';
  if (!validDate(from)) errors['from'] = 'Enter the first day, like 2026-11-01.';
  if (!validDate(to)) errors['to'] = 'Enter the last day, like 2026-11-30.';
  if (!errors['from'] && !errors['to']) {
    if (from > to) errors['to'] = 'The last day is before the first day.';
    else if (eachDay(from, to).length > MAX_DAYS) errors['to'] = `A report can cover at most ${MAX_DAYS} days.`;
  }
  if (Object.keys(errors).length) throw new ValidationError(errors);
  return { invoicingAccountId: Number(id), from, to };
}
