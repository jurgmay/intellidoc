import { CHARGES, type ChargeCode, type CostingModel, type PriceLine, type Pricing, type PricingInput, type Rate } from './types.js';

/** A batch with fewer mailpieces than this carries the small batch adjustment. */
export const SMALL_BATCH_LIMIT = 20;
const ZERO: Rate = { cost: 0, sellPrice: 0, adjustment: 0 };
const r4 = (n: number): number => Math.round((n + Number.EPSILON) * 10_000) / 10_000;
const label = (code: ChargeCode): string => CHARGES.find((c) => c.code === code)!.label;

/**
 * Prices one mailpiece from a costing model. Production lines add up to the production cost and sell price; postage is
 * kept apart. Unit sell price = the charge's sell price + its adjustment. Page counts are for the whole mailpiece; sheets
 * come from the mailpiece (see PricingInput.sheets), because a pack is printed on whole sheets. Every line is rounded to four decimal places before it is added, so totals are the sum of the
 * lines shown.
 */
export function priceMailpiece(model: CostingModel, input: PricingInput): Pricing {
  const lines: PriceLine[] = [];
  const warnings: string[] = [];
  const rate = (code: ChargeCode): Rate => model.rates.get(code) ?? ZERO;
  const add = (code: string, text: string, quantity: number, r: Rate, sellOnly = false): void => {
    if (quantity === 0) return;
    const unitCost = sellOnly ? 0 : r.cost;
    const unitSell = r.sellPrice + (sellOnly ? 0 : r.adjustment);
    lines.push({ code, label: text, quantity, unitCost: r4(unitCost), unitSell: r4(unitSell), cost: r4(unitCost * quantity), sell: r4(unitSell * quantity) });
  };
  const charge = (code: ChargeCode, quantity: number, sellOnly = false): void => add(code, label(code), quantity, rate(code), sellOnly);

  const sheets = input.sheets;

  charge('HPOD', 1);
  charge('PROCESSING', 1);
  charge('PAPER_SHEET', sheets);
  charge('COLOUR_PAGE', input.colourPages);
  charge('MONO_PAGE', input.monoPages);
  charge('BLANK_PAGE', input.blankPages);

  if (input.envelopeStockItemId !== null && model.envelopes.has(input.envelopeStockItemId)) add('ENVELOPE', 'Outer envelope', 1, model.envelopes.get(input.envelopeStockItemId)!);
  else warnings.push('No price for the outer envelope in this costing model.');

  charge('INSERT', input.inserts);
  const machine = input.enclosing === 'Machine';
  charge(machine ? 'MACHINE_ENCLOSING_SETUP' : 'HAND_ENCLOSING_SETUP', 1);
  charge(machine ? 'MACHINE_ENCLOSING_SHEET' : 'HAND_ENCLOSING_SHEET', Math.max(0, sheets - 1));
  charge('BAGGING', 1);
  if (input.isAddressMatching) charge('ADDRESS_MATCHING', Math.max(0, input.packs - 1));
  if (input.isOversticker) charge('OVERSTICKERING', 1);

  // Adjustments are a sell price only: they cost nothing and are not themselves adjusted.
  if (input.batchMailpieces < SMALL_BATCH_LIMIT) charge('HAND_SMALL_BATCH_ADJUSTMENT', 1, true);
  if (input.postalFormat === 'Letter') charge('HAND_LETTER_ADJUSTMENT', 1, true);
  if (input.postalFormat === 'Large Letter') charge('HAND_LARGE_LETTER_ADJUSTMENT', 1, true);
  charge('ADJUSTMENT', 1, true);

  let postageCost = 0; let postageSell = 0;
  const p = input.postageRate;
  if (!p || p.cost === null || p.sellPrice === null) warnings.push('No postage rate with a price for this mailpiece.');
  else { postageCost = r4(p.cost); postageSell = r4(p.sellPrice + (model.postageAdjustments.get(p.id) ?? 0)); }

  const sum = (f: (l: PriceLine) => number): number => r4(lines.reduce((t, l) => t + f(l), 0));
  const productionCost = sum((l) => l.cost); const productionSell = sum((l) => l.sell);
  return { lines, productionCost, productionSell, postageCost, postageSell, totalCost: r4(productionCost + postageCost), totalSell: r4(productionSell + postageSell), warnings };
}
