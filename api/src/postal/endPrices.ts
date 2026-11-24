import { ValidationError } from '../errors.js';
import { bandLabel } from './rules.js';
import type { PostalOverview } from './types.js';

export interface EndRow { rateId: number; provider: string; service: string; format: string; minWeightG: number; maxWeightG: number; validFrom: string; validTo: string | null }
export interface EndPlan { lastDay: string; rows: EndRow[]; services: number; startingLater: number }

/**
 * Which prices a "last day for all prices" would end: every row that has started by the last day and runs past it (open, or ending later).
 * Rows that already end on or before the last day are left as they are, and rows that only start after it are counted but not touched.
 */
export function planEnd(o: PostalOverview, lastDay: string): EndPlan {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lastDay) || new Date(`${lastDay}T00:00:00Z`).toISOString().slice(0, 10) !== lastDay) throw new ValidationError({ lastDay: 'The last day must be a date.' });
  if (lastDay < o.today) throw new ValidationError({ lastDay: 'The last day cannot be in the past. Earlier mail was priced with the prices of its day.' });
  const rows: EndRow[] = []; const services = new Set<number>(); let startingLater = 0;
  for (const p of o.providers) for (const s of p.services) for (const r of s.rates) {
    if (r.validFrom > lastDay) { startingLater++; continue; }
    if (r.validTo !== null && r.validTo <= lastDay) continue;
    rows.push({ rateId: r.id, provider: p.name, service: s.name, format: s.formatName, minWeightG: r.minWeightG, maxWeightG: r.maxWeightG, validFrom: r.validFrom, validTo: r.validTo });
    services.add(s.id);
  }
  return { lastDay, rows, services: services.size, startingLater };
}
export const describeEnd = (plan: EndPlan): string => `Postal: set the last day of ${plan.rows.length} price${plan.rows.length === 1 ? '' : 's'} (${plan.services} service${plan.services === 1 ? '' : 's'}) to ${plan.lastDay}. e.g. ${plan.rows.slice(0, 1).map((r) => `${r.provider} – ${r.service} ${bandLabel(r.minWeightG, r.maxWeightG)}`).join('')}`;
