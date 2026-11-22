import { api } from './client';

export interface InvoicingAccount { id: number; code: string; name: string }
/** Sell values are in pounds (what would be invoiced). `unpriced` mailpieces add nothing to them. */
export interface Counts { mailpieces: number; packs: number; sheets: number; productionSell: number; postageSell: number; totalSell: number; unpriced: number }
export interface UsageReport {
  account: InvoicingAccount; from: string; to: string;
  days: ({ day: string; byBrand: Record<string, number> } & Counts)[];
  brands: ({ brand: string } & Counts)[];
  postage: ({ format: string; service: string } & Counts)[];
  totals: Counts;
}
export interface UsageQuery { invoicingAccountId: number; from: string; to: string }

const qs = (q: UsageQuery): string => new URLSearchParams({ invoicingAccountId: String(q.invoicingAccountId), from: q.from, to: q.to }).toString();
export const listInvoicingAccounts = (): Promise<{ rows: InvoicingAccount[] }> => api('/api/reports/invoicing-accounts');
export const getUsage = (q: UsageQuery): Promise<UsageReport> => api(`/api/reports/usage?${qs(q)}`);
export const usagePdfUrl = (q: UsageQuery): string => `/api/reports/usage.pdf?${qs(q)}`;

/** Pounds. `margin` is sell minus cost; `marginPct` is margin as a percentage of sell (null when nothing is sold). Unpriced mail adds nothing. */
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
export const getMargin = (q: UsageQuery): Promise<MarginReport> => api(`/api/reports/margin?${qs(q)}`);
