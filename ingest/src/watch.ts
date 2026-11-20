import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import sql from 'mssql';
import { FolderWatcher } from './watcher/folderWatcher.js';
import { loadConfig, ConfigError } from './watcher/config.js';
import { makeProcessor } from './watcher/processor.js';
import { MssqlRepository } from './mssql/repository.js';
import { loadReferenceData } from './mssql/reference.js';
import { CliPdfInspector, PdfLibInspector, type PdfInspector } from './pdf.js';
import type { Repository } from './repository.js';

let cfg;
try { cfg = loadConfig(process.env, process.argv.slice(2)); } catch (e) {
  if (e instanceof ConfigError) { console.error(`${e.message}\nSee ingest/README.md (Folder watcher).`); process.exit(2); }
  throw e;
}

const log = (level: 'info' | 'warn' | 'error', msg: string): void => {
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${msg}`;
  (level === 'error' ? console.error : console.log)(line);
  if (cfg.logFile) { try { appendFileSync(cfg.logFile, line + '\n'); } catch { /* logging must never stop the service */ } }
};

function qpdfAvailable(): boolean {
  try { execFileSync('qpdf', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}
let pdf: PdfInspector;
if (cfg.pdfEngine === 'pdflib' || (cfg.pdfEngine === 'auto' && !qpdfAvailable())) {
  if (cfg.checkPostcodes) { log('error', 'CHECK_POSTCODES=1 needs qpdf and pdftotext on the PATH'); process.exit(2); }
  pdf = new PdfLibInspector(); log('info', 'PDF engine: pdf-lib (in-process)');
} else { pdf = new CliPdfInspector(); log('info', 'PDF engine: qpdf'); }

const pool = new sql.ConnectionPool(cfg.connectionString);
pool.on('error', (e) => log('error', `Database connection error: ${e.message}`));
for (let attempt = 1; ; attempt++) {
  try { await pool.connect(); break; } catch (e) {
    log('error', `Cannot connect to the database (attempt ${attempt}): ${(e as Error).message}`);
    if (cfg.once) process.exit(1);
    await new Promise((r) => setTimeout(r, Math.min(60_000, attempt * 5_000)));
  }
}
const dbName = (await pool.request().query('SELECT DB_NAME() AS n')).recordset[0].n as string;
log('info', `Connected to database "${dbName}"${cfg.dryRun ? ' (DRY RUN: nothing will be saved, files stay in the inbox)' : ''}`);

const real = new MssqlRepository(pool);
const repo: Repository = cfg.dryRun ? { packExists: (g) => real.packExists(g), saveJob: async () => { /* dry run */ } } : real;
const watcher = new FolderWatcher(cfg.dirs, {
  process: makeProcessor({ loadReference: () => loadReferenceData(pool), repo, pdf, checkPostcodes: cfg.checkPostcodes }),
  log, now: () => Date.now(),
}, { stableMs: cfg.stableMs, retryMs: cfg.retryMs, orphanWarnMs: 5 * 60_000, dryRun: cfg.dryRun });

await watcher.init();
log('info', `Watching ${cfg.dirs.inbox}`);

const abort = new AbortController();
for (const s of ['SIGINT', 'SIGTERM'] as const) process.on(s, () => { log('info', `${s}: finishing the current file, then stopping`); abort.abort(); });

if (cfg.once) {
  // handle what is there (waiting for files to settle), then exit
  while (!abort.signal.aborted) {
    const n = await watcher.scanOnce();
    if (n === 0 && watcher.waiting() === 0) break;
    await new Promise((r) => setTimeout(r, Math.max(Math.min(cfg.pollMs, 1000), 200)));
  }
} else {
  await watcher.run(cfg.pollMs, abort.signal);
}
await pool.close();
log('info', 'Stopped');
