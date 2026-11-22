import { CHARGES, type ModelInput } from './types.js';

const n = (x: number): string => String(Math.round(x * 1e4) / 1e4);
const label = (code: string): string => CHARGES.find((c) => c.code === code)?.label ?? code;

/** One readable audit line saying what changed in a costing model. */
export function describeModelChange(name: string, before: ModelInput, after: ModelInput, envName: (stockItemId: number) => string, rateName: (id: number) => string): string | null {
  const parts: string[] = [];
  if (before.name !== after.name) parts.push(`name "${before.name}" → "${after.name}"`);
  if ((before.validFrom ?? '') !== (after.validFrom ?? '')) parts.push(`first day ${before.validFrom ?? 'none'} → ${after.validFrom ?? 'none'}`);
  if ((before.validTo ?? '') !== (after.validTo ?? '')) parts.push(`last day ${before.validTo ?? 'open'} → ${after.validTo ?? 'open'}`);
  if (before.isActive !== after.isActive) parts.push(after.isActive ? 'switched on' : 'switched off');
  if ((before.comments ?? '') !== (after.comments ?? '')) parts.push('comments changed');
  const bc = new Map(before.charges.map((c) => [c.code, c])); const ac = new Map(after.charges.map((c) => [c.code, c]));
  for (const code of [...new Set([...bc.keys(), ...ac.keys()])]) {
    const b = bc.get(code) ?? { cost: 0, sellPrice: 0, adjustment: 0 }; const a = ac.get(code) ?? { cost: 0, sellPrice: 0, adjustment: 0 };
    const d = (['cost', 'sellPrice', 'adjustment'] as const).filter((f) => b[f] !== a[f]).map((f) => `${f === 'sellPrice' ? 'sell' : f} ${n(b[f])} → ${n(a[f])}`);
    if (d.length) parts.push(`${label(code)}: ${d.join(', ')}`);
  }
  const be = new Map(before.envelopes.map((e) => [e.stockItemId, e])); const ae = new Map(after.envelopes.map((e) => [e.stockItemId, e]));
  for (const id of [...new Set([...be.keys(), ...ae.keys()])]) {
    const b = be.get(id); const a = ae.get(id);
    if (!a) parts.push(`envelope ${envName(id)} removed`);
    else if (!b) parts.push(`envelope ${envName(id)} added (cost ${n(a.cost)}, sell ${n(a.sellPrice)})`);
    else if (b.cost !== a.cost || b.sellPrice !== a.sellPrice || b.adjustment !== a.adjustment) parts.push(`envelope ${envName(id)}: cost ${n(b.cost)} → ${n(a.cost)}, sell ${n(b.sellPrice)} → ${n(a.sellPrice)}, adjustment ${n(b.adjustment)} → ${n(a.adjustment)}`);
  }
  const bp = new Map(before.postage.map((p) => [p.postalRateId, p.adjustment])); const ap = new Map(after.postage.map((p) => [p.postalRateId, p.adjustment]));
  for (const id of [...new Set([...bp.keys(), ...ap.keys()])]) {
    const b = bp.get(id) ?? 0; const a = ap.get(id) ?? 0;
    if (a !== b) parts.push(`postage ${rateName(id)}: adjustment ${n(b)} → ${n(a)}`);
  }
  return parts.length ? `Costing model "${name}" changed: ${parts.join('; ')}` : null;
}
export const describeModelCreated = (name: string, from: string | null): string => `Created costing model "${name}"${from ? ` (copied from "${from}")` : ''}`;
export const describeModelRemoved = (name: string): string => `Deleted costing model "${name}"`;
export const describeCostingMode = (from: string, to: string): string => `Costing: ${from === 'OWN' ? 'own prices' : 'parent’s prices'} → ${to === 'OWN' ? 'own prices' : 'parent’s prices'}`;
