import { api } from './client';

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
