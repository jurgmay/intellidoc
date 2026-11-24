import { applyDuePendingJobNumbers } from './mssql/jobNumbers.js';
import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import sql from 'mssql';
import { FolderWatcher } from './watcher/folderWatcher.js';
import { loadConfig, ConfigError } from './watcher/config.js';
import { makeProcessor, makeAttachProcessor } from './watcher/processor.js';
import { PdfWatchdog } from './watcher/pdfWatchdog.js';
import { AutoComposer } from './compose/auto.js';
import { DbActivity, noActivity, type ActivityLog } from './activity.js';
import { tracked } from './watcher/tracked.js';
import { GhostscriptGrey } from './compose/grey.js';
import { loadAlertSettings, type AlertSettings } from './mssql/alertSettings.js';
import { LogMailer, SmtpMailer, type Mailer } from './mail.js';
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

const real = new MssqlRepository(pool, (jobId, e) => log('error', `Could not price job ${jobId}; its mailpieces stay unpriced: ${(e as Error).message}`));
// XML-first and alert settings live in the database (Settings screen) and are re-read every minute; the environment values are only the fallback.
let live: AlertSettings = { xmlFirst: cfg.xmlFirst, pdfWaitMinutes: cfg.pdfWaitMinutes, pdfReminderMinutes: cfg.pdfReminderMinutes, alertTo: cfg.alertTo, activityKeepDays: 7 };
async function refreshSettings(): Promise<void> {
  try { live = await loadAlertSettings(pool); } catch (e) { log('warn', `Could not read the alert settings from the database (${(e as Error).message}); using the last known values`); }
}
await refreshSettings();
const repo: Repository = cfg.dryRun ? { packExists: (g) => real.packExists(g), saveJob: async () => { /* dry run */ } } : real;
const mailer: Mailer = cfg.smtp ? new SmtpMailer(cfg.smtp) : new LogMailer(log);
if (!cfg.smtp) log('warn', 'SMTP_HOST is not set: "PDF missing" alerts will only be written to the log');
if (cfg.smtp && live.alertTo.length === 0) log('warn', 'No alert recipients are set (Settings screen): there is nobody to send "PDF missing" alerts to');
const process1 = makeProcessor({ loadReference: () => loadReferenceData(pool), repo, pdf, checkPostcodes: cfg.checkPostcodes });
const attach = makeAttachProcessor({ repo: real, pdf, notify: async (_to, subject, text) => { try { await mailer.send(live.alertTo, subject, text); } catch (e) { log('error', `Could not send "${subject}": ${(e as Error).message}`); } } });
const dbActivity = new DbActivity(pool, (m) => log('warn', m));
const activity: ActivityLog = cfg.dryRun ? noActivity : dbActivity;
if (!cfg.dryRun) await dbActivity.tidy(live.activityKeepDays);
const watcher = new FolderWatcher(cfg.dirs, {
  process: (x, p) => tracked(activity, 'Import', x, (report) => process1(x, p, report), { sizeOf: p, withPdf: true }),
  processXmlOnly: (x: string) => tracked(activity, 'Import', x, (report) => process1(x, null, report)),
  attachPdf: (p: string) => tracked(activity, 'PDF check', p, (report) => attach(p, report), { withPdf: true }), xmlFirstEnabled: () => live.xmlFirst,
  log, now: () => Date.now(),
}, { stableMs: cfg.stableMs, retryMs: cfg.retryMs, orphanWarnMs: 5 * 60_000, dryRun: cfg.dryRun });

const abort = new AbortController();
function abortSignalCleanup(t: NodeJS.Timeout): void { abort.signal.addEventListener('abort', () => clearInterval(t), { once: true }); }
for (const s of ['SIGINT', 'SIGTERM'] as const) process.on(s, () => { log('info', `${s}: finishing the current file, then stopping`); abort.abort(); });

await watcher.init();
if (!cfg.dryRun && !cfg.once) {
  const dog = new PdfWatchdog(real, mailer, { get waitMinutes() { return live.pdfWaitMinutes; }, get reminderMinutes() { return live.pdfReminderMinutes; }, get to() { return live.alertTo; }, inbox: cfg.dirs.inbox }, log);
  const composer = cfg.composeOutDir
    ? new AutoComposer({ pool, pdfDir: cfg.dirs.processed, outDir: cfg.composeOutDir, mrdfDir: cfg.mrdfOutDir, grey: new GhostscriptGrey(), mailer, activity, log, notify: (subject, text) => mailer.send(live.alertTo, subject, text) })
    : null;
  if (composer) log('info', `Print files go to ${cfg.composeOutDir} when "Make print files automatically" is on in Settings`);
  if (composer && !cfg.mrdfOutDir) log('warn', 'MRDF_OUT_DIR is not set: customers that use MRDF get the page codes but no MRDF file');
  else if (composer) log('info', `MRDF files go to ${cfg.mrdfOutDir}`);
  if (!composer) log('info', 'COMPOSE_OUT_DIR is not set: print files are not made by the watcher');
  const rollJobNumbers = (): void => {
    applyDuePendingJobNumbers(pool).then((n) => { if (n > 0) log('info', `${n} pending job number${n === 1 ? '' : 's'} took effect`); })
      .catch((e) => log('error', `Pending job numbers: ${(e as Error).message}`));
  };
  const tick = (): void => { rollJobNumbers(); void composer?.run(); refreshSettings().then(() => (live.xmlFirst ? dog.check() : 0)).catch((e) => log('error', `PDF check failed: ${(e as Error).message}`)); };
  const timer = setInterval(tick, 60_000);
  // Finished Activity rows older than the Settings value are cleared every hour (and at start-up, above)
  const tidyTimer = setInterval(() => { void dbActivity.tidy(live.activityKeepDays); }, 3_600_000);
  abortSignalCleanup(timer); abortSignalCleanup(tidyTimer);
  tick();
  log('info', `XML-first import ${live.xmlFirst ? 'on' : 'OFF'}: alert after ${live.pdfWaitMinutes} min without a PDF, then every ${live.pdfReminderMinutes} min (settings are re-read every minute)`);
}
log('info', `Watching ${cfg.dirs.inbox}`);


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
