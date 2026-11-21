import { describe, expect, it } from 'vitest';
import { priceMailpiece, SMALL_BATCH_LIMIT } from '../src/costing/calculate.js';
import type { ChargeCode, CostingModel, PricingInput, Rate } from '../src/costing/types.js';

const r = (cost: number, sellPrice: number, adjustment = 0): Rate => ({ cost, sellPrice, adjustment });
const model = (): CostingModel => ({
  id: 1, name: 'Standard',
  rates: new Map<ChargeCode, Rate>([
    ['HPOD', r(0.10, 0.20)], ['PROCESSING', r(0.05, 0.15)], ['PAPER_SHEET', r(0.01, 0.02)], ['COLOUR_PAGE', r(0.05, 0.10)], ['MONO_PAGE', r(0.02, 0.04, 0.01)],
    ['INSERT', r(0.03, 0.06)], ['HAND_ENCLOSING_SETUP', r(0.20, 0.40)], ['HAND_ENCLOSING_SHEET', r(0.05, 0.08)],
    ['MACHINE_ENCLOSING_SETUP', r(0.10, 0.20)], ['MACHINE_ENCLOSING_SHEET', r(0.02, 0.04)], ['ADDRESS_MATCHING', r(0.01, 0.03)], ['OVERSTICKERING', r(0.04, 0.09)],
    ['HAND_SMALL_BATCH_ADJUSTMENT', r(0, 0.50)], ['HAND_LETTER_ADJUSTMENT', r(0, 0.07)], ['ADJUSTMENT', r(0, 0.02)],
  ]),
  envelopes: new Map([[7, r(0.04, 0.08, 0.01)]]),
  postageAdjustments: new Map([[3, 0.05]]),
});
const input = (over: Partial<PricingInput> = {}): PricingInput => ({
  packs: 1, colourPages: 0, monoPages: 2, blankPages: 0, inserts: 0, enclosing: 'Hand', isOversticker: false, batchMailpieces: 50, postalFormat: 'Letter',
  isAddressMatching: false, envelopeStockItemId: 7, postageRate: { id: 3, cost: 0.55, sellPrice: 0.70 }, ...over,
});
const line = (p: ReturnType<typeof priceMailpiece>, code: string) => p.lines.find((l) => l.code === code);

describe('priceMailpiece', () => {
  it('prices a hand-enclosed letter line by line, with the unit adjustments and postage kept apart', () => {
    const p = priceMailpiece(model(), input({ packs: 2, colourPages: 2, monoPages: 4, inserts: 1, isAddressMatching: true }));
    expect(p.lines.map((l) => [l.code, l.quantity, l.cost, l.sell])).toEqual([
      ['HPOD', 1, 0.10, 0.20], ['PROCESSING', 1, 0.05, 0.15], ['PAPER_SHEET', 3, 0.03, 0.06], ['COLOUR_PAGE', 2, 0.10, 0.20], ['MONO_PAGE', 4, 0.08, 0.20],
      ['ENVELOPE', 1, 0.04, 0.09], ['INSERT', 1, 0.03, 0.06], ['HAND_ENCLOSING_SETUP', 1, 0.20, 0.40], ['HAND_ENCLOSING_SHEET', 2, 0.10, 0.16], ['BAGGING', 1, 0, 0],
      ['ADDRESS_MATCHING', 1, 0.01, 0.03], ['HAND_LETTER_ADJUSTMENT', 1, 0, 0.07], ['ADJUSTMENT', 1, 0, 0.02],
    ]);
    expect(p).toMatchObject({ productionCost: 0.74, productionSell: 1.64, postageCost: 0.55, postageSell: 0.75, totalCost: 1.29, totalSell: 2.39, warnings: [] });
    expect(line(p, 'MONO_PAGE')).toMatchObject({ unitCost: 0.02, unitSell: 0.05 }); // sell price 0.04 + adjustment 0.01
    expect(line(p, 'ENVELOPE')).toMatchObject({ unitSell: 0.09 });
  });

  it('machine enclosing, oversticker, small batch and large letter; empty charges are skipped', () => {
    const p = priceMailpiece(model(), input({ monoPages: 1, blankPages: 1, enclosing: 'Machine', isOversticker: true, batchMailpieces: 10, postalFormat: 'Large Letter' }));
    expect(p.lines.map((l) => l.code)).toEqual(['HPOD', 'PROCESSING', 'PAPER_SHEET', 'MONO_PAGE', 'BLANK_PAGE', 'ENVELOPE', 'MACHINE_ENCLOSING_SETUP', 'BAGGING', 'OVERSTICKERING',
      'HAND_SMALL_BATCH_ADJUSTMENT', 'HAND_LARGE_LETTER_ADJUSTMENT', 'ADJUSTMENT']); // no inserts, no extra sheet, no letter adjustment
    expect(p).toMatchObject({ productionCost: 0.36, productionSell: 1.32 });
  });

  it('a sheet is two pages, an odd page takes a whole sheet, and a mailpiece without pages never gets a negative enclosing charge', () => {
    expect(line(priceMailpiece(model(), input({ monoPages: 3 })), 'PAPER_SHEET')).toMatchObject({ quantity: 2 });
    expect(line(priceMailpiece(model(), input({ monoPages: 3 })), 'HAND_ENCLOSING_SHEET')).toMatchObject({ quantity: 1, cost: 0.05 });
    const none = priceMailpiece(model(), input({ monoPages: 0 }));
    expect(line(none, 'PAPER_SHEET')).toBeUndefined();
    expect(line(none, 'HAND_ENCLOSING_SHEET')).toBeUndefined();
  });

  it('address matching is charged only when the customer has it on, once for each pack after the first', () => {
    expect(line(priceMailpiece(model(), input({ packs: 4 })), 'ADDRESS_MATCHING')).toBeUndefined();
    expect(line(priceMailpiece(model(), input({ packs: 4, isAddressMatching: true })), 'ADDRESS_MATCHING')).toMatchObject({ quantity: 3, sell: 0.09 });
    expect(line(priceMailpiece(model(), input({ packs: 1, isAddressMatching: true })), 'ADDRESS_MATCHING')).toBeUndefined();
  });

  it('the small batch adjustment starts below the limit', () => {
    expect(SMALL_BATCH_LIMIT).toBe(20);
    expect(line(priceMailpiece(model(), input({ batchMailpieces: 19 })), 'HAND_SMALL_BATCH_ADJUSTMENT')).toBeDefined();
    expect(line(priceMailpiece(model(), input({ batchMailpieces: 20 })), 'HAND_SMALL_BATCH_ADJUSTMENT')).toBeUndefined();
  });

  it('warns, and leaves the part out, when there is no postage rate or no envelope price', () => {
    const noPost = priceMailpiece(model(), input({ postageRate: null }));
    expect(noPost).toMatchObject({ postageCost: 0, postageSell: 0 });
    expect(noPost.warnings).toEqual(['No postage rate with a price for this mailpiece.']);
    expect(priceMailpiece(model(), input({ postageRate: { id: 3, cost: null, sellPrice: 0.7 } })).warnings).toHaveLength(1);
    const noEnv = priceMailpiece(model(), input({ envelopeStockItemId: 99 }));
    expect(line(noEnv, 'ENVELOPE')).toBeUndefined();
    expect(noEnv.warnings).toEqual(['No price for the outer envelope in this costing model.']);
    expect(priceMailpiece(model(), input({ envelopeStockItemId: null })).warnings).toHaveLength(1);
  });

  it('a postage rate with no adjustment in the model is charged at its suggested sell price', () => {
    expect(priceMailpiece(model(), input({ postageRate: { id: 4, cost: 0.55, sellPrice: 0.70 } }))).toMatchObject({ postageCost: 0.55, postageSell: 0.7 });
  });

  it('rounds each line to four decimal places so the totals are the sum of the lines', () => {
    const m = model(); m.rates.set('MONO_PAGE', r(0.012345, 0.033333));
    const p = priceMailpiece(m, input({ monoPages: 3 }));
    expect(line(p, 'MONO_PAGE')).toMatchObject({ unitCost: 0.0123, cost: 0.037, sell: 0.1 });
    expect(p.productionSell).toBe(Math.round(p.lines.reduce((t, l) => t + l.sell, 0) * 10_000) / 10_000);
  });
});
