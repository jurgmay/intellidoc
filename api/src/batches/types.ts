export const BATCH_STATUSES = ['Created', 'Printed', 'Enclosed', 'Despatched', 'Cancelled'] as const;
export const DEFAULT_BATCH_LIMIT = 100;
export const MAX_BATCH_LIMIT = 500;

/** What a batch search can ask for. The scope is mandatory, as in the mailpiece search: it covers one account and the accounts below it. */
export interface BatchQuery {
  accountId: number;
  /** The batch code, exactly. */
  code: number | null;
  status: string | null;
  /** Part of the job name. */
  job: string | null;
  /** The day the batch was made (UK time), inclusive, as YYYY-MM-DD. */
  from: string | null;
  to: string | null;
  limit: number;
}

/** One batch: what is common to every mailpiece in it. */
export interface BatchRow {
  batchId: number;
  batchCode: number;
  status: string;
  job: string;
  /** When the batch was made, in UK time (ISO, no zone). */
  createdAt: string;
  /** Reception, Machine enclosing or Hand enclosing. */
  department: string;
  /** For example "Royal Mail 2nd Class (Letter)". */
  service: string;
  envelope: string;
  brand: string | null;
  invoicingCode: string;
  invoicingName: string;
  /** Mailpieces in the batch that the search scope covers, not counting cancelled ones. */
  mailpieces: number;
  /** All the mailpieces in the batch (not cancelled); more than `mailpieces` when part of the batch belongs to other sub-accounts. */
  mailpiecesInBatch: number;
  cancelled: number;
  packs: number;
  pages: number;
  sheets: number;
  /** What the customer pays for the priced mailpieces in scope; `unpriced` of them have no price yet. */
  priceSell: number;
  unpriced: number;
}

export interface BatchResult { scope: { id: number; label: string }; rows: BatchRow[]; truncated: boolean }

export interface BatchStore {
  search(q: BatchQuery): Promise<BatchResult>;
}
