export const MAX_AUDIT = 300;

/** What happened to the batch, from `idoc.batch_event`. Times are UTC ISO strings with a Z. */
export interface AuditEvent { type: string; at: string; by: string | null; note: string | null }
export interface AuditPack {
  packId: number; packGuid: string; jobGuid: string; position: number; sequence: number | null; startPage: number; pageCount: number;
  releaseDate: string; receivedAt: string; references: Record<string, string>;
  /** Who submitted it (the export's Source: owner account and user). */
  ownerAccount: string; ownerUser: string;
}

/** Everything the audit report says about one mailpiece. All the times are UTC (ISO with a Z); the report shows them in UK time. */
export interface AuditMailpiece {
  mailpieceId: number; addressLines: string[]; postcode: string; isCancelled: boolean;
  /** When the mailpiece was made (grouped and priced) by ingest. */
  producedAt: string;
  job: { jobId: number; name: string; xmlFile: string; pdfFile: string; receivedAt: string; pdfReceivedAt: string | null };
  batch: { batchCode: number; status: string; createdAt: string; department: string; sequenceNumber: number | null; events: AuditEvent[]; files: { segment: number; fileName: string; createdAt: string }[] } | null;
  service: { provider: string; name: string; format: string; tracked: boolean } | null;
  envelope: string | null; weightG: number | null; pageCount: number; sheetCount: number;
  submittedBy: { path: string; code: string };
  brand: string | null;
  packs: AuditPack[];
}

export interface AuditStore {
  /** Notes in the audit log that someone made a proof-of-postage report: it holds personal data, so who made it, for whom and when is kept. */
  logReport(by: string, accountId: number, summary: string): Promise<void>;
  /** The mailpieces with these ids that are in the account or below it, in the order of `ids`. An id that is not found (or is outside the account) is left out. */
  details(accountId: number, ids: number[]): Promise<{ scopeLabel: string; rows: AuditMailpiece[] }>;
}

/** The first page of a mailpiece, rendered from the customer's PDF as a JPEG; null when the PDF is no longer kept. */
export interface PageRenderer { firstPage(pdfFileName: string, pageNumber: number): Promise<Uint8Array | null> }
