import { ValidationError } from '../errors.js';
import { JOB_STATUSES, type JobQuery, type JobStatus } from './types.js';

type Q = Record<string, string | undefined>;

export function parseJobQuery(q: Q): JobQuery {
  const errs: Record<string, string> = {};
  const search = (q['search'] ?? '').trim();
  if (search.length > 100) errs['search'] = 'Search for 100 characters or fewer';
  const status = (q['status'] ?? '').trim();
  if (status !== '' && !JOB_STATUSES.includes(status as JobStatus)) errs['status'] = 'Choose a status from the list';
  let limit = 100;
  if (q['limit'] !== undefined) {
    const n = Number(q['limit']);
    if (!Number.isInteger(n) || n < 1 || n > 500) errs['limit'] = 'The limit must be a whole number from 1 to 500'; else limit = n;
  }
  if (Object.keys(errs).length > 0) throw new ValidationError(errs);
  return { search: search === '' ? null : search, status: status === '' ? null : (status as JobStatus), limit };
}

/** Body of POST /compose: { onlyNew?: boolean }. onlyNew leaves alone a batch that already has print files. */
export function parseCompose(body: unknown): { onlyNew: boolean } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b['onlyNew'] !== undefined && typeof b['onlyNew'] !== 'boolean') throw new ValidationError({ onlyNew: 'onlyNew must be true or false' });
  return { onlyNew: b['onlyNew'] === true };
}
