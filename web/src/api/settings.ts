import { api } from './client';

export type SettingValue = number | boolean | string;
export interface SettingView {
  key: string; group: string; label: string; type: 'number' | 'integer' | 'boolean' | 'select' | 'emails';
  unit?: string; min?: number; max?: number; step?: number;
  description: string; usedBy: string; appliesTo: string;
  value: SettingValue; options?: string[];
}
export interface BatchCodeInfo { highestUsed: number | null; next: number }
export interface SettingsPayload { groups: string[]; settings: SettingView[]; batchCode: BatchCodeInfo }
export interface AuditRow { id: number; changedAt: string; changedBy: string; setting: string; oldValue: string | null; newValue: string | null }

export const getSettings = (): Promise<SettingsPayload> => api('/api/settings');
export const saveSettings = (values: Record<string, SettingValue>): Promise<SettingsPayload & { changed: number }> => api('/api/settings', { method: 'PUT', body: { values } });
export const getAudit = (): Promise<{ rows: AuditRow[] }> => api('/api/settings/audit?limit=100');
export const setNextBatchCode = (next: number): Promise<BatchCodeInfo> => api('/api/settings/batch-code', { method: 'PUT', body: { next } });
