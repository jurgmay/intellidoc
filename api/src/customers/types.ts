export interface CustomerRow {
  id: number; code: string; name: string; misJobNumber: string | null; pendingJobNumber: string | null;
  isAddressMatching: boolean; isTesting: boolean; isDeleted: boolean;
  /** The hierarchy parent (not the same as the grouping account that holds the settings). */
  parentId: number | null; parentCode: string | null;
  accountCount: number; brandCount: number; envelopeCount: number;
}
export interface ParentView { id: number; code: string; name: string }
export interface ChildView { id: number; code: string; name: string; isDeleted: boolean }
export interface AccountView { id: number; code: string; name: string; isDeleted: boolean }
export interface BrandView { id: number; name: string; /** envelopes + stock items + mailpieces that use it */ usage: number }
export interface EnvelopeView {
  id: number; brandId: number | null; brandName: string | null; deliveryBand: string; postalRateId: number; rateLabel: string;
  stockItemId: number; stockCode: string | null; stockDescription: string; reference: string | null; externalName: string | null; isOversticker: boolean;
}
export interface MatchRule { isInclude: boolean; key: string; value: string | null }
export interface SequenceRule { value: string; number: number }

export const FLAGS = ['isAddressMatching', 'isArchiveMailpieces', 'isCreateOutputFiles', 'isSso', 'isSameDayService', 'isUseMrdf', 'isTesting', 'isDeleted'] as const;
export type FlagKey = (typeof FLAGS)[number];

export interface CustomerDetail {
  id: number; code: string; name: string; misJobNumber: string | null; returnAddress: string | null; colourMode: number | null;
  /** The next job number, and the date (1st of a month, London) on which it replaces the job number. */
  pendingJobNumber: string | null; pendingFrom: string | null;
  /** Day of the month (1-28) on which a pending job number takes over. */
  jobNumberRolloverDay: number;
  flags: Record<FlagKey, boolean>;
  batchingKey: string | null; packSequenceKey: string | null;
  parent: ParentView | null; children: ChildView[];
  accounts: AccountView[]; brands: BrandView[]; envelopes: EnvelopeView[];
  matchRules: MatchRule[]; sequenceRules: SequenceRule[]; emails: string[];
}

/** What can be edited on the customer record itself. */
export interface CustomerDetailsInput {
  code: string; name: string; misJobNumber: string | null; pendingJobNumber: string | null; jobNumberRolloverDay: number; returnAddress: string | null;
  flags: Record<FlagKey, boolean>; batchingKey: string | null; packSequenceKey: string | null;
  /** null = top of its hierarchy. Must be another customer, and never itself or one of its own descendants. */
  parentId: number | null;
}
export interface EnvelopeInput {
  brandId: number | null; deliveryBand: string; postalRateId: number; stockItemId: number; reference: string | null; externalName: string | null; isOversticker: boolean;
}

export interface Lookups {
  passthroughKeys: string[];
  customers: { id: number; code: string; name: string }[];
  deliveryBands: string[];
  postalRates: { id: number; label: string; format: string }[];
  envelopeStock: { id: number; code: string | null; description: string; size: string | null }[];
}
export interface AuditEntry { id: number; changedAt: string; changedBy: string; summary: string }

export interface CustomerStore {
  list(search: string, includeDeleted: boolean): Promise<CustomerRow[]>;
  get(id: number): Promise<CustomerDetail>;
  lookups(): Promise<Lookups>;
  create(input: { code: string; name: string }, by: string): Promise<number>;
  updateDetails(id: number, input: CustomerDetailsInput, by: string): Promise<void>;
  addAccount(customerId: number, input: { code: string; name: string }, by: string): Promise<number>;
  updateAccount(accountId: number, input: { code: string; name: string; isDeleted: boolean }, by: string): Promise<void>;
  addBrand(customerId: number, name: string, by: string): Promise<number>;
  renameBrand(brandId: number, name: string, by: string): Promise<void>;
  deleteBrand(brandId: number, by: string): Promise<void>;
  addEnvelope(customerId: number, input: EnvelopeInput, by: string): Promise<number>;
  updateEnvelope(envelopeId: number, input: EnvelopeInput, by: string): Promise<void>;
  deleteEnvelope(envelopeId: number, by: string): Promise<void>;
  setMatchRules(customerId: number, rules: MatchRule[], by: string): Promise<void>;
  setSequenceRules(customerId: number, rules: SequenceRule[], by: string): Promise<void>;
  setEmails(customerId: number, emails: string[], by: string): Promise<void>;
  history(customerId: number, limit: number): Promise<AuditEntry[]>;
  /** Moves every pending job number that is due into the job number. Returns how many moved. */
  applyDuePending(): Promise<number>;
}
