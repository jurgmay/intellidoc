/** Every charge a costing model can carry. The codes match the CHECK on idoc.costing_model_rate. */
export const CHARGES = [
  { code: 'HPOD', label: 'H-POD processing' },
  { code: 'PROCESSING', label: 'Processing' },
  { code: 'ADDRESS_MATCHING', label: 'Address matching (per merged pack)' },
  { code: 'PAPER_SHEET', label: 'Paper (per sheet)' },
  { code: 'COLOUR_PAGE', label: 'Colour page' },
  { code: 'MONO_PAGE', label: 'Mono page' },
  { code: 'BLANK_PAGE', label: 'Blank page' },
  { code: 'INSERT', label: 'Insert (each)' },
  { code: 'MACHINE_ENCLOSING_SETUP', label: 'Machine enclosing: setup' },
  { code: 'MACHINE_ENCLOSING_SHEET', label: 'Machine enclosing: each extra sheet' },
  { code: 'HAND_ENCLOSING_SETUP', label: 'Hand enclosing: setup' },
  { code: 'HAND_ENCLOSING_SHEET', label: 'Hand enclosing: each extra sheet' },
  { code: 'BAGGING', label: 'Bagging' },
  { code: 'OVERSTICKERING', label: 'Overstickering' },
  { code: 'ADJUSTMENT', label: 'General adjustment' },
  { code: 'HAND_SMALL_BATCH_ADJUSTMENT', label: 'Small batch adjustment' },
  { code: 'HAND_LETTER_ADJUSTMENT', label: 'Letter format adjustment' },
  { code: 'HAND_LARGE_LETTER_ADJUSTMENT', label: 'Large letter format adjustment' },
] as const;
export type ChargeCode = (typeof CHARGES)[number]['code'];

export interface Rate { cost: number; sellPrice: number; adjustment: number }

/** One costing model, as loaded for pricing. */
export interface CostingModel {
  id: number;
  name: string;
  /** A charge that is missing from the model costs nothing. */
  rates: Map<ChargeCode, Rate>;
  /** Outer envelope price by stock item id. */
  envelopes: Map<number, Rate>;
  /** Adjustment to the suggested sell price of a postage rate, by postal rate id. */
  postageAdjustments: Map<number, number>;
}

/** Everything about a mailpiece that the price depends on. */
export interface PricingInput {
  /** Packs merged into the mailpiece. */
  packs: number;
  colourPages: number; monoPages: number;
  /** Blank pages as printed: blank in the incoming PDF, plus the one the composer adds after a pack with an odd number of pages. */
  blankPages: number;
  /**
   * Sheets the mailpiece prints on: the mailpiece's own sheet count, the one that decided its weight and envelope. Each pack is
   * printed on whole sheets (the composer pads an odd pack with a blank page), and a pack that is not duplex takes a sheet a page, so
   * this is not simply half the pages.
   */
  sheets: number;
  inserts: number;
  enclosing: 'Machine' | 'Hand';
  isOversticker: boolean;
  /** Mailpieces in the batch (small batches carry an adjustment). */
  batchMailpieces: number;
  /** A batch of fewer mailpieces than this is a small batch (the Settings value). */
  smallBatchLimit: number;
  postalFormat: string;
  /** The customer has address matching on. */
  isAddressMatching: boolean;
  envelopeStockItemId: number | null;
  /** The postal rate chosen for the mailpiece: its cost and suggested sell price. Null when no rate fits. */
  postageRate: { id: number; cost: number | null; sellPrice: number | null } | null;
}

export interface PriceLine { code: string; label: string; quantity: number; unitCost: number; unitSell: number; cost: number; sell: number }
export interface Pricing {
  lines: PriceLine[];
  productionCost: number; productionSell: number;
  postageCost: number; postageSell: number;
  totalCost: number; totalSell: number;
  /** Things that stopped part of the price being worked out (no postage rate, no envelope price). The price is then incomplete. */
  warnings: string[];
}
