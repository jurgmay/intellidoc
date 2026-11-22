import type { JobRow } from '../jobs/types.js';

/** One file stem in the watcher's inbox: its XML and/or PDF. */
export interface InboxItem {
  stem: string;
  xmlName: string | null; xmlBytes: number | null;
  pdfName: string | null; pdfBytes: number | null;
  /** When the newest of its files was last written (ISO, UTC). */
  modifiedAt: string;
}
export type ActivityKind = 'Import' | 'PDF check' | 'Print files';
export interface ActivityRow {
  id: number; kind: ActivityKind; label: string; jobId: number | null; state: 'Running' | 'Done' | 'Failed' | 'Abandoned';
  detail: string | null; done: number | null; total: number | null; startedAt: string; updatedAt: string; finishedAt: string | null;
  /** Running, but nothing has been recorded for a while: the program that was doing it has probably stopped. */
  stalled: boolean;
}
export interface ActivityStore {
  /** Rows still Running, oldest first. */
  running(): Promise<ActivityRow[]>;
  /** Finished rows, newest first. */
  recent(limit: number): Promise<ActivityRow[]>;
}
/** Reads the watcher's inbox folder. */
export interface InboxReader {
  /** Why the inbox cannot be read from this server, or null. */
  unavailable(): string | null;
  list(): Promise<InboxItem[]>;
}
export interface ActivityDeps { store: ActivityStore; inbox: InboxReader; jobs: { list(q: { search: null; status: null; limit: number }): Promise<JobRow[]> } }
export interface ActivityResponse {
  inbox: InboxItem[]; inboxUnavailable: string | null;
  running: ActivityRow[]; recent: ActivityRow[]; jobs: JobRow[];
}
export const STALLED_AFTER_MS = 10 * 60_000;
