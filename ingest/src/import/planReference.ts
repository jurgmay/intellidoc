import { DEFAULT_ANONYMOUS, type AccountConfig, type EnvelopeOption, type ReferenceData } from '../reference.js';
import type { Plan } from './plan.js';

/**
 * Builds the ingest's reference data straight from an import plan (no database), so a real XML/PDF pair can be
 * tried against the real configuration before anything is loaded. Stock without a code gets a placeholder "ID-<id>".
 */
export function referenceFromPlan(plan: Plan): ReferenceData {
  const codeOf = new Map(plan.stock.map((s) => [s.legacyId, s.code ?? `ID-${s.legacyId.slice(0, 8)}`]));
  const stock = new Map<string, { code: string; weightG: number; thicknessMm: number; linked?: string[] }>();
  for (const s of plan.stock) stock.set(codeOf.get(s.legacyId)!, { code: codeOf.get(s.legacyId)!, weightG: s.weightG, thicknessMm: s.thicknessMm });
  for (const s of plan.stock) if (s.parentLegacyId) { const p = stock.get(codeOf.get(s.parentLegacyId)!); if (p) (p.linked ??= []).push(codeOf.get(s.legacyId)!); }
  const sizeOf = new Map(plan.stock.map((s) => [s.legacyId, s.sizeCode ?? '']));
  const brandName = new Map(plan.brands.map((b) => [b.legacyId, b.name]));
  const byCustomer = new Map<string, EnvelopeOption[]>();
  for (const e of plan.envelopes) {
    const list = byCustomer.get(e.customerLegacyId) ?? [];
    list.push({ brand: e.brandLegacyId ? brandName.get(e.brandLegacyId) ?? null : null, reference: e.reference ?? '', postalFormat: e.rate.format,
      size: sizeOf.get(e.stockLegacyId) ?? '', stockCode: codeOf.get(e.stockLegacyId)!, deliveryBand: e.deliveryBand, minWeightG: 0, maxWeightG: e.rate.maxG });
    byCustomer.set(e.customerLegacyId, list);
  }
  const accById = new Map(plan.accounts.map((a) => [a.legacyId, a]));
  const accounts = new Map<string, AccountConfig>();
  for (const a of plan.accounts) {
    const cust = accById.get(a.groupingLegacyId ?? a.legacyId) ?? a;
    accounts.set(a.code, {
      code: a.code, customerCode: cust.code, brands: plan.brands.filter((b) => b.customerLegacyId === cust.legacyId).map((b) => b.name),
      batchingKey: cust.batchingKey, matchingEnabled: cust.isAddressMatching,
      matchIncludeKeys: cust.matchRules.filter((r) => r.isInclude).map((r) => r.key),
      matchExclude: cust.matchRules.filter((r) => !r.isInclude).map((r) => ({ key: r.key, value: r.value ?? '' })),
      packSequence: cust.packSequenceKey && cust.sequenceRules.length ? { key: cust.packSequenceKey, rules: new Map(cust.sequenceRules.map((r) => [r.value, r.sequence])) } : undefined,
      envelopes: byCustomer.get(cust.legacyId) ?? [],
    });
  }
  return {
    settings: { a4SheetWeightG: 5.625, a4SheetThicknessMm: 0.1, machineEnclosingMinMailpieces: 25, machineEnclosingMaxSheets: 12, machineEnclosingEnvelopeSize: 'C5', handEnclosingMaxSheets: 125 },
    postalFormats: [
      { name: 'Letter', rank: 1, maxWeightG: 100, maxThicknessMm: 5, maxSheets: 16 },
      { name: 'Large Letter', rank: 2, maxWeightG: 750, maxThicknessMm: 25, maxSheets: 125 },
      { name: 'Small Parcel', rank: 3, maxWeightG: 2000, maxThicknessMm: null, maxSheets: null },
      { name: 'Medium Parcel', rank: 4, maxWeightG: 20000, maxThicknessMm: null, maxSheets: null },
    ],
    stock, accounts, anonymousAddressees: new Set(DEFAULT_ANONYMOUS), paperBatchNames: new Map(),
  };
}
