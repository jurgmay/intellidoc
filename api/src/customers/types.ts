/** How the PDF is composed for print; pricing bills the composed pages. */
export const COLOUR_MODES = ['ORIGINAL', 'FIRST_PACK_PAGE', 'FIRST_MAILPIECE_PAGE', 'ALL_MONO'] as const;
export type ColourMode = (typeof COLOUR_MODES)[number];
export interface CustomerRow {
  id: number; code: string; name: string; misJobNumber: string | null; pendingJobNumber: string | null;
  isAddressMatching: boolean; isUseMrdf: boolean; isSso: boolean; isTesting: boolean; isDeleted: boolean;
  /** The hierarchy parent: where this customer sits in the tree. It keeps its own settings. */
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
/** Where a group of settings comes from: its own rows, its parent's, or the parent's plus its own. */
export const INHERIT_MODES = ['OWN', 'INHERIT', 'EXTEND'] as const;
export type InheritMode = (typeof INHERIT_MODES)[number];
/** The groups that can each take their own choice. matching = address matching on/off, batching key and matching rules; sequence = pack sequence key and rules. */
export const SETTINGS = ['envelopes', 'brands', 'matching', 'sequence', 'emails'] as const;
export type SettingKey = (typeof SETTINGS)[number];
export type Modes = Record<SettingKey, InheritMode>;
export interface InheritedEnvelopeView extends EnvelopeView { from: ParentView }
export interface MatchRule { isInclude: boolean; key: string; value: string | null }
export interface SequenceRule { value: string; number: number }
/** Settings that come from the parent customers, read only here. A nearer entry (this customer's own, or a nearer parent's) that has the same key replaces a further one. */
export interface InheritedSettings {
  brands: { name: string; from: ParentView }[];
  matchRules: (MatchRule & { from: ParentView })[];
  sequenceRules: (SequenceRule & { from: ParentView })[];
  emails: { email: string; from: ParentView }[];
  /** The single values, when this customer takes them from a parent (matching mode INHERIT); otherwise null. */
  matching: { isAddressMatching: boolean; batchingKey: string | null; from: ParentView } | null;
  /** Likewise for the pack sequence key (sequence mode INHERIT). */
  sequence: { key: string | null; from: ParentView } | null;
}

export const FLAGS = ['isAddressMatching', 'isArchiveMailpieces', 'isCreateOutputFiles', 'isSso', 'isSameDayService', 'isUseMrdf', 'isTesting', 'isDeleted'] as const;
export type FlagKey = (typeof FLAGS)[number];

/** Archive tags (written into the PDF keywords) and the inserter logo bitmaps (written into the MRDF). Held by the account that holds the settings. */
export interface ProductionFields {
  archiveCustomerTag: string | null; archiveProviderTag: string | null; archiveDirectoryTag: string | null; logo1: string | null; logo2: string | null;
}

export interface CustomerDetail extends ProductionFields {
  id: number; code: string; name: string; misJobNumber: string | null; returnAddress: string | null; colourMode: ColourMode;
  /** The next job number, and the date (1st of a month, London) on which it replaces the job number. */
  pendingJobNumber: string | null; pendingFrom: string | null;
  /** Day of the month (1-28) on which a pending job number takes over. */
  jobNumberRolloverDay: number;
  flags: Record<FlagKey, boolean>;
  batchingKey: string | null; packSequenceKey: string | null;
  parent: ParentView | null; children: ChildView[];
  /** The account invoiced for this customer's mail and whose job number is printed on run sheets: the customer itself or an ancestor. null = the customer itself. */
  invoicing: ParentView | null;
  /** The accounts that can be chosen: this customer first, then each ancestor up the tree. */
  invoicingOptions: ParentView[];
  accounts: AccountView[]; brands: BrandView[]; envelopes: EnvelopeView[];
  /** Where each group of settings comes from. All OWN when there is no parent. */
  modes: Modes;
  /** Envelope settings that come from the parent customers (read only here), nearest first; one that this customer also has is left out. */
  inheritedEnvelopes: InheritedEnvelopeView[];
  matchRules: MatchRule[]; sequenceRules: SequenceRule[]; emails: string[];
  inherited: InheritedSettings;
}

/** What can be edited on the customer record itself. */
export interface CustomerDetailsInput extends ProductionFields {
  code: string; name: string; misJobNumber: string | null; pendingJobNumber: string | null; jobNumberRolloverDay: number; returnAddress: string | null; colourMode: ColourMode;
  flags: Record<FlagKey, boolean>; batchingKey: string | null; packSequenceKey: string | null;
  /** null = top of its hierarchy. Must be another customer, and never itself or one of its own descendants. */
  parentId: number | null;
  /** null = the customer itself. Otherwise must be the customer or one of its ancestors. */
  invoicingAccountId: number | null;
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
  setMode(customerId: number, setting: SettingKey, mode: InheritMode, by: string): Promise<void>;
  /** The customer stops holding its own settings and takes everything from its parent, like any other sub-account. Its own settings are kept, but not used. */
  makeSubAccount(customerId: number, by: string): Promise<void>;
  /** The reverse: a sub-account holds its own settings again, as a customer. */
  makeCustomer(accountId: number, by: string): Promise<void>;
  setMatchRules(customerId: number, rules: MatchRule[], by: string): Promise<void>;
  setSequenceRules(customerId: number, rules: SequenceRule[], by: string): Promise<void>;
  setEmails(customerId: number, emails: string[], by: string): Promise<void>;
  history(customerId: number, limit: number): Promise<AuditEntry[]>;
  /** Moves every pending job number that is due into the job number. Returns how many moved. */
  applyDuePending(): Promise<number>;
}
