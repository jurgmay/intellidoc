import { api } from './client';

export interface SearchScope { id: number; label: string; isCustomer: boolean }
/** One letter in an envelope. `position` is its place in the envelope; `sequence` is its number in the customer's pack sequence (null when unlisted). */
export interface RecipientPack {
  packId: number; position: number; sequence: number | null; startPage: number; pageCount: number; releaseDate: string; references: Record<string, string>;
}
/** One mailpiece (envelope) with its packs in envelope order. */
export interface RecipientRow {
  mailpieceId: number; batchCode: number | null; batchStatus: string | null; job: string; releaseDate: string;
  addressLines: string[]; postcode: string; isCancelled: boolean; accountCode: string; accountName: string; accountPath: string;
  invoicingCode: string | null; invoicingName: string | null; brand: string | null; priceSell: number | null; packs: RecipientPack[];
}
export interface RecipientResult { scope: { id: number; label: string }; rows: RecipientRow[]; truncated: boolean }
export interface RecipientQuery { accountId: number; name: string; address: string; reference: string; referenceKey: string; from: string; to: string }

export const listScopes = (): Promise<{ rows: SearchScope[] }> => api('/api/recipients/scopes');

export function searchRecipients(q: RecipientQuery): Promise<RecipientResult> {
  const p = new URLSearchParams({ accountId: String(q.accountId) });
  for (const k of ['name', 'address', 'reference', 'referenceKey', 'from', 'to'] as const) if (q[k].trim()) p.set(k, q[k].trim());
  return api(`/api/recipients/search?${p.toString()}`);
}

export interface PriceLineView { code: string; label: string; quantity: number; unitCost: number; unitSell: number; cost: number; sell: number }
export interface MailpiecePrice {
  mailpieceId: number; batchCode: number | null; priced: boolean; reason: string | null; pricedAt: string | null; model: { id: number; name: string } | null;
  packs: number; colourPages: number; monoPages: number; blankPages: number; lines: PriceLineView[];
  productionCost: number; productionSell: number; postageCost: number; postageSell: number; totalCost: number; totalSell: number; warnings: string | null;
}
export const getMailpiecePrice = (id: number): Promise<MailpiecePrice> => api(`/api/mailpieces/${id}/price`);
