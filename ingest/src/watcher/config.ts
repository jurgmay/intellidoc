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
}

export class ConfigError extends Error {}

/** Environment: INTELLIDOC_DB, WATCH_DIR, POLL_SECONDS(5), STABLE_SECONDS(10), RETRY_SECONDS(60), PDF_ENGINE(auto|qpdf|pdflib), CHECK_POSTCODES(0|1), LOG_FILE. Flags: --dry-run, --once. */
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
  };
}
