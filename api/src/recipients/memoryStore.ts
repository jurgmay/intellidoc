import { NotFoundError } from '../errors.js';
import type { MailpiecePrice, RecipientQuery, RecipientResult, RecipientRow, RecipientStore, SearchScope } from './types.js';

export interface MemoryRecipient extends RecipientRow {
  /** The submitting account and every account above it. A search in any of these accounts finds the row. */
  ancestors: number[];
}

/** In-memory search for the stub server and the tests. It follows the same rules as the SQL: contains for names and addresses, exact or prefix for references. */
export class MemoryRecipientStore implements RecipientStore {
  scopeList: SearchScope[] = [];
  recipients: MemoryRecipient[] = [];
  prices = new Map<number, MailpiecePrice>();

  async scopes(): Promise<SearchScope[]> { return this.scopeList; }

  async search(q: RecipientQuery): Promise<RecipientResult> {
    const scope = this.scopeList.find((s) => s.id === q.accountId);
    if (!scope) throw new NotFoundError('That account does not exist.');
    const has = (hay: string, needle: string): boolean => hay.toLowerCase().includes(needle.toLowerCase());
    const refOk = (value: string, pattern: string): boolean => {
      const v = value.toLowerCase();
      const p = pattern.toLowerCase();
      return p.endsWith('*') ? v.startsWith(p.slice(0, -1)) : v === p;
    };
    const hits = this.recipients
      .filter((r) => r.ancestors.includes(q.accountId))
      .filter((r) => !q.name || has(r.addressLines[0] ?? '', q.name))
      .filter((r) => !q.address || r.addressLines.slice(1).some((l) => has(l, q.address!)) || has(r.postcode, q.address))
      .filter((r) => !q.reference || Object.entries(r.references).some(([k, v]) => (!q.referenceKey || k.toLowerCase() === q.referenceKey.toLowerCase()) && refOk(v, q.reference!)))
      .filter((r) => !q.from || r.releaseDate.slice(0, 10) >= q.from)
      .filter((r) => !q.to || r.releaseDate.slice(0, 10) <= q.to)
      .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate) || b.packId - a.packId);
    const rows = hits.slice(0, q.limit).map(({ ancestors: _a, ...row }) => row);
    return { scope: { id: scope.id, label: scope.label }, rows, truncated: hits.length > q.limit };
  }

  async price(mailpieceId: number): Promise<MailpiecePrice> {
    const p = this.prices.get(mailpieceId);
    if (!p) throw new NotFoundError('Mailpiece not found');
    return p;
  }
}
