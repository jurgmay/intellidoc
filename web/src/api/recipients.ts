import { api } from './client';

export interface SearchScope { id: number; label: string; isCustomer: boolean }
/** One letter in an envelope. `position` is its place in the envelope; `sequence` is its number in the customer's pack sequence (null when unlisted). */
export interface RecipientPack {
  packId: number; /** The pack's GUID and that of the job it came from. */ packGuid: string; jobGuid: string; position: number; sequence: number | null; startPage: number; pageCount: number; releaseDate: string; references: Record<string, string>;
}
/** One mailpiece (envelope) with its packs in envelope order. */
export interface RecipientRow {
  mailpieceId: number; /** Its place in the batch's print order. */ sequenceNumber: number | null; batchCode: number | null; batchStatus: string | null; job: string; releaseDate: string;
  addressLines: string[]; postcode: string; isCancelled: boolean; accountCode: string; accountName: string; accountPath: string;
  invoicingCode: string | null; invoicingName: string | null; brand: string | null; priceSell: number | null; packs: RecipientPack[];
}
export interface RecipientResult { scope: { id: number; label: string }; rows: RecipientRow[]; truncated: boolean }
export interface RecipientQuery { accountId: number; name: string; address: string; reference: string; referenceKey: string; jobGuid: string; packGuid: string; from: string; to: string }

/** The mailpieces of one batch, in print order, `limit` at a time starting after `offset`. */
export const listBatchMailpieces = (accountId: number, batchId: number, offset: number, limit: number): Promise<RecipientResult> =>
  api(`/api/recipients/search?${new URLSearchParams({ accountId: String(accountId), batchId: String(batchId), offset: String(offset), limit: String(limit) }).toString()}`);

export const listScopes = (): Promise<{ rows: SearchScope[] }> => api('/api/recipients/scopes');

export function searchRecipients(q: RecipientQuery): Promise<RecipientResult> {
  const p = new URLSearchParams({ accountId: String(q.accountId) });
  for (const k of ['name', 'address', 'reference', 'referenceKey', 'jobGuid', 'packGuid', 'from', 'to'] as const) if (q[k].trim()) p.set(k, q[k].trim());
  return api(`/api/recipients/search?${p.toString()}`);
}

export interface PriceLineView { code: string; label: string; quantity: number; unitCost: number; unitSell: number; cost: number; sell: number }
export interface MailpiecePrice {
  mailpieceId: number; batchCode: number | null; priced: boolean; reason: string | null; pricedAt: string | null; model: { id: number; name: string } | null;
  packs: number; colourPages: number; monoPages: number; blankPages: number; lines: PriceLineView[];
  productionCost: number; productionSell: number; postageCost: number; postageSell: number; totalCost: number; totalSell: number; warnings: string | null;
}
export const getMailpiecePrice = (id: number): Promise<MailpiecePrice> => api(`/api/mailpieces/${id}/price`);
