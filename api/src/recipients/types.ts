/** What a search can ask for. The scope is mandatory: a search never covers more than one account and the accounts below it. */
export interface RecipientQuery {
  /** The account to search in. The search covers this account and every account below it. */
  accountId: number;
  /** Part of the addressee (first address line). */
  name: string | null;
  /** Part of any other address line, or of the postcode. */
  address: string | null;
  /** A passthrough value, matched exactly, or by prefix when the text ends with `*`. */
  reference: string | null;
  /** Limits `reference` to one passthrough key, e.g. "Tenant Reference". */
  referenceKey: string | null;
  /** Release date range, inclusive, as YYYY-MM-DD. */
  from: string | null;
  to: string | null;
  limit: number;
}

export interface RecipientRow {
  packId: number;
  mailpieceId: number | null;
  batchCode: number | null;
  batchStatus: string | null;
  job: string;
  releaseDate: string;
  addressLines: string[];
  postcode: string;
  /** The sub-account, as at production when the pack was mailed. */
  accountCode: string;
  accountName: string;
  accountPath: string;
  invoicingCode: string | null;
  invoicingName: string | null;
  brand: string | null;
  references: Record<string, string>;
  /** What the customer pays for the mailpiece (production and postage), or null when it has not been priced. */
  priceSell: number | null;
}

export interface PriceLineView { code: string; label: string; quantity: number; unitCost: number; unitSell: number; cost: number; sell: number }
/** How one mailpiece was priced at production. */
export interface MailpiecePrice {
  mailpieceId: number; batchCode: number | null; priced: boolean;
  /** Why there is no price, when there is none. */
  reason: string | null;
  pricedAt: string | null;
  model: { id: number; name: string } | null;
  packs: number; colourPages: number; monoPages: number; blankPages: number;
  lines: PriceLineView[];
  productionCost: number; productionSell: number; postageCost: number; postageSell: number; totalCost: number; totalSell: number;
  /** What part of the price is missing (no envelope price, no postage rate), if anything. */
  warnings: string | null;
}

export interface RecipientResult { scope: { id: number; label: string }; rows: RecipientRow[]; truncated: boolean }
export interface SearchScope { id: number; label: string; isCustomer: boolean }

export interface RecipientStore {
  /** Accounts a search can be scoped to (not deleted), with their path from the top of the tree. */
  scopes(): Promise<SearchScope[]>;
  search(q: RecipientQuery): Promise<RecipientResult>;
  /** The price of one mailpiece with its lines. Throws NotFoundError when there is no such mailpiece. */
  price(mailpieceId: number): Promise<MailpiecePrice>;
}

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 500;
export const MIN_TERM = 2;
