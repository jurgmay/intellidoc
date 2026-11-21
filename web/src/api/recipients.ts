import { api } from './client';

export interface SearchScope { id: number; label: string; isCustomer: boolean }
export interface RecipientRow {
  packId: number; mailpieceId: number | null; batchCode: number | null; batchStatus: string | null; job: string; releaseDate: string;
  addressLines: string[]; postcode: string; accountCode: string; accountName: string; accountPath: string;
  invoicingCode: string | null; invoicingName: string | null; brand: string | null; references: Record<string, string>;
}
export interface RecipientResult { scope: { id: number; label: string }; rows: RecipientRow[]; truncated: boolean }
export interface RecipientQuery { accountId: number; name: string; address: string; reference: string; referenceKey: string; from: string; to: string }

export const listScopes = (): Promise<{ rows: SearchScope[] }> => api('/api/recipients/scopes');

export function searchRecipients(q: RecipientQuery): Promise<RecipientResult> {
  const p = new URLSearchParams({ accountId: String(q.accountId) });
  for (const k of ['name', 'address', 'reference', 'referenceKey', 'from', 'to'] as const) if (q[k].trim()) p.set(k, q[k].trim());
  return api(`/api/recipients/search?${p.toString()}`);
}
