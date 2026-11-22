import { api } from './client';

export type JobStatus = 'Received' | 'Awaiting PDF' | 'PDF Rejected';
export const JOB_STATUSES: JobStatus[] = ['Received', 'Awaiting PDF', 'PDF Rejected'];
export interface JobRow {
  id: number; customerCode: string; customerName: string; baseName: string; pdfFileName: string; receivedAt: string; status: JobStatus;
  packCount: number | null; pageCount: number | null; pdfError: string | null; batchCount: number; composedBatchCount: number;
}
export interface JobFile { fileName: string; segment: number; mailpieces: number; pages: number }
export interface JobBatch { id: number; batchCode: number; status: string; mailpieceCount: number; files: JobFile[] }
export interface JobDetail extends JobRow { batches: JobBatch[] }
export interface ComposeBatchResult { batchCode: number; files: string[]; mrdfFile: string | null; skipped: string | null }
export interface JobList { rows: JobRow[]; canCompose: boolean; composeUnavailable: string | null }

export const listJobs = (search: string, status: string | null): Promise<JobList> => {
  const q = new URLSearchParams(); if (search.trim()) q.set('search', search.trim()); if (status) q.set('status', status);
  return api(`/api/jobs${q.size ? `?${q}` : ''}`);
};
export const getJob = (id: number): Promise<JobDetail> => api(`/api/jobs/${id}`);
export const composeJob = (id: number, onlyNew: boolean): Promise<{ batches: ComposeBatchResult[] }> => api(`/api/jobs/${id}/compose`, { method: 'POST', body: { onlyNew } });
