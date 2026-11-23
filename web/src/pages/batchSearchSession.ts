import type { BatchResult } from '../api/batches';
import type { RecipientRow } from '../api/recipients';

/** The mailpieces fetched so far for one opened batch. */
export interface BatchPieces { rows: RecipientRow[]; more: boolean }

/** What the Batches page shows, kept while the app is open so leaving the page and coming back finds it as it was. Not kept after the tab is closed. */
export interface BatchSearchSession {
  account: string | null;
  form: { code: string; status: string; job: string; from: string; to: string };
  result: BatchResult | null;
  /** When the results were fetched (ISO). */
  searchedAt: string | null;
  /** The batches whose mailpieces are shown. */
  expanded: number[];
  /** The mailpieces loaded for each opened batch, by batch id. */
  pieces: Record<number, BatchPieces>;
  /** The mailpieces whose letters are shown. */
  openPieces: number[];
}

export const EMPTY_BATCH_FORM = { code: '', status: '', job: '', from: '', to: '' };
const KEY = 'intellidoc.batchSearch';
const blank = (): BatchSearchSession => ({ account: null, form: { ...EMPTY_BATCH_FORM }, result: null, searchedAt: null, expanded: [], pieces: {}, openPieces: [] });

function load(): BatchSearchSession {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw) return { ...blank(), ...(JSON.parse(raw) as Partial<BatchSearchSession>) };
  } catch { /* storage may be unavailable or hold something else: start empty */ }
  return blank();
}

let current: BatchSearchSession | null = null;

export const getBatchSearchSession = (): BatchSearchSession => (current ??= load());

export function saveBatchSearchSession(s: BatchSearchSession): void {
  current = s;
  try { window.sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* too big or not allowed: it is still kept in memory */ }
}

/** Forgets everything (used by the tests). */
export function resetBatchSearchSession(): void {
  current = null;
  try { window.sessionStorage.removeItem(KEY); } catch { /* nothing to forget */ }
}
