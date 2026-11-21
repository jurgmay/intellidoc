import { DEFAULT_ANONYMOUS, type AccountConfig, type EnvelopeOption, type ReferenceData } from './reference.js';

/**
 * TEST DATA ONLY - not real configuration.
 * ILLUSTRATIVE reference data for the dry-run and tests. Stock weights/thicknesses, C4 envelope codes
 * (prefixed C4-) and postal format limits are placeholders to be replaced by the real idoc.* data.
 */
export function fixtureReference(): ReferenceData {
  const stock = new Map<string, { code: string; weightG: number; thicknessMm: number; linked?: string[] }>();
  const add = (code: string, weightG: number, thicknessMm: number, linked?: string[]): void => { stock.set(code, { code, weightG, thicknessMm, linked }); };
  for (const c of ['WH21518', 'WH21519', 'WH06113', 'WH20066']) add(c, 8, 0.2); // C5 envelopes (8 g)
  for (const c of ['C4-REMUS', 'C4-CRABTREE', 'C4-PEGASUS', 'C4-LAMBY']) add(c, 17, 0.3); // C4 envelopes (17 g, placeholder codes)
  add('WH22911', 6, 0.15); // National Grid insert
  add('INSERT-HEAVY', 120, 2); // test-only
  add('INSERT-PARENT', 5, 0.1, ['INSERT-CHILD']); add('INSERT-CHILD', 4, 0.1);

  const env = (brand: string, reference: string, c5: string, c4: string): EnvelopeOption[] => [
    { brand, reference, postalFormat: 'Letter', size: 'C5', stockCode: c5 },
    { brand, reference, postalFormat: 'Large Letter', size: 'C4', stockCode: c4 },
    { brand, reference, postalFormat: 'Small Parcel', size: 'C4', stockCode: c4 },
    { brand, reference, postalFormat: 'Medium Parcel', size: 'C4', stockCode: c4 },
  ];
  const fexco: AccountConfig = {
    code: 'FEXCO', customerCode: 'FEXCO', invoicingCode: 'FEXCO', brands: ['Remus', 'Crabtree'], batchingKey: null, matchingEnabled: true, matchIncludeKeys: [], matchExclude: [],
    envelopes: [...env('Remus', 'Remus', 'WH21518', 'C4-REMUS'), ...env('Crabtree', 'Crabtree', 'WH21519', 'C4-CRABTREE')],
  };
  const ng: AccountConfig = {
    code: 'NATIONAL_GRID_PSR', customerCode: 'NATIONAL_GRID_PSR', invoicingCode: 'NATIONAL_GRID_PSR', brands: ['Pegasus', 'Lamby'], batchingKey: null, matchingEnabled: true, matchIncludeKeys: [], matchExclude: [],
    envelopes: [...env('Pegasus', 'Pegasus', 'WH06113', 'C4-PEGASUS'), ...env('Lamby', 'Lamby', 'WH20066', 'C4-LAMBY')],
  };
  return {
    settings: {
      a4SheetWeightG: 5.625, a4SheetThicknessMm: 0.1, machineEnclosingMinMailpieces: 25,
      machineEnclosingMaxSheets: 12, machineEnclosingEnvelopeSize: 'C5', handEnclosingMaxSheets: 125,
    },
    postalFormats: [
      { name: 'Letter', rank: 1, maxWeightG: 100, maxThicknessMm: 5, maxSheets: 16 },
      { name: 'Large Letter', rank: 2, maxWeightG: 750, maxThicknessMm: 25, maxSheets: 125 },
      { name: 'Small Parcel', rank: 3, maxWeightG: 2000, maxThicknessMm: null, maxSheets: null },
      { name: 'Medium Parcel', rank: 4, maxWeightG: 20000, maxThicknessMm: null, maxSheets: null },
    ],
    stock,
    accounts: new Map([[fexco.code, fexco], [ng.code, ng]]),
    anonymousAddressees: new Set(DEFAULT_ANONYMOUS),
    paperBatchNames: new Map([['A4 White', 'A4 White']]),
  };
}
