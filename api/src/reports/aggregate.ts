import type { Counts, InvoicingAccount, UsageLine, UsageReport } from './types.js';

const zero = (): Counts => ({ mailpieces: 0, packs: 0, sheets: 0 });
const add = (a: Counts, l: UsageLine): void => { a.mailpieces += l.mailpieces; a.packs += l.packs; a.sheets += l.sheets; };

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
