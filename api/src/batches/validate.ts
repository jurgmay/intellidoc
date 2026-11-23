import { ValidationError } from '../errors.js';
import { BATCH_STATUSES, DEFAULT_BATCH_LIMIT, MAX_BATCH_LIMIT, type BatchQuery } from './types.js';

type Raw = Record<string, unknown>;
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: string): boolean => {
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
};

/** Turns the query string into a batch search. An account is required; nothing else is, because the newest batches of an account are a useful answer on their own. */
export function parseBatchQuery(raw: Raw): BatchQuery {
  const errors: Record<string, string> = {};
  const acct = text(raw['accountId']);
  const accountId = acct && /^\d+$/.test(acct) ? Number(acct) : 0;
  if (accountId < 1) errors['accountId'] = 'Choose the account to search in. Searches always cover one account and the accounts below it.';

  const c = text(raw['code']);
  if (c !== null && !/^\d{1,15}$/.test(c)) errors['code'] = 'The batch code is a number.';
  const code = c && /^\d{1,15}$/.test(c) ? Number(c) : null;

  const status = text(raw['status']);
  if (status !== null && !(BATCH_STATUSES as readonly string[]).includes(status)) errors['status'] = `The status must be one of ${BATCH_STATUSES.join(', ')}.`;

  const job = text(raw['job']);
  if (job !== null && job.length < 2) errors['job'] = 'The job needs at least 2 characters.';

  const from = text(raw['from']);
  const to = text(raw['to']);
  if (from && !validDate(from)) errors['from'] = 'Use a date like 2026-11-21.';
  if (to && !validDate(to)) errors['to'] = 'Use a date like 2026-11-21.';
  if (from && to && !errors['from'] && !errors['to'] && from > to) errors['to'] = 'The end date is before the start date.';

  const lim = text(raw['limit']);
  let limit = DEFAULT_BATCH_LIMIT;
  if (lim) {
    if (!/^\d+$/.test(lim) || Number(lim) < 1 || Number(lim) > MAX_BATCH_LIMIT) errors['limit'] = `Limit must be between 1 and ${MAX_BATCH_LIMIT}.`;
    else limit = Number(lim);
  }
  if (Object.keys(errors).length) throw new ValidationError(errors);
  return { accountId, code, status, job, from, to, limit };
}
