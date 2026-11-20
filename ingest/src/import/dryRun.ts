import { readFileSync } from 'node:fs';
import { parseMer } from './mer.js';
import { buildPlan, summarise, type Exports, type Plan } from './plan.js';

export function loadExports(dir: string, names = { customers: 'customers.mer', brands: 'brands.mer', stock: 'stock_items.mer', envelopes: 'envelopes.mer' }): Exports {
  const r = (f: string) => parseMer(readFileSync(`${dir}/${f}`, 'utf8'));
  return { customers: r(names.customers), brands: r(names.brands), stock: r(names.stock), envelopes: r(names.envelopes) };
}
export const planFromDir = (dir: string): Plan => buildPlan(loadExports(dir));
export { summarise };
