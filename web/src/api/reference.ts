import { api } from './client';

export interface Paper { id: number; name: string; batchName: string; paperCode: string | null; usedBy: number }
export interface PostalFormat { id: number; name: string; rank: number; maxWeightG: number; maxThicknessMm: number | null; maxSheets: number | null; maxWidthMm: number; maxHeightMm: number; usedBy: number }
export interface ReferenceHistoryRow { id: number; changedAt: string; changedBy: string; summary: string }

export const getPapers = () => api<{ papers: Paper[] }>('/api/reference/papers');
export const savePaper = (id: number, body: { batchName: string; paperCode: string | null }) => api<unknown>(`/api/reference/papers/${id}`, { method: 'PUT', body });
export const deletePaper = (id: number) => api<unknown>(`/api/reference/papers/${id}`, { method: 'DELETE' });

export const getFormats = () => api<{ formats: PostalFormat[] }>('/api/reference/postal-formats');
export const saveFormat = (id: number, body: { maxWeightG: number; maxThicknessMm: number | null; maxSheets: number | null; maxWidthMm: number; maxHeightMm: number }) =>
  api<unknown>(`/api/reference/postal-formats/${id}`, { method: 'PUT', body });

export const getAnonymous = () => api<{ names: string[] }>('/api/reference/anonymous');
export const addAnonymous = (text: string) => api<{ text: string }>('/api/reference/anonymous', { method: 'POST', body: { text } });
export const deleteAnonymous = (text: string) => api<unknown>(`/api/reference/anonymous/${encodeURIComponent(text)}`, { method: 'DELETE' });

export const getReferenceHistory = () => api<{ rows: ReferenceHistoryRow[] }>('/api/reference/history');
