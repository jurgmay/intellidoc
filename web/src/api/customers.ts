import { api } from './client';

export const FLAGS = ['isAddressMatching', 'isArchiveMailpieces', 'isCreateOutputFiles', 'isSso', 'isSameDayService', 'isUseMrdf', 'isTesting', 'isDeleted'] as const;
export type FlagKey = (typeof FLAGS)[number];

export interface CustomerRow {
  id: number; code: string; name: string; misJobNumber: string | null; pendingJobNumber: string | null; isAddressMatching: boolean; isTesting: boolean; isDeleted: boolean;
  parentId: number | null; parentCode: string | null;
  accountCount: number; brandCount: number; envelopeCount: number;
}
/** Where a group of settings comes from: its own, the parent's, or the parent's plus its own. */
export type InheritMode = 'OWN' | 'INHERIT' | 'EXTEND';
export type SettingKey = 'envelopes' | 'brands' | 'matching' | 'sequence' | 'emails';
export type Modes = Record<SettingKey, InheritMode>;
export interface ParentView { id: number; code: string; name: string }
export interface ChildView { id: number; code: string; name: string; isDeleted: boolean }
export interface AccountView { id: number; code: string; name: string; isDeleted: boolean }
export interface BrandView { id: number; name: string; usage: number }
export interface EnvelopeView {
  id: number; brandId: number | null; brandName: string | null; deliveryBand: string; postalRateId: number; rateLabel: string;
  stockItemId: number; stockCode: string | null; stockDescription: string; reference: string | null; externalName: string | null; isOversticker: boolean;
}
export interface InheritedEnvelopeView extends EnvelopeView { from: ParentView }
export interface MatchRule { isInclude: boolean; key: string; value: string | null }
export interface SequenceRule { value: string; number: number }
/** Settings that come from the parents, read only here. */
export interface InheritedSettings {
  brands: { name: string; from: ParentView }[];
  matchRules: (MatchRule & { from: ParentView })[];
  sequenceRules: (SequenceRule & { from: ParentView })[];
  emails: { email: string; from: ParentView }[];
  /** Set when the matching group is taken from the parent (address matching on/off and batching key). */
  matching: { isAddressMatching: boolean; batchingKey: string | null; from: ParentView } | null;
  /** Set when the pack sequence group is taken from the parent. */
  sequence: { key: string | null; from: ParentView } | null;
}
/** How the PDF is composed for print; pricing bills the composed pages. */
export type ColourMode = 'ORIGINAL' | 'FIRST_PACK_PAGE' | 'FIRST_MAILPIECE_PAGE' | 'ALL_MONO';
export const COLOUR_MODE_LABELS: Record<ColourMode, string> = {
  ORIGINAL: 'No change (print as in the PDF)', FIRST_PACK_PAGE: 'First page of each pack in colour, the rest mono',
  FIRST_MAILPIECE_PAGE: 'First page of each mailpiece in colour, the rest mono', ALL_MONO: 'All mono',
};
export interface CustomerDetail {
  id: number; code: string; name: string; misJobNumber: string | null; pendingJobNumber: string | null; pendingFrom: string | null; jobNumberRolloverDay: number; returnAddress: string | null; colourMode: ColourMode;
  flags: Record<FlagKey, boolean>; batchingKey: string | null; packSequenceKey: string | null;
  parent: ParentView | null; children: ChildView[];
  /** null = the customer itself. */
  invoicing: ParentView | null; invoicingOptions: ParentView[];
  accounts: AccountView[]; brands: BrandView[]; envelopes: EnvelopeView[]; modes: Modes; inheritedEnvelopes: InheritedEnvelopeView[]; matchRules: MatchRule[]; sequenceRules: SequenceRule[]; emails: string[]; inherited: InheritedSettings;
}
export type DetailsInput = Pick<CustomerDetail, 'code' | 'name' | 'misJobNumber' | 'pendingJobNumber' | 'jobNumberRolloverDay' | 'returnAddress' | 'colourMode' | 'flags' | 'batchingKey' | 'packSequenceKey'> & { parentId: number | null; invoicingAccountId: number | null };
export interface EnvelopeInput {
  brandId: number | null; deliveryBand: string; postalRateId: number; stockItemId: number; reference: string | null; externalName: string | null; isOversticker: boolean;
}
export interface Lookups {
  passthroughKeys: string[]; customers: { id: number; code: string; name: string }[]; deliveryBands: string[]; flagLabels: Record<FlagKey, string>;
  postalRates: { id: number; label: string; format: string }[];
  envelopeStock: { id: number; code: string | null; description: string; size: string | null }[];
}
export interface HistoryRow { id: number; changedAt: string; changedBy: string; summary: string }

export const listCustomers = (search: string, deleted: boolean): Promise<{ rows: CustomerRow[] }> =>
  api(`/api/customers?search=${encodeURIComponent(search)}${deleted ? '&deleted=1' : ''}`);
export const getLookups = (): Promise<Lookups> => api('/api/customers/lookups');
export const getCustomer = (id: number): Promise<CustomerDetail> => api(`/api/customers/${id}`);
export const createCustomer = (code: string, name: string): Promise<{ id: number }> => api('/api/customers', { method: 'POST', body: { code, name } });
export const saveDetails = (id: number, body: DetailsInput): Promise<CustomerDetail> => api(`/api/customers/${id}`, { method: 'PUT', body });
export const getHistory = (id: number): Promise<{ rows: HistoryRow[] }> => api(`/api/customers/${id}/history?limit=100`);

export const addAccount = (id: number, code: string, name: string) => api(`/api/customers/${id}/accounts`, { method: 'POST', body: { code, name } });
export const updateAccount = (id: number, code: string, name: string, isDeleted: boolean) => api(`/api/accounts/${id}`, { method: 'PUT', body: { code, name, isDeleted } });
export const makeSubAccount = (id: number) => api(`/api/customers/${id}/make-sub-account`, { method: 'POST' });
export const makeCustomer = (accountId: number) => api(`/api/accounts/${accountId}/make-customer`, { method: 'POST' });
export const addBrand = (id: number, name: string) => api(`/api/customers/${id}/brands`, { method: 'POST', body: { name } });
export const renameBrand = (id: number, name: string) => api(`/api/brands/${id}`, { method: 'PUT', body: { name } });
export const deleteBrand = (id: number) => api(`/api/brands/${id}`, { method: 'DELETE' });
export const addEnvelope = (id: number, body: EnvelopeInput) => api(`/api/customers/${id}/envelopes`, { method: 'POST', body });
export const updateEnvelope = (id: number, body: EnvelopeInput) => api(`/api/envelopes/${id}`, { method: 'PUT', body });
export const setInheritance = (id: number, setting: SettingKey, mode: InheritMode) => api(`/api/customers/${id}/inheritance`, { method: 'PUT', body: { setting, mode } });
export const deleteEnvelope = (id: number) => api(`/api/envelopes/${id}`, { method: 'DELETE' });
export const saveMatchRules = (id: number, rules: MatchRule[]) => api(`/api/customers/${id}/match-rules`, { method: 'PUT', body: { rules } });
export const saveSequenceRules = (id: number, rules: SequenceRule[]) => api(`/api/customers/${id}/sequence-rules`, { method: 'PUT', body: { rules } });
export const saveEmails = (id: number, emails: string[]) => api(`/api/customers/${id}/emails`, { method: 'PUT', body: { emails } });
