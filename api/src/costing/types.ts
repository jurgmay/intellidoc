/** Every charge a costing model can carry, in the order they are shown. The codes match the CHECK on idoc.costing_model_rate. */
export const CHARGES = [
  { code: 'HPOD', label: 'H-POD processing', group: 'Print' },
  { code: 'PROCESSING', label: 'Processing', group: 'Print' },
  { code: 'ADDRESS_MATCHING', label: 'Address matching (per merged pack)', group: 'Print' },
  { code: 'PAPER_SHEET', label: 'Paper (per sheet)', group: 'Print' },
  { code: 'COLOUR_PAGE', label: 'Colour page', group: 'Print' },
  { code: 'MONO_PAGE', label: 'Mono page', group: 'Print' },
  { code: 'BLANK_PAGE', label: 'Blank page', group: 'Print' },
  { code: 'INSERT', label: 'Insert (each)', group: 'Enclosing and inserts' },
  { code: 'MACHINE_ENCLOSING_SETUP', label: 'Machine enclosing: setup', group: 'Enclosing and inserts' },
  { code: 'MACHINE_ENCLOSING_SHEET', label: 'Machine enclosing: each extra sheet', group: 'Enclosing and inserts' },
  { code: 'HAND_ENCLOSING_SETUP', label: 'Hand enclosing: setup', group: 'Enclosing and inserts' },
  { code: 'HAND_ENCLOSING_SHEET', label: 'Hand enclosing: each extra sheet', group: 'Enclosing and inserts' },
  { code: 'BAGGING', label: 'Bagging', group: 'Enclosing and inserts' },
  { code: 'OVERSTICKERING', label: 'Overstickering', group: 'Enclosing and inserts' },
  { code: 'ADJUSTMENT', label: 'General adjustment (sell price only)', group: 'Adjustments' },
  { code: 'HAND_SMALL_BATCH_ADJUSTMENT', label: 'Small batch adjustment (sell price only)', group: 'Adjustments' },
  { code: 'HAND_LETTER_ADJUSTMENT', label: 'Letter format adjustment (sell price only)', group: 'Adjustments' },
  { code: 'HAND_LARGE_LETTER_ADJUSTMENT', label: 'Large letter format adjustment (sell price only)', group: 'Adjustments' },
] as const;
export type ChargeCode = (typeof CHARGES)[number]['code'];
export const CHARGE_CODES: readonly string[] = CHARGES.map((c) => c.code);

export type CostingMode = 'OWN' | 'INHERIT';
export interface AccountRef { id: number; code: string; name: string }
export interface ModelSummary {
  id: number; name: string; validFrom: string; validTo: string | null; isActive: boolean;
  /** Mailpieces that have been priced with it. */
  mailpieceCount: number;
}
export interface CostingOverview {
  customerId: number;
  /** The customer's own choice: its own price lists, or the nearest parent's. */
  mode: CostingMode;
  /** The sub-account takes all its settings from its parent, so the mode cannot be chosen. */
  inheritsAll: boolean;
  /** Where the prices come from when they are not this customer's own; otherwise null. */
  source: AccountRef | null;
  models: ModelSummary[];
  /** The source's models, read only, when the prices are inherited. */
  sourceModels: ModelSummary[];
  /** The model that prices today's mail, if there is one. */
  inForceId: number | null;
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
export interface CostingLookups {
  envelopeStock: { id: number; code: string | null; description: string; size: string | null }[];
}

export interface CostingStore {
  overview(customerId: number): Promise<CostingOverview>;
  setMode(customerId: number, mode: CostingMode, by: string): Promise<void>;
  model(id: number): Promise<ModelDetail>;
  create(customerId: number, input: NewModelInput, by: string): Promise<number>;
  update(id: number, input: ModelInput, by: string): Promise<void>;
  /** Only a model that has never priced a mailpiece can be deleted; others are switched off instead. */
  remove(id: number, by: string): Promise<void>;
  lookups(): Promise<CostingLookups>;
}
