import { api, ApiError } from './client';
import { signInAgain } from './signIn';

export type RateStatus = 'current' | 'planned' | 'ended';
export interface PostalRate { id: number; minWeightG: number; maxWeightG: number; validFrom: string; validTo: string | null; cost: number | null; sellPrice: number | null; usedBy: number; status: RateStatus }
export interface PostalService { id: number; name: string; formatId: number; formatName: string; serviceCode: string | null; isSignedFor: boolean; isTracked: boolean; isRecorded: boolean; rates: PostalRate[] }
export interface PostalProvider { id: number; name: string; services: PostalService[] }
export interface PostalOverview { today: string; formats: { id: number; name: string }[]; providers: PostalProvider[] }
export interface ServiceInput { formatId: number; name: string; serviceCode: string | null; isSignedFor: boolean; isTracked: boolean; isRecorded: boolean }
export interface RateInput { minWeightG: number; maxWeightG: number; validFrom: string; validTo: string | null; cost: number | null; sellPrice: number | null }
export interface PriceChangeInput { effectiveFrom: string; changes: { rateId: number; cost: number | null; sellPrice: number | null }[] }
export interface PostalHistoryRow { id: number; changedAt: string; changedBy: string; summary: string }

export const getPostal = () => api<PostalOverview>('/api/postal');
export const getPostalHistory = () => api<{ rows: PostalHistoryRow[] }>('/api/postal/history');
export const createProvider = (name: string) => api<{ id: number }>('/api/postal/providers', { method: 'POST', body: { name } });
export const renameProvider = (id: number, name: string) => api<unknown>(`/api/postal/providers/${id}`, { method: 'PUT', body: { name } });
export const deleteProvider = (id: number) => api<unknown>(`/api/postal/providers/${id}`, { method: 'DELETE' });
export const createService = (providerId: number, body: ServiceInput) => api<{ id: number }>(`/api/postal/providers/${providerId}/services`, { method: 'POST', body });
export const saveService = (id: number, body: ServiceInput) => api<unknown>(`/api/postal/services/${id}`, { method: 'PUT', body });
export const deleteService = (id: number) => api<unknown>(`/api/postal/services/${id}`, { method: 'DELETE' });
export const createRate = (serviceId: number, body: RateInput) => api<{ id: number }>(`/api/postal/services/${serviceId}/rates`, { method: 'POST', body });
export const saveRate = (id: number, body: RateInput) => api<unknown>(`/api/postal/rates/${id}`, { method: 'PUT', body });
export const deleteRate = (id: number) => api<unknown>(`/api/postal/rates/${id}`, { method: 'DELETE' });
export const changePrices = (serviceId: number, body: PriceChangeInput) => api<{ changed: number }>(`/api/postal/services/${serviceId}/price-change`, { method: 'POST', body });

export type BandAction = 'new' | 'change' | 'update' | 'unchanged' | 'blocked';
export interface ImportIssue { row: number | null; message: string }
export interface ImportBand {
  key: string; provider: string; service: string; format: string; minWeightG: number; maxWeightG: number; cost: number | null; sellPrice: number | null; action: BandAction; row: number;
  before: { rateId: number; cost: number | null; sellPrice: number | null; validFrom: string; validTo: string | null } | null; message: string | null;
}
export interface ImportService { key: string; provider: string; name: string; format: string; isNew: boolean }
export interface ImportCounts { newProviders: number; newServices: number; newBands: number; changedBands: number; updatedBands: number; unchangedBands: number; blockedBands: number; skippedRows: number }
export interface ImportPlan { startDate: string; endDate: string | null; fileRows: number; newProviders: string[]; services: ImportService[]; bands: ImportBand[]; errors: ImportIssue[]; warnings: ImportIssue[]; counts: ImportCounts; canImport: boolean }
export interface ImportResult { newProviders: number; newServices: number; newBands: number; changedBands: number; updatedBands: number; unchangedBands: number }

/** Sends a price list (.xlsx or .csv) to be checked, or with apply = true, imported. The file is the raw request body. */
export async function importPostal(file: File, startDate: string, endDate: string | null, apply: boolean): Promise<{ plan: ImportPlan; result: ImportResult | null }> {
  const q = new URLSearchParams({ start: startDate, apply: apply ? '1' : '0', name: file.name });
  if (endDate) q.set('end', endDate);
  const res = await fetch(`/api/postal/import?${q}`, { method: 'POST', headers: { 'Content-Type': /\.csv$/i.test(file.name) ? 'text/csv' : 'application/octet-stream' }, body: file });
  if (res.status === 401) { signInAgain(); throw new ApiError('Your sign-in has ended. Signing in again…', 401); }
  const text = await res.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    const fieldErrors = data['errors'] as Record<string, string> | undefined;
    throw new ApiError((data['error'] as string | undefined) ?? (fieldErrors ? Object.values(fieldErrors).join(' ') : `Request failed (${res.status})`), res.status, fieldErrors);
  }
  return data as unknown as { plan: ImportPlan; result: ImportResult | null };
}

export interface EndPlan { lastDay: string; rows: { rateId: number }[]; services: number; startingLater: number }
/** Without apply, says how many prices would get this last day. With apply, sets it. */
export const endAllPrices = (lastDay: string, apply: boolean) => api<{ plan: EndPlan; ended: number | null }>('/api/postal/end-prices', { method: 'POST', body: { lastDay, apply } });
