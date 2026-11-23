import { api } from './client';

export const BATCH_STATUSES = ['Created', 'Printed', 'Enclosed', 'Despatched', 'Cancelled'] as const;
export interface BatchRow {
  batchId: number; batchCode: number; status: string; job: string; createdAt: string; department: string; service: string; envelope: string; brand: string | null;
  invoicingCode: string; invoicingName: string; mailpieces: number; mailpiecesInBatch: number; cancelled: number; packs: number; pages: number; sheets: number; priceSell: number; unpriced: number;
}
export interface BatchResult { scope: { id: number; label: string }; rows: BatchRow[]; truncated: boolean }
export interface BatchQuery { accountId: number; code: string; status: string; job: string; from: string; to: string }

export function searchBatches(q: BatchQuery): Promise<BatchResult> {
  const p = new URLSearchParams({ accountId: String(q.accountId) });
  for (const k of ['code', 'status', 'job', 'from', 'to'] as const) if (q[k].trim()) p.set(k, q[k].trim());
  return api(`/api/batches/search?${p.toString()}`);
}
