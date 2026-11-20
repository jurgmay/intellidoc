import { describe, expect, it } from 'vitest';
import { parseEnvelopeText } from '../src/envelopeText.js';
import { choosePhysical } from '../src/physical.js';
import { fixtureReference } from '../src/fixtureReference.js';
import type { AccountConfig, EnvelopeOption } from '../src/reference.js';
import type { IngestPack } from '../src/types.js';

describe('parseEnvelopeText', () => {
  it('splits size, reference and brand', () => {
    expect(parseEnvelopeText('C4 envelope ref: Bristol office (Planning)')).toEqual({ size: 'C4', reference: 'Bristol office', brand: 'Planning' });
    expect(parseEnvelopeText('C5 Envelope ref: Remus')).toEqual({ size: 'C5', reference: 'Remus', brand: null });
    expect(parseEnvelopeText('C4 Envelope')).toEqual({ size: 'C4', reference: '', brand: null });
  });
  it('a bracket without "ref:" is a brand only when the account has that brand', () => {
    expect(parseEnvelopeText('C4 Envelope (Planning)', [], ['Planning']).brand).toBe('Planning');
    expect(parseEnvelopeText('C4 Envelope (1st Class)', [], ['Planning']).brand).toBeNull();
  });
  it('a configured reference containing brackets wins over the plain rule', () => {
    const t = parseEnvelopeText('C5 Envelope ref: Somerset Council (County Hall, Taunton) (Revs)', ['Somerset Council (County Hall, Taunton)'], ['Revs']);
    expect(t).toEqual({ size: 'C5', reference: 'Somerset Council (County Hall, Taunton)', brand: 'Revs' });
  });
});

describe('weight bands', () => {
  const ref = fixtureReference();
  const ll = (max: number, code: string): EnvelopeOption => ({ brand: null, reference: '', postalFormat: 'Large Letter', size: 'C4', stockCode: code, deliveryBand: '2nd Class', minWeightG: 0, maxWeightG: max });
  // overlapping "up to" bands, as imported (all start at 0), deliberately listed out of order
  const account: AccountConfig = {
    code: 'X', customerCode: 'X', brands: [], batchingKey: null, matchingEnabled: false, matchIncludeKeys: [], matchExclude: [],
    envelopes: [ll(750, 'C4-REMUS'), ll(250, 'C4-REMUS'), ll(100, 'C4-REMUS'), ll(500, 'C4-REMUS'),
      { brand: null, reference: '', postalFormat: 'Letter', size: 'C5', stockCode: 'WH21518', deliveryBand: '2nd Class', minWeightG: 0, maxWeightG: 100 }],
  };
  const pack = (sheets: number): IngestPack => ({ sheets } as IngestPack);
  const pick = (sheets: number, inserts: { code: string; quantity: number }[] = []) =>
    choosePhysical([pack(sheets)], inserts, account, null, '', { code: 'C4-REMUS', value: 'C4 Envelope' }, '2nd Class', ref);

  it('chooses the smallest band that holds the weight, not the first that matches', () => {
    expect(pick(17).envelope.maxWeightG).toBe(250);                                 // 95.6 + 17 = 113 g
    const heavy = pick(1, [{ code: 'INSERT-HEAVY', quantity: 2 }]);                  // 5.6 + 240 + 17 = 263 g
    expect(heavy.postalFormat).toBe('Large Letter'); expect(heavy.envelope.maxWeightG).toBe(500);
  });
  it('a pack over 750 g becomes a small parcel, which this account has no envelope for -> falls back to the selection', () => {
    const p = pick(1, [{ code: 'INSERT-HEAVY', quantity: 7 }]);                      // ~862 g
    expect(p.fallback).toBe(true);
  });
});
