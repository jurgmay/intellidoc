import type { ImportPlan } from './importPlan.js';
export interface FormatRef { id: number; name: string }
export type RateStatus = 'current' | 'planned' | 'ended';
export interface RateView {
  id: number; minWeightG: number; maxWeightG: number; validFrom: string; validTo: string | null; cost: number | null; sellPrice: number | null;
  /** Envelope settings, priced mailpieces and customer adjustments that use this row. A row that is used cannot be deleted or have its weights changed. */
  usedBy: number;
  status: RateStatus;
}
export interface ServiceView {
  id: number; name: string; formatId: number; formatName: string; serviceCode: string | null; isSignedFor: boolean; isTracked: boolean; isRecorded: boolean; rates: RateView[];
}
export interface ProviderView { id: number; name: string; services: ServiceView[] }
export interface PostalOverview { today: string; formats: FormatRef[]; providers: ProviderView[] }
export interface HistoryEntry { id: number; changedAt: string; changedBy: string; summary: string }

export interface ServiceInput { formatId: number; name: string; serviceCode: string | null; isSignedFor: boolean; isTracked: boolean; isRecorded: boolean }
export interface RateInput { minWeightG: number; maxWeightG: number; validFrom: string; validTo: string | null; cost: number | null; sellPrice: number | null }
export interface PriceChangeInput { effectiveFrom: string; changes: { rateId: number; cost: number | null; sellPrice: number | null }[] }

export interface ImportResult { newProviders: number; newServices: number; newBands: number; changedBands: number; updatedBands: number; unchangedBands: number }

export interface PostalStore {
  overview(): Promise<PostalOverview>;
  createProvider(name: string, by: string): Promise<number>;
  updateProvider(id: number, name: string, by: string): Promise<void>;
  deleteProvider(id: number, by: string): Promise<void>;
  createService(providerId: number, input: ServiceInput, by: string): Promise<number>;
  updateService(id: number, input: ServiceInput, by: string): Promise<void>;
  deleteService(id: number, by: string): Promise<void>;
  createRate(serviceId: number, input: RateInput, by: string): Promise<number>;
  updateRate(id: number, input: RateInput, by: string): Promise<void>;
  deleteRate(id: number, by: string): Promise<void>;
  /** The old row of each band ends the day before, and a new row starts on the day with the new prices. Returns how many bands changed. */
  priceChange(serviceId: number, input: PriceChangeInput, by: string): Promise<number>;
  /** Applies a plan from planImport in one transaction: adds the providers, services and prices it lists, ending the old row of changed bands the day before. The plan must be importable. */
  applyImport(plan: ImportPlan, by: string, fileName: string): Promise<ImportResult>;
  history(limit: number): Promise<HistoryEntry[]>;
}
