import { bandLabel } from './rules.js';
import type { RateInput, ServiceInput } from './types.js';

const n = (x: number | null): string => (x === null ? 'not set' : String(Math.round(x * 1e4) / 1e4));
export const describeProviderCreated = (name: string): string => `Postal: added provider "${name}"`;
export const describeProviderRenamed = (from: string, to: string): string => `Postal: renamed provider "${from}" to "${to}"`;
export const describeProviderDeleted = (name: string): string => `Postal: deleted provider "${name}"`;
export const describeServiceCreated = (provider: string, name: string): string => `Postal: added service ${provider} – ${name}`;
export const describeServiceDeleted = (provider: string, name: string): string => `Postal: deleted service ${provider} – ${name}`;
export function describeServiceChange(provider: string, before: ServiceInput & { formatName: string }, after: ServiceInput & { formatName: string }): string | null {
  const parts: string[] = [];
  if (before.name !== after.name) parts.push(`name "${before.name}" → "${after.name}"`);
  if (before.formatId !== after.formatId) parts.push(`format ${before.formatName} → ${after.formatName}`);
  if ((before.serviceCode ?? '') !== (after.serviceCode ?? '')) parts.push(`code ${before.serviceCode ?? 'none'} → ${after.serviceCode ?? 'none'}`);
  for (const [k, label] of [['isSignedFor', 'signed for'], ['isTracked', 'tracked'], ['isRecorded', 'recorded']] as const) if (before[k] !== after[k]) parts.push(`${label} ${after[k] ? 'on' : 'off'}`);
  return parts.length ? `Postal: ${provider} – ${before.name} changed: ${parts.join('; ')}` : null;
}
export const describeRateCreated = (svc: string, r: RateInput): string => `Postal: added ${svc} ${bandLabel(r.minWeightG, r.maxWeightG)} from ${r.validFrom} (cost ${n(r.cost)}, sell ${n(r.sellPrice)})`;
export const describeRateDeleted = (svc: string, r: { minWeightG: number; maxWeightG: number; validFrom: string }): string => `Postal: deleted ${svc} ${bandLabel(r.minWeightG, r.maxWeightG)} from ${r.validFrom}`;
export function describeRateChange(svc: string, before: RateInput, after: RateInput): string | null {
  const parts: string[] = [];
  if (before.minWeightG !== after.minWeightG || before.maxWeightG !== after.maxWeightG) parts.push(`weights ${bandLabel(before.minWeightG, before.maxWeightG)} → ${bandLabel(after.minWeightG, after.maxWeightG)}`);
  if (before.validFrom !== after.validFrom) parts.push(`first day ${before.validFrom} → ${after.validFrom}`);
  if ((before.validTo ?? '') !== (after.validTo ?? '')) parts.push(`last day ${before.validTo ?? 'open'} → ${after.validTo ?? 'open'}`);
  if (before.cost !== after.cost) parts.push(`cost ${n(before.cost)} → ${n(after.cost)}`);
  if (before.sellPrice !== after.sellPrice) parts.push(`sell ${n(before.sellPrice)} → ${n(after.sellPrice)}`);
  return parts.length ? `Postal: ${svc} ${bandLabel(before.minWeightG, before.maxWeightG)} from ${before.validFrom} changed: ${parts.join('; ')}` : null;
}
export function describePriceChange(svc: string, from: string, rows: { min: number; max: number; cost: [number | null, number | null]; sell: [number | null, number | null] }[]): string {
  const bits = rows.map((r) => {
    const d: string[] = [];
    if (r.cost[0] !== r.cost[1]) d.push(`cost ${n(r.cost[0])} → ${n(r.cost[1])}`);
    if (r.sell[0] !== r.sell[1]) d.push(`sell ${n(r.sell[0])} → ${n(r.sell[1])}`);
    return `${bandLabel(r.min, r.max)}: ${d.join(', ')}`;
  });
  return `Postal: new prices for ${svc} from ${from}. ${bits.join('; ')}`;
}
