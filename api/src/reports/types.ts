/** One line of the usage view: an invoicing account's mailpieces on one day, for one brand, postal format and service. */
export interface UsageLine { day: string; brand: string; format: string; service: string; mailpieces: number; packs: number; sheets: number;
  /** Mailpieces that have a price, and the sell value of production and postage (what would be invoiced). */ priced: number; productionSell: number; postageSell: number }
export interface InvoicingAccount { id: number; code: string; name: string }
export interface UsageQuery { invoicingAccountId: number; from: string; to: string }

/** One line of the margin view: the usage line with what it cost as well as what it would be invoiced at. Internal only. */
export interface MarginLine { day: string; brand: string; format: string; service: string; mailpieces: number; priced: number; productionSell: number; postageSell: number; productionCost: number; postageCost: number }
/** Pounds. `margin` is sell minus cost and `marginPct` is margin as a percentage of sell (null when nothing is sold). Unpriced mailpieces add nothing. */
export interface MarginCounts {
  mailpieces: number; unpriced: number; productionSell: number; productionCost: number; postageSell: number; postageCost: number;
  sell: number; cost: number; margin: number; marginPct: number | null;
}
export interface MarginReport {
  account: InvoicingAccount; from: string; to: string;
  days: ({ day: string } & MarginCounts)[];
  brands: ({ brand: string } & MarginCounts)[];
  postage: ({ format: string; service: string } & MarginCounts)[];
  totals: MarginCounts;
}

export interface ReportStore {
  /** The invoicing accounts that have produced anything (a report is always for one of them). */
  invoicingAccounts(): Promise<InvoicingAccount[]>;
  /** The raw usage lines for one invoicing account between two days, both included. Null if the account does not exist. */
  usageLines(q: UsageQuery): Promise<{ account: InvoicingAccount; lines: UsageLine[] } | null>;
  /** The same lines with the costs, for the internal margin report. Null if the account does not exist. */
  marginLines(q: UsageQuery): Promise<{ account: InvoicingAccount; lines: MarginLine[] } | null>;
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
