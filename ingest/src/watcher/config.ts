import { join, resolve } from 'node:path';
import type { WatcherDirs } from './folderWatcher.js';

export interface Config {
  connectionString: string;
  dirs: WatcherDirs;
  pollMs: number;
  stableMs: number;
  retryMs: number;
  pdfEngine: 'auto' | 'qpdf' | 'pdflib';
  checkPostcodes: boolean;
  dryRun: boolean;
  once: boolean;
  logFile?: string;
  /** Where print PDFs are written. Unset: the watcher never makes them (the compose command still can). */
  composeOutDir?: string;
  /** Where MRDF files (<batchCode>.txt) go for customers that use MRDF: the inserter's input folder. Unset: no MRDF file is written. */
  mrdfOutDir?: string;
  /** Import an XML on its own when its PDF has not arrived (default). XML_FIRST=0 restores waiting for the pair. */
  xmlFirst: boolean;
  pdfWaitMinutes: number;
  pdfReminderMinutes: number;
  alertTo: string[];
  smtp?: { host: string; port: number; secure: boolean; user?: string; pass?: string; from: string };
}

export class ConfigError extends Error {}

/** Environment: INTELLIDOC_DB, WATCH_DIR, POLL_SECONDS(5), STABLE_SECONDS(10), RETRY_SECONDS(60), XML_FIRST(1), PDF_WAIT_MINUTES(30), PDF_REMINDER_MINUTES(=wait), ALERT_TO (comma separated), SMTP_HOST, SMTP_PORT(587), SMTP_SECURE(0), SMTP_USER, SMTP_PASS, SMTP_FROM, COMPOSE_OUT_DIR, MRDF_OUT_DIR, GS_PATH, PDF_ENGINE(auto|qpdf|pdflib), CHECK_POSTCODES(0|1), LOG_FILE. Flags: --dry-run, --once. */
export function loadConfig(env: NodeJS.ProcessEnv, argv: string[]): Config {
  const need = (k: string): string => { const v = env[k]; if (!v) throw new ConfigError(`Missing setting ${k}`); return v; };
  const num = (k: string, def: number): number => {
    const v = env[k]; if (v === undefined || v === '') return def;
    const n = Number(v); if (!Number.isFinite(n) || n < 0) throw new ConfigError(`${k} must be a non-negative number`); return n;
  };
  const engine = (env['PDF_ENGINE'] ?? 'auto').toLowerCase();
  if (!['auto', 'qpdf', 'pdflib'].includes(engine)) throw new ConfigError('PDF_ENGINE must be auto, qpdf or pdflib');
  const base = resolve(need('WATCH_DIR'));
  const dryRun = argv.includes('--dry-run');
  return {
    connectionString: need('INTELLIDOC_DB'),
    dirs: { inbox: join(base, 'inbox'), processing: join(base, 'processing'), processed: join(base, 'processed'), duplicates: join(base, 'duplicates'), failed: join(base, 'failed') },
    pollMs: num('POLL_SECONDS', 5) * 1000, stableMs: num('STABLE_SECONDS', 10) * 1000, retryMs: num('RETRY_SECONDS', 60) * 1000,
    pdfEngine: engine as Config['pdfEngine'], checkPostcodes: env['CHECK_POSTCODES'] === '1', dryRun, once: argv.includes('--once'),
    logFile: env['LOG_FILE'] || undefined,
    composeOutDir: env['COMPOSE_OUT_DIR'] ? resolve(env['COMPOSE_OUT_DIR']) : undefined,
    mrdfOutDir: env['MRDF_OUT_DIR'] ? resolve(env['MRDF_OUT_DIR']) : undefined,
    xmlFirst: env['XML_FIRST'] !== '0',
    pdfWaitMinutes: num('PDF_WAIT_MINUTES', 30),
    pdfReminderMinutes: num('PDF_REMINDER_MINUTES', num('PDF_WAIT_MINUTES', 30)),
    alertTo: (env['ALERT_TO'] ?? '').split(/[;,]/).map((x) => x.trim()).filter(Boolean),
    smtp: env['SMTP_HOST'] ? {
      host: env['SMTP_HOST'], port: num('SMTP_PORT', 587), secure: env['SMTP_SECURE'] === '1', user: env['SMTP_USER'] || undefined, pass: env['SMTP_PASS'] || undefined,
      from: env['SMTP_FROM'] || env['SMTP_USER'] || (() => { throw new ConfigError('SMTP_FROM (or SMTP_USER) is needed with SMTP_HOST'); })(),
    } : undefined,
  };
}
