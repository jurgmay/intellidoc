import { writeFileSync } from 'node:fs';
import sql from 'mssql';
import { applyPlan } from './apply.js';
import { planFromDir, summarise } from './dryRun.js';

/**
 * Reference-data import from the FileMaker exports.
 *   npm run import:ref -- <folder>            dry run: reads the four .mer files, prints what WOULD be loaded and every warning
 *   npm run import:ref -- <folder> --apply    loads it into INTELLIDOC_DB (one transaction; safe to re-run)
 * Expected files in <folder>: customers.mer, brands.mer, stock_items.mer, envelopes.mer
 */
const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
if (!dir) { console.error('Usage: npm run import:ref -- <folder> [--apply]'); process.exit(2); }
const plan = planFromDir(dir);
console.log(summarise(plan).join('\n'));
const report = `${dir}/import-warnings.txt`;
writeFileSync(report, plan.warnings.join('\n') + '\n');
console.log(`\n${plan.warnings.length} warnings written to ${report}`);
if (!args.includes('--apply')) { console.log('Dry run only. Add --apply to load into INTELLIDOC_DB.'); process.exit(0); }
const cs = process.env['INTELLIDOC_DB'];
if (!cs) { console.error('Set INTELLIDOC_DB first'); process.exit(2); }
const pool = new sql.ConnectionPool(cs);
await pool.connect();
try { console.log('Loaded:', JSON.stringify(await applyPlan(pool, plan))); } finally { await pool.close(); }
