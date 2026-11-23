import { api, ApiError } from './client';

export type SettingValue = number | boolean | string;
export interface SettingView {
  key: string; group: string; label: string; type: 'number' | 'integer' | 'boolean' | 'select' | 'emails' | 'text' | 'secret';
  unit?: string; min?: number; max?: number; step?: number; allowed?: number[];
  description: string; usedBy: string; appliesTo: string;
  value: SettingValue; options?: string[];
  /** A secret (password) is never sent: its value is empty and this says whether one is saved. */
  isSet?: boolean;
}
export interface BatchCodeInfo { highestUsed: number | null; next: number }
export interface SettingsPayload { groups: string[]; settings: SettingView[]; batchCode: BatchCodeInfo }
export interface AuditRow { id: number; changedAt: string; changedBy: string; setting: string; oldValue: string | null; newValue: string | null }

export const getSettings = (): Promise<SettingsPayload> => api('/api/settings');
export const saveSettings = (values: Record<string, SettingValue>): Promise<SettingsPayload & { changed: number }> => api('/api/settings', { method: 'PUT', body: { values } });
/** Removes a saved password. */
export const removeSecret = (key: string): Promise<SettingsPayload> => api(`/api/settings/${encodeURIComponent(key)}/secret`, { method: 'DELETE' });
export const getAudit = (): Promise<{ rows: AuditRow[] }> => api('/api/settings/audit?limit=100');
export const setNextBatchCode = (next: number): Promise<BatchCodeInfo> => api('/api/settings/batch-code', { method: 'PUT', body: { next } });

export type MarksPreviewPage = 'window' | 'mrdf';
/** The picture of the page with the marks, drawn from the values given (the ones on screen, saved or not). Resolves to a PNG blob. */
export async function getMarksPreview(page: MarksPreviewPage, values: Record<string, SettingValue>): Promise<Blob> {
  const res = await fetch('/api/settings/marks-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page, values }) });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; errors?: Record<string, string> };
    throw new ApiError(data.error ?? (data.errors ? Object.values(data.errors).join(' ') : `Request failed (${res.status})`), res.status, data.errors);
  }
  return res.blob();
}
