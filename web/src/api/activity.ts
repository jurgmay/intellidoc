import { api } from './client';
import type { JobRow } from './jobs';

export interface InboxItem { stem: string; xmlName: string | null; xmlBytes: number | null; pdfName: string | null; pdfBytes: number | null; modifiedAt: string }
export interface ActivityRow {
  id: number; kind: 'Import' | 'PDF check' | 'Print files'; label: string; jobId: number | null; state: 'Running' | 'Done' | 'Failed' | 'Abandoned';
  detail: string | null; done: number | null; total: number | null; startedAt: string; updatedAt: string; finishedAt: string | null; stalled: boolean;
  bytes: number | null; withPdf: boolean;
}
export interface ActivityData { inbox: InboxItem[]; inboxUnavailable: string | null; running: ActivityRow[]; recent: ActivityRow[]; jobs: JobRow[]; /** The "Make print files automatically" setting. */ autoCompose: boolean }
/** Puts a failed import or PDF check back in the inbox for the watcher to take again. */
export const retryActivity = (id: number): Promise<{ restored: string[] }> => api(`/api/activity/${id}/retry`, { method: 'POST' });
/** Takes a failed row off the list. */
export const dismissActivity = (id: number): Promise<{ ok: boolean }> => api(`/api/activity/${id}/dismiss`, { method: 'POST' });
export const getActivity = (): Promise<ActivityData> => api('/api/activity');
