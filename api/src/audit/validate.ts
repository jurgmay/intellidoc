import { ValidationError } from '../errors.js';
import { MAX_AUDIT } from './types.js';

export interface AuditRequest { accountId: number; mailpieceIds: number[]; criteria: string; thumbnails: boolean }

/** The body of POST /api/reports/audit.pdf: the account searched, the mailpieces the user ticked, and the words describing the search. */
export function parseAuditRequest(raw: unknown): AuditRequest {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const errors: Record<string, string> = {};
  const accountId = typeof b['accountId'] === 'number' && Number.isInteger(b['accountId']) && b['accountId'] > 0 ? b['accountId'] : 0;
  if (!accountId) errors['accountId'] = 'Choose the account the mailpieces were searched in.';
  const ids = Array.isArray(b['mailpieceIds']) ? b['mailpieceIds'] : [];
  const mailpieceIds = [...new Set(ids.filter((x): x is number => typeof x === 'number' && Number.isInteger(x) && x > 0))];
  if (mailpieceIds.length !== ids.length) errors['mailpieceIds'] = 'The mailpieces must be numbers.';
  else if (mailpieceIds.length === 0) errors['mailpieceIds'] = 'Select at least one mailpiece.';
  else if (mailpieceIds.length > MAX_AUDIT) errors['mailpieceIds'] = `A report can cover at most ${MAX_AUDIT} mailpieces; narrow the search.`;
  const criteria = typeof b['criteria'] === 'string' ? b['criteria'].trim().slice(0, 500) : '';
  if (Object.keys(errors).length) throw new ValidationError(errors);
  return { accountId, mailpieceIds, criteria, thumbnails: b['thumbnails'] !== false };
}
