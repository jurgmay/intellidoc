import { ValidationError } from '../errors.js';
import { DEFAULT_LIMIT, MAX_LIMIT, MIN_TERM, type RecipientQuery } from './types.js';

type Raw = Record<string, unknown>;
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: string): boolean => DATE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

/** Turns the query string into a search. A search without an account is refused, as is one with nothing to look for. */
export function parseRecipientQuery(raw: Raw): RecipientQuery {
  const errors: Record<string, string> = {};
  const acct = text(raw['accountId']);
  const accountId = acct && /^\d+$/.test(acct) ? Number(acct) : 0;
  if (accountId < 1) errors['accountId'] = 'Choose the account to search in. Searches always cover one account and the accounts below it.';

  const term = (key: string, label: string): string | null => {
    const v = text(raw[key]);
    if (v !== null && v.replace(/\*/g, '').length < MIN_TERM) errors[key] = `${label} needs at least ${MIN_TERM} characters.`;
    return v;
  };
  const name = term('name', 'Name');
  const address = term('address', 'Address');
  const reference = term('reference', 'Reference');
  const referenceKey = text(raw['referenceKey']);
  if (referenceKey && !reference) errors['reference'] = 'Enter the reference to look for.';

  const from = text(raw['from']);
  const to = text(raw['to']);
  if (from && !validDate(from)) errors['from'] = 'Use a date like 2026-11-21.';
  if (to && !validDate(to)) errors['to'] = 'Use a date like 2026-11-21.';
  if (from && to && !errors['from'] && !errors['to'] && from > to) errors['to'] = 'The end date is before the start date.';

  const bat = text(raw['batchId']);
  if (bat !== null && !/^\d+$/.test(bat)) errors['batchId'] = 'The batch is not a number.';
  const batchId = bat && /^\d+$/.test(bat) ? Number(bat) : null;

  if (!name && !address && !reference && !from && !to && batchId === null && !errors['accountId']) errors['name'] = 'Enter a name, address, reference or date range to search for.';

  const lim = text(raw['limit']);
  let limit = DEFAULT_LIMIT;
  if (lim) {
    if (!/^\d+$/.test(lim) || Number(lim) < 1 || Number(lim) > MAX_LIMIT) errors['limit'] = `Limit must be between 1 and ${MAX_LIMIT}.`;
    else limit = Number(lim);
  }
  const off = text(raw['offset']);
  let offset = 0;
  if (off) { if (!/^\d+$/.test(off)) errors['offset'] = 'Offset must be a number from 0.'; else offset = Number(off); }
  if (Object.keys(errors).length) throw new ValidationError(errors);
  return { accountId, name, address, reference, referenceKey, from, to, batchId, limit, offset };
}

/** The pattern a LIKE needs for "contains" (`%x%`), exact (`x`) or prefix (`x%`), with the wildcard characters in the text made literal. */
export const escapeLike = (s: string): string => s.replace(/[\\%_[]/g, (c) => `\\${c}`);
export const containsPattern = (s: string): string => `%${escapeLike(s)}%`;
export function referencePattern(s: string): string {
  const prefix = s.endsWith('*');
  return escapeLike(prefix ? s.slice(0, -1) : s) + (prefix ? '%' : '');
}
