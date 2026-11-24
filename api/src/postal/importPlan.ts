import { bandLabel, overlaps } from './rules.js';
import type { Cell, RatesFile } from './importFile.js';
import type { PostalOverview } from './types.js';

export type BandAction = 'new' | 'change' | 'update' | 'unchanged' | 'blocked';
export interface ImportIssue { row: number | null; message: string }
export interface ImportBand {
  key: string; serviceKey: string; provider: string; service: string; format: string; minWeightG: number; maxWeightG: number; cost: number | null; sellPrice: number | null;
  action: BandAction; row: number;
  /** The row now in force for this band (for change, update and unchanged), or why the band is blocked. */
  before: { rateId: number; cost: number | null; sellPrice: number | null; validFrom: string; validTo: string | null } | null;
  message: string | null;
}
export interface ImportService {
  key: string; provider: string; name: string; format: string; formatId: number; serviceCode: string | null; isSignedFor: boolean; isTracked: boolean;
  isNew: boolean; providerId: number | null; serviceId: number | null;
}
export interface ImportCounts { newProviders: number; newServices: number; newBands: number; changedBands: number; updatedBands: number; unchangedBands: number; blockedBands: number; skippedRows: number }
export interface ImportPlan {
  startDate: string; endDate: string | null; fileRows: number; newProviders: string[]; services: ImportService[]; bands: ImportBand[];
  errors: ImportIssue[]; warnings: ImportIssue[]; counts: ImportCounts; canImport: boolean;
}
export interface ImportOptions { startDate: string; endDate: string | null; today: string }

const FIELDS = {
  provider: ['postalprovider', 'provider'], service: ['postalservice', 'service', 'servicename'], format: ['postalformat', 'format'],
  min: ['minweight', 'minweightg'], max: ['maxweight', 'maxweightg'], cost: ['postagecost', 'cost'], sell: ['postagesellprice', 'sellprice', 'sell'],
  signed: ['issignedfor', 'signedfor'], tracked: ['istracked', 'tracked'], code: ['postalservicecode', 'servicecode', 'code'], current: ['iscurrentprice'],
} as const;
const REQUIRED: (keyof typeof FIELDS)[] = ['provider', 'service', 'format', 'min', 'max', 'cost', 'sell'];
const LABEL: Record<string, string> = { provider: 'postalProvider', service: 'postalService', format: 'postalFormat', min: 'minWeight', max: 'maxWeight', cost: 'postageCost', sell: 'postageSellPrice' };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: string): boolean => DATE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const lc = (s: string): string => s.trim().toLowerCase();
const same = (a: number | null, b: number | null): boolean => a === b || (a !== null && b !== null && Math.abs(a - b) < 1e-9);
const text = (c: Cell | undefined): string => (c === null || c === undefined ? '' : String(c).trim());

function whole(c: Cell | undefined): number | null {
  if (typeof c === 'number') return Number.isInteger(c) ? c : null;
  const t = text(c);
  return /^\d+$/.test(t) ? Number(t) : null;
}
/** Blank is "not set". Otherwise a number; a £ sign and thousands commas are ignored. */
function money(c: Cell | undefined): number | null | 'bad' {
  if (c === null || c === undefined || text(c) === '') return null;
  const n = typeof c === 'number' ? c : Number(text(c).replace(/[£,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 && n < 1e5 ? n : 'bad';
}
function flag(c: Cell | undefined): boolean {
  if (typeof c === 'boolean') return c;
  if (typeof c === 'number') return c !== 0;
  return /^(1|true|yes|y)$/i.test(text(c));
}

/**
 * Works out, without changing anything, what importing the file would do. The prices start on `startDate` and last until `endDate` (open when null).
 * A band is a service's weight range. Where a band is already priced on the start day, the old row ends the day before and a new one starts, as "Change
 * prices from a date" does; where it is not priced, a new row is added; services and providers the file names that do not exist yet are added too.
 */
export function planImport(file: RatesFile, o: PostalOverview, opt: ImportOptions): ImportPlan {
  const errors: ImportIssue[] = [], warnings: ImportIssue[] = [];
  const empty = (): ImportPlan => ({ startDate: opt.startDate, endDate: opt.endDate, fileRows: file.rows.length, newProviders: [], services: [], bands: [], errors, warnings,
    counts: { newProviders: 0, newServices: 0, newBands: 0, changedBands: 0, updatedBands: 0, unchangedBands: 0, blockedBands: 0, skippedRows: 0 }, canImport: false });

  if (!validDate(opt.startDate)) errors.push({ row: null, message: 'The start date is required.' });
  if (opt.endDate !== null && !validDate(opt.endDate)) errors.push({ row: null, message: 'The end date is not a valid date.' });
  else if (opt.endDate !== null && validDate(opt.startDate) && opt.endDate < opt.startDate) errors.push({ row: null, message: 'The end date cannot be before the start date.' });

  const col = {} as Record<keyof typeof FIELDS, string | undefined>;
  for (const k of Object.keys(FIELDS) as (keyof typeof FIELDS)[]) col[k] = FIELDS[k].find((h) => file.headings.includes(h));
  const missing = REQUIRED.filter((k) => !col[k]);
  if (missing.length) errors.push({ row: 1, message: `The file has no ${missing.map((k) => `"${LABEL[k]}"`).join(', ')} column${missing.length > 1 ? 's' : ''}. The first row must be the column headings.` });
  if (errors.length) return empty();

  const get = (r: { cells: Record<string, Cell> }, k: keyof typeof FIELDS): Cell | undefined => (col[k] ? r.cells[col[k]!] : undefined);
  const formats = new Map(o.formats.map((f) => [lc(f.name), f]));
  const providers = new Map(o.providers.map((p) => [lc(p.name), p]));
  const services = new Map<string, ImportService>(), bands = new Map<string, ImportBand>();
  const newProviders = new Map<string, string>();
  let skipped = 0, rounded = 0, zeroCost = 0;

  for (const r of file.rows) {
    if (col.current && !flag(get(r, 'current'))) { skipped++; continue; }
    const provider = text(get(r, 'provider')), service = text(get(r, 'service')), formatName = text(get(r, 'format'));
    const min = whole(get(r, 'min')), max = whole(get(r, 'max')), cost = money(get(r, 'cost')), sell = money(get(r, 'sell'));
    const bad = (message: string): void => { errors.push({ row: r.row, message }); };
    if (!provider) { bad('The provider is empty.'); continue; }
    if (!service) { bad('The service is empty.'); continue; }
    if (provider.length > 100 || service.length > 100) { bad('The provider and service names can be at most 100 characters.'); continue; }
    const format = formats.get(lc(formatName));
    if (!format) { bad(`The format "${formatName}" is not one of: ${o.formats.map((f) => f.name).join(', ')}.`); continue; }
    if (min === null || max === null) { bad('The minimum and maximum weights must be whole numbers of grams.'); continue; }
    if (max < min) { bad(`The maximum weight (${max}g) is less than the minimum (${min}g).`); continue; }
    if (cost === 'bad' || sell === 'bad') { bad('The cost and sell price must be numbers of 0 or more.'); continue; }
    const price = (v: number | null): number | null => { if (v === null) return null; const x = Math.round(v * 1e4) / 1e4; if (Math.abs(x - v) > 1e-9) rounded++; return x; };
    const c = price(cost), s = price(sell);
    if (c === 0) zeroCost++;

    const skey = `${lc(provider)}|${lc(service)}|${format.id}`;
    const bkey = `${skey}|${min}|${max}`;
    const dup = bands.get(bkey);
    if (dup) { bad(`This is the same band as row ${dup.row} (${provider} – ${service}, ${format.name}, ${bandLabel(min, max)}).`); continue; }

    const existingProvider = providers.get(lc(provider));
    const existing = existingProvider?.services.find((x) => lc(x.name) === lc(service) && x.formatId === format.id);
    if (!existingProvider && !newProviders.has(lc(provider))) newProviders.set(lc(provider), provider);
    const code = text(get(r, 'code')) || null, signed = flag(get(r, 'signed')), tracked = flag(get(r, 'tracked'));
    const known = services.get(skey);
    if (!known) {
      services.set(skey, { key: skey, provider: existingProvider?.name ?? provider, name: existing?.name ?? service, format: format.name, formatId: format.id, serviceCode: existing ? existing.serviceCode : code,
        isSignedFor: existing ? existing.isSignedFor : signed, isTracked: existing ? existing.isTracked : tracked, isNew: !existing, providerId: existingProvider?.id ?? null, serviceId: existing?.id ?? null });
      if (existing && ((code ?? '') !== (existing.serviceCode ?? '') || signed !== existing.isSignedFor || tracked !== existing.isTracked))
        warnings.push({ row: r.row, message: `${existingProvider!.name} – ${existing.name} (${format.name}) already exists with a different code or signed-for/tracked setting. The service is left as it is.` });
    } else if (!known.isNew ? false : ((code ?? '') !== (known.serviceCode ?? '') || signed !== known.isSignedFor || tracked !== known.isTracked)) {
      warnings.push({ row: r.row, message: `${known.provider} – ${known.name} (${format.name}): this row's code or signed-for/tracked setting differs from the first row of the service, which is used.` });
    }

    // What the service's existing prices mean for this band
    const rows = existing?.rates ?? [];
    const label = bandLabel(min, max);
    const base: Omit<ImportBand, 'action' | 'before' | 'message'> = { key: bkey, serviceKey: skey, provider: existingProvider?.name ?? provider, service: existing?.name ?? service, format: format.name, minWeightG: min, maxWeightG: max, cost: c, sellPrice: s, row: r.row };
    const block = (message: string): void => { bands.set(bkey, { ...base, action: 'blocked', before: null, message }); };
    const crossing = rows.find((x) => (x.minWeightG !== min || x.maxWeightG !== max) && x.minWeightG <= max && min <= x.maxWeightG && overlaps(opt.startDate, opt.endDate, x.validFrom, x.validTo));
    if (crossing) { block(`Overlaps the existing band ${bandLabel(crossing.minWeightG, crossing.maxWeightG)} (${crossing.validFrom} to ${crossing.validTo ?? 'until replaced'}), which has different weights. Change the bands in Postal rates first.`); continue; }
    const mine = rows.filter((x) => x.minWeightG === min && x.maxWeightG === max);
    const inForce = mine.find((x) => x.validFrom <= opt.startDate && (x.validTo === null || x.validTo >= opt.startDate));
    const clash = mine.find((x) => x !== inForce && overlaps(opt.startDate, opt.endDate, x.validFrom, x.validTo));
    if (clash) { block(`A price for ${label} already covers ${clash.validFrom} to ${clash.validTo ?? 'until replaced'}. Edit that row in Postal rates, or choose other dates.`); continue; }
    if (!inForce) { bands.set(bkey, { ...base, action: 'new', before: null, message: null }); continue; }
    const before = { rateId: inForce.id, cost: inForce.cost, sellPrice: inForce.sellPrice, validFrom: inForce.validFrom, validTo: inForce.validTo };
    if (same(inForce.cost, c) && same(inForce.sellPrice, s)) { bands.set(bkey, { ...base, action: 'unchanged', before, message: null }); continue; }
    if (inForce.validFrom === opt.startDate) { bands.set(bkey, { ...base, action: 'update', before, message: 'A price already starts on this day, so its prices are replaced.' }); continue; }
    if (opt.startDate < o.today) { block(`${label} is already priced from ${inForce.validFrom}. New prices for a band that is in use must start today (${o.today}) or later, so earlier mail keeps the price of its day.`); continue; }
    bands.set(bkey, { ...base, action: 'change', before, message: null });
  }

  if (rounded) warnings.push({ row: null, message: `${rounded} price${rounded > 1 ? 's have' : ' has'} more than 4 decimal places. They are stored rounded to 4.` });
  if (zeroCost) warnings.push({ row: null, message: `${zeroCost} row${zeroCost > 1 ? 's have' : ' has'} a cost of 0. Check that is right and not a missing price.` });

  const list = [...bands.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.service.localeCompare(b.service) || a.format.localeCompare(b.format) || a.minWeightG - b.minWeightG);
  const count = (a: BandAction): number => list.filter((b) => b.action === a).length;
  const svcList = [...services.values()].sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name) || a.format.localeCompare(b.format));
  const counts: ImportCounts = { newProviders: newProviders.size, newServices: svcList.filter((s) => s.isNew).length, newBands: count('new'), changedBands: count('change'), updatedBands: count('update'), unchangedBands: count('unchanged'), blockedBands: count('blocked'), skippedRows: skipped };
  const work = counts.newBands + counts.changedBands + counts.updatedBands + counts.newServices + counts.newProviders;
  if (list.length === 0 && errors.length === 0) errors.push({ row: null, message: 'The file has no prices to import.' });
  return { startDate: opt.startDate, endDate: opt.endDate, fileRows: file.rows.length, newProviders: [...newProviders.values()], services: svcList, bands: list, errors, warnings, counts,
    canImport: errors.length === 0 && counts.blockedBands === 0 && work > 0 };
}

