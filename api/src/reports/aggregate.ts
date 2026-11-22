import type { Counts, InvoicingAccount, MarginCounts, MarginLine, MarginReport, UsageLine, UsageReport } from './types.js';

const zero = (): Counts => ({ mailpieces: 0, packs: 0, sheets: 0, productionSell: 0, postageSell: 0, totalSell: 0, unpriced: 0 });
const r4 = (v: number): number => Math.round(v * 10_000) / 10_000;      // no floating point dust in sums of money
const add = (a: Counts, l: UsageLine): void => {
  a.mailpieces += l.mailpieces; a.packs += l.packs; a.sheets += l.sheets; a.unpriced += l.mailpieces - l.priced;
  a.productionSell = r4(a.productionSell + l.productionSell); a.postageSell = r4(a.postageSell + l.postageSell); a.totalSell = r4(a.productionSell + a.postageSell);
};

/** Every date from `from` to `to`, both included, as YYYY-MM-DD. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Turns the raw lines into what the screen and the PDF show: totals per day (with the brand split), per brand and per format and service. */
export function buildUsageReport(account: InvoicingAccount, from: string, to: string, lines: UsageLine[]): UsageReport {
  const days = new Map(eachDay(from, to).map((d) => [d, { day: d, ...zero(), byBrand: {} as Record<string, number> }]));
  const brands = new Map<string, { brand: string } & Counts>();
  const postage = new Map<string, { format: string; service: string } & Counts>();
  const totals = zero();
  for (const l of lines) {
    const d = days.get(l.day);
    if (!d) continue; // outside the range
    add(d, l); d.byBrand[l.brand] = (d.byBrand[l.brand] ?? 0) + l.mailpieces;
    add(brands.get(l.brand) ?? brands.set(l.brand, { brand: l.brand, ...zero() }).get(l.brand)!, l);
    const pk = `${l.format}\u0000${l.service}`;
    add(postage.get(pk) ?? postage.set(pk, { format: l.format, service: l.service, ...zero() }).get(pk)!, l);
    add(totals, l);
  }
  return {
    account, from, to, days: [...days.values()], totals,
    brands: [...brands.values()].sort((a, b) => b.mailpieces - a.mailpieces || a.brand.localeCompare(b.brand)),
    postage: [...postage.values()].sort((a, b) => a.format.localeCompare(b.format) || a.service.localeCompare(b.service)),
  };
}

const zeroMargin = (): MarginCounts => ({ mailpieces: 0, unpriced: 0, productionSell: 0, productionCost: 0, postageSell: 0, postageCost: 0, sell: 0, cost: 0, margin: 0, marginPct: null });
const addMargin = (a: MarginCounts, l: MarginLine): void => {
  a.mailpieces += l.mailpieces; a.unpriced += l.mailpieces - l.priced;
  a.productionSell = r4(a.productionSell + l.productionSell); a.productionCost = r4(a.productionCost + l.productionCost);
  a.postageSell = r4(a.postageSell + l.postageSell); a.postageCost = r4(a.postageCost + l.postageCost);
  a.sell = r4(a.productionSell + a.postageSell); a.cost = r4(a.productionCost + a.postageCost); a.margin = r4(a.sell - a.cost);
  a.marginPct = a.sell > 0 ? Math.round((a.margin / a.sell) * 1000) / 10 : null;
};

/** The internal margin report: per day, brand, and postal format and service, what would be invoiced, what it cost and the difference. */
export function buildMarginReport(account: InvoicingAccount, from: string, to: string, lines: MarginLine[]): MarginReport {
  const days = new Map(eachDay(from, to).map((d) => [d, { day: d, ...zeroMargin() }]));
  const brands = new Map<string, { brand: string } & MarginCounts>();
  const postage = new Map<string, { format: string; service: string } & MarginCounts>();
  const totals = zeroMargin();
  for (const l of lines) {
    const d = days.get(l.day);
    if (!d) continue;
    addMargin(d, l);
    addMargin(brands.get(l.brand) ?? brands.set(l.brand, { brand: l.brand, ...zeroMargin() }).get(l.brand)!, l);
    const pk = `${l.format}\u0000${l.service}`;
    addMargin(postage.get(pk) ?? postage.set(pk, { format: l.format, service: l.service, ...zeroMargin() }).get(pk)!, l);
    addMargin(totals, l);
  }
  return {
    account, from, to, days: [...days.values()], totals,
    brands: [...brands.values()].sort((a, b) => b.sell - a.sell || a.brand.localeCompare(b.brand)),
    postage: [...postage.values()].sort((a, b) => a.format.localeCompare(b.format) || a.service.localeCompare(b.service)),
  };
}
