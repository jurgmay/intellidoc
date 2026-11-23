import type { RecipientResult } from '../api/recipients';

/** What the Mailpieces page shows, kept while the app is open so leaving the page and coming back finds it as it was. Not kept after the tab is closed. */
export interface RecipientSearchSession {
  account: string | null;
  form: { name: string; address: string; reference: string; referenceKey: string; jobGuid: string; packGuid: string; from: string; to: string };
  result: RecipientResult | null;
  /** When the results were fetched (ISO). */
  searchedAt: string | null;
  /** The mailpieces whose letters are shown. */
  expanded: number[];
}

export const EMPTY_FORM = { name: '', address: '', reference: '', referenceKey: '', jobGuid: '', packGuid: '', from: '', to: '' };
const KEY = 'intellidoc.recipientSearch';
const blank = (): RecipientSearchSession => ({ account: null, form: { ...EMPTY_FORM }, result: null, searchedAt: null, expanded: [] });

function load(): RecipientSearchSession {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (raw) return { ...blank(), ...(JSON.parse(raw) as Partial<RecipientSearchSession>) };
  } catch { /* storage may be unavailable or hold something else: start empty */ }
  return blank();
}

let current: RecipientSearchSession | null = null;

export const getRecipientSearchSession = (): RecipientSearchSession => (current ??= load());

export function saveRecipientSearchSession(s: RecipientSearchSession): void {
  current = s;
  try { window.sessionStorage.setItem(KEY, JSON.stringify(s)); } catch { /* too big or not allowed: it is still kept in memory */ }
}

/** Forgets everything (used by the tests). */
export function resetRecipientSearchSession(): void {
  current = null;
  try { window.sessionStorage.removeItem(KEY); } catch { /* nothing to forget */ }
}
