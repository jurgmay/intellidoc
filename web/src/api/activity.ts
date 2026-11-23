import { api } from './client';
import type { JobRow } from './jobs';

export interface InboxItem { stem: string; xmlName: string | null; xmlBytes: number | null; pdfName: string | null; pdfBytes: number | null; modifiedAt: string; estimateSeconds?: number | null }
export interface ActivityRow {
  id: number; kind: 'Import' | 'PDF check' | 'Print files'; label: string; jobId: number | null; state: 'Running' | 'Done' | 'Failed' | 'Abandoned';
  detail: string | null; done: number | null; total: number | null; startedAt: string; updatedAt: string; finishedAt: string | null; stalled: boolean;
  bytes: number | null; withPdf: boolean; remainingSeconds?: number | null;
}
export interface QueueEstimate { basedOn: number; seconds: number | null; partial: boolean }
export interface ActivityData { inbox: InboxItem[]; inboxUnavailable: string | null; running: ActivityRow[]; recent: ActivityRow[]; jobs: JobRow[]; queue: QueueEstimate; /** The "Make print files automatically" setting. */ autoCompose: boolean }
export const getActivity = (): Promise<ActivityData> => api('/api/activity');
