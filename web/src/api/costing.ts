import { api } from './client';

export type ChargeCode = string;
export type CostingMode = 'OWN' | 'INHERIT';
export interface AccountRef { id: number; code: string; name: string }
export interface ModelSummary { id: number; name: string; validFrom: string; validTo: string | null; isActive: boolean; mailpieceCount: number }
export interface CostingOverview {
  customerId: number; mode: CostingMode; inheritsAll: boolean; source: AccountRef | null;
  models: ModelSummary[]; sourceModels: ModelSummary[]; inForceId: number | null;
}
export interface ChargeValue { code: ChargeCode; label: string; group: string; cost: number; sellPrice: number; adjustment: number }
export interface EnvelopePrice { stockItemId: number; stockCode: string | null; description: string; size: string | null; cost: number; sellPrice: number; adjustment: number }
export interface PostagePrice { postalRateId: number; label: string; format: string; suggestedCost: number | null; suggestedSell: number | null; adjustment: number }
export interface ModelDetail extends ModelSummary {
  customerId: number; comments: string | null; copiedFrom: { id: number; name: string } | null;
  charges: ChargeValue[]; envelopes: EnvelopePrice[]; postage: PostagePrice[];
}
export interface ModelInput {
  name: string; validFrom: string; validTo: string | null; isActive: boolean; comments: string | null;
  charges: { code: ChargeCode; cost: number; sellPrice: number; adjustment: number }[];
  envelopes: { stockItemId: number; cost: number; sellPrice: number; adjustment: number }[];
  postage: { postalRateId: number; adjustment: number }[];
}
export interface NewModelInput { name: string; validFrom: string; validTo: string | null; isActive: boolean; copyFromId: number | null }
export interface CostingLookups { envelopeStock: { id: number; code: string | null; description: string; size: string | null }[] }

export const getCosting = (customerId: number) => api<CostingOverview>(`/api/customers/${customerId}/costing`);
export const setCostingMode = (customerId: number, mode: CostingMode) => api<CostingOverview>(`/api/customers/${customerId}/costing-mode`, { method: 'PUT', body: { mode } });
export const createModel = (customerId: number, body: NewModelInput) => api<{ id: number }>(`/api/customers/${customerId}/costing-models`, { method: 'POST', body });
export const getModel = (id: number) => api<ModelDetail>(`/api/costing-models/${id}`);
export const saveModel = (id: number, body: ModelInput) => api<ModelDetail>(`/api/costing-models/${id}`, { method: 'PUT', body });
export const deleteModel = (id: number) => api<unknown>(`/api/costing-models/${id}`, { method: 'DELETE' });
export const getCostingLookups = () => api<CostingLookups>('/api/costing/lookups');
