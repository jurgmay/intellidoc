/** Reference/configuration data the ingest needs. In production this is read from the idoc.* tables. */
export interface Settings {
  a4SheetWeightG: number;
  a4SheetThicknessMm: number;
  machineEnclosingMinMailpieces: number; // machine only if count is MORE than this
  machineEnclosingMaxSheets: number;
  machineEnclosingEnvelopeSize: string;
  handEnclosingMaxSheets: number;
}

export interface PostalFormat { name: string; rank: number; maxWeightG: number; maxThicknessMm: number | null; maxSheets: number | null }

export interface StockItem {
  code: string;
  weightG: number;
  thicknessMm: number;
  /** Linked stock: child items that are always added with this one (insert-side only). */
  linked?: string[];
}

export interface EnvelopeOption {
  brand: string | null;
  /** Text after "ref: " in the envelope description; '' when none. */
  reference: string;
  postalFormat: string;
  size: string; // C5 | C4
  stockCode: string;
}

export interface AccountConfig {
  code: string;
  brands: string[];
  /** Passthrough key whose value is part of batch identity (e.g. Property). null = none. */
  batchingKey: string | null;
  /** When false, no pack of this account is ever merged. */
  matchingEnabled: boolean;
  /** Passthrough keys included in the match (value must be equal to merge). */
  matchIncludeKeys: string[];
  /** Pack is excluded from matching when passthrough[key] === value. */
  matchExclude: { key: string; value: string }[];
  envelopes: EnvelopeOption[];
}

export interface ReferenceData {
  settings: Settings;
  postalFormats: PostalFormat[];
  stock: Map<string, StockItem>;
  accounts: Map<string, AccountConfig>;
  anonymousAddressees: Set<string>;
  /** paper description -> batch name */
  paperBatchNames: Map<string, string>;
}

export const DEFAULT_ANONYMOUS = ['THEOCCUPIER', 'THERESIDENT', 'THEOWNER', 'THEHOMEOWNER', 'THEHOUSEHOLDER', 'THETENANT'];
