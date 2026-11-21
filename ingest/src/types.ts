/** Parsed H-POD export v6 pack (pure data, no business rules applied). */
export interface ParsedPack {
  guid: string;
  pageCount: number;
  startPage: number;
  endPage: number;
  status: string;
  deliveryPointSuffix: string;
  releaseDate: string | null;
  attachmentCount: number;
  source: { guid: string; ownerAccount: string; ownerUser: string };
  address: { firstName: string; surname: string; postcode: string; country: string; lines: string[] };
  identifiers: { type: string; value: string }[];
  options: {
    colour: string;
    deliveryBand: string;
    deliveryMethod: string;
    envelopeValue: string;
    envelopeCode: string;
    duplex: boolean;
    paper: string;
  };
  passthrough: Record<string, string>;
  inserts: { code: string; name: string; publicationDate: string }[];
}

export type MatchExclusionReason =
  | 'ACCOUNT_RULE'
  | 'ANONYMOUS_ADDRESSEE'
  | 'NOTICE_ENCLOSED'
  | 'MATCHING_DISABLED';

export interface NormalisedAddress {
  /** Addressee + address lines (notice line and trailing postcode line removed), display form. */
  lines: string[];
  postcode: string;
  country: string;
  /** SHA-256 over recipient + all normalised lines + postcode + country. Different people => different hash. */
  hash: string;
  hadNotice: boolean;
}

export type EnclosingRoute = 'RECEPTION' | 'MACHINE_CANDIDATE' | 'HAND';
export type EnclosingMethod = 'MACHINE' | 'HAND' | 'RECEPTION';

export interface IngestPack {
  parsed: ParsedPack;
  address: NormalisedAddress;
  /** Submitting account (XML OwnerAccount). */
  accountCode: string;
  /** Customer = grouping account; this is what batches and mailpieces belong to. */
  customerCode: string;
  brand: string | null;
  brandReference: string;
  /** Position inside a merged envelope (account pack-sequence rule); 99 = unlisted. */
  documentSequence: number;
  /** SHA-256 hex of the match key; unique per pack when excluded. */
  matchKey: string;
  sheets: number;
  matchExclusion: MatchExclusionReason | null;
  /** Value of the account's customer-specified batching key (e.g. Property), or ''. */
  batchingValue: string;
}

export interface Mailpiece {
  id: number;
  addressHash: string;
  packs: IngestPack[];
  /** Customer (grouping account) code. */
  accountCode: string;
  brand: string | null;
  sheets: number;
  insertCodes: { code: string; quantity: number }[];
  /** Identity of the chosen outer envelope in the account_envelope table, when known. */
  accountEnvelopeId?: number;
  postalRateId?: number;
  postalServiceId?: number;
  /** The configured envelope/rate option chosen (carries provider, service and weight band). */
  option?: import('./reference.js').EnvelopeOption;
  weightG: number;
  thicknessMm: number;
  postalFormat: string;
  envelopeCode: string;
  envelopeSize: string;
  postalService: string;
  paper: string;
  batchingValue: string;
  route: EnclosingRoute;
  batchKey: string;
}

export interface Batch {
  key: string;
  accountCode: string;
  brand: string | null;
  envelopeCode: string;
  envelopeSize: string;
  postalService: string;
  postalFormat: string;
  paper: string;
  insertCodes: string[];
  inserts: { code: string; quantity: number }[];
  batchingValue: string;
  route: EnclosingRoute;
  enclosing: EnclosingMethod;
  postalServiceId?: number;
  mailpieceIds: number[];
  sheetTotal: number;
}

export interface IngestIssue {
  severity: 'error' | 'warning';
  packGuid?: string;
  message: string;
}

export interface IngestResult {
  xmlName: string;
  pdfName: string;
  /** Pages in the PDF; when the PDF has not arrived yet, the page count the packs expect. */
  pdfPages: number;
  /** false = saved from the XML alone, status 'Awaiting PDF'. */
  pdfReceived: boolean;
  packs: IngestPack[];
  mailpieces: Mailpiece[];
  batches: Batch[];
  duplicates: string[];
  issues: IngestIssue[];
  persisted: boolean;
}
