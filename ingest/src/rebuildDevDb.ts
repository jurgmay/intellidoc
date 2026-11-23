import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Wipes the scratch database and rebuilds it with your real data, in four steps that stop at the first failure:
 *   1. drop and recreate the idoc schema (DESTROYS everything in INTELLIDOC_DB)
 *   2. load the FileMaker reference export from <folder>
 *   3. give every stock item without a code its unique 5-digit code
 *   4. apply your own Settings from db/local_settings.sql, if that file exists (npm run settings:export writes it)
 *   npm run db:rebuild -- <folder> [--start=10001]       (PowerShell: the -- is swallowed, so just: npm run db:rebuild C:\idoc-import)
 */
const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--'));
if (!dir) { console.error('Usage: npm run db:rebuild <folder with the FileMaker exports> [--start=10001]'); process.exit(2); }
const start = args.find((a) => a.startsWith('--start='));

const steps: [string, string, string[]][] = [
  ['1/4 Reset the schema', './initDevDb.ts', ['--reset']],
  ['2/4 Import the FileMaker reference data', './import/cli.ts', [dir, '--apply']],
  ['3/4 Assign stock codes', './import/assignCodes.ts', ['--apply', ...(start ? [start] : [])]],
  ['4/4 Apply your settings', './applyLocalSettings.ts', []],
];
for (const [label, file, extra] of steps) {
  console.log(`\n=== ${label} ===`);
  const r = spawnSync(process.execPath, ['--env-file=.env', '--import', 'tsx', fileURLToPath(new URL(file, import.meta.url)), ...extra], { stdio: 'inherit' });
  if (r.status !== 0) { console.error(`\nStopped: step ${label} failed. Nothing after it was run.`); process.exit(r.status ?? 1); }
}
console.log('\nDone. The scratch database now holds your reference data with stock codes assigned, and your settings if db/local_settings.sql exists.');
