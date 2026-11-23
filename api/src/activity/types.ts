import type { JobRow } from '../jobs/types.js';
import type { QueueEstimate, Sample } from './estimate.js';

/** One file stem in the watcher's inbox: its XML and/or PDF. */
export interface InboxItem {
  stem: string;
  xmlName: string | null; xmlBytes: number | null;
  pdfName: string | null; pdfBytes: number | null;
  /** When the newest of its files was last written (ISO, UTC). */
  modifiedAt: string;
  /** About how many seconds the watcher will take over it, from recent jobs; null when there is not enough history. */
  estimateSeconds?: number | null;
}
export type ActivityKind = 'Import' | 'PDF check' | 'Print files';
export interface ActivityRow {
  id: number; kind: ActivityKind; label: string; jobId: number | null; state: 'Running' | 'Done' | 'Failed' | 'Abandoned';
  detail: string | null; done: number | null; total: number | null; startedAt: string; updatedAt: string; finishedAt: string | null;
  /** Running, but nothing has been recorded for a while: the program that was doing it has probably stopped. */
  stalled: boolean;
  /** Size of the file it is about, and whether a PDF is read as part of it (for the estimate). */
  bytes: number | null; withPdf: boolean;
  /** About how many seconds are left, when known. */
  remainingSeconds?: number | null;
}
export interface ActivityStore {
  /** Rows still Running, oldest first. */
  running(): Promise<ActivityRow[]>;
  /** Finished rows, newest first. */
  recent(limit: number): Promise<ActivityRow[]>;
  /** The last finished imports and PDF checks, for the time estimate. */
  samples(limit: number): Promise<Sample[]>;
}
/** Reads the watcher's inbox folder. */
export interface InboxReader {
  /** Why the inbox cannot be read from this server, or null. */
  unavailable(): string | null;
  list(): Promise<InboxItem[]>;
}
export interface ActivityDeps { store: ActivityStore; inbox: InboxReader; settings: { read(): Promise<Record<string, unknown>> }; jobs: { list(q: { search: null; status: null; limit: number }): Promise<JobRow[]> } }
export interface ActivityResponse {
  inbox: InboxItem[]; inboxUnavailable: string | null;
  running: ActivityRow[]; recent: ActivityRow[]; jobs: JobRow[];
  queue: QueueEstimate;
  /** The "Make print files automatically" setting; when off, nothing makes print files until someone presses the button. */
  autoCompose: boolean;
}
export const STALLED_AFTER_MS = 10 * 60_000;
