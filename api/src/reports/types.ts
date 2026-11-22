/** One line of the usage view: an invoicing account's mailpieces on one day, for one brand, postal format and service. */
export interface UsageLine { day: string; brand: string; format: string; service: string; mailpieces: number; packs: number; sheets: number;
  /** Mailpieces that have a price, and the sell value of production and postage (what would be invoiced). */ priced: number; productionSell: number; postageSell: number }
export interface InvoicingAccount { id: number; code: string; name: string }
export interface UsageQuery { invoicingAccountId: number; from: string; to: string }

export interface ReportStore {
  /** The invoicing accounts that have produced anything (a report is always for one of them). */
  invoicingAccounts(): Promise<InvoicingAccount[]>;
  /** The raw usage lines for one invoicing account between two days, both included. Null if the account does not exist. */
  usageLines(q: UsageQuery): Promise<{ account: InvoicingAccount; lines: UsageLine[] } | null>;
}

/** Sell values are in pounds. `unpriced` mailpieces add nothing to them. */
export interface Counts { mailpieces: number; packs: number; sheets: number; productionSell: number; postageSell: number; totalSell: number; unpriced: number }
export interface UsageReport {
  account: InvoicingAccount; from: string; to: string;
  /** Every day in the range, in order, including days with nothing. */
  days: ({ day: string } & Counts & { byBrand: Record<string, number> })[];
  brands: ({ brand: string } & Counts)[];
  postage: ({ format: string; service: string } & Counts)[];
  totals: Counts;
}
export const MAX_DAYS = 366;
