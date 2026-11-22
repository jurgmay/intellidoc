import { describe, expect, it } from 'vitest';
import { buildPlan } from '../../src/import/plan.js';
import { chargesFrom } from '../../src/import/costingPlan.js';

const id = (n: number) => `aaaaaaaa-0000-0000-0000-00000000000${n}`;
const [P, Q, R, S] = [id(1), id(2), id(3), id(4)];
const ST = 'cccccccc-0000-0000-0000-000000000001', ST2 = 'cccccccc-0000-0000-0000-000000000002';
const leaf = (cost: number, sellPrice: number, adjustment = 0) => ({ cost, sellPrice, adjustment });
const model = (sell: number, extra: Record<string, unknown> = {}) => ({
  printing: { colourPage: leaf(0.04, sell), monoPage: leaf(0.01, 0.02), blankPage: leaf(0, 0), paper: leaf(0.005, 0.01) },
  processing: { hpod: leaf(0.1, 0.2), service: leaf(0.05, 0.1) },
  extras: { addressMatching: leaf(0.01, 0.02), inserting: leaf(0.02, 0.03), laminatedSheet: leaf(0, 0), overstickering: leaf(0, 0), geo: leaf(0, 0) },
  admin: { bagging: leaf(0.3, 0.4) },
  enclosing: { hand: { setup: leaf(1, 2), run: leaf(0.1, 0.2), largeLetterAdjustment: 0, letterAdjustment: 0.5, smallBatchAdjustment: 0, maxMailpiecesPerBatch: 50, maxSheets: 4 }, machine: { setup: leaf(3, 4), run: leaf(0.05, 0.06) } },
  adjustment: 0, ...extra,
});
const cust = (o: Record<string, string>) => ({ id: '', id_parentAccount: '', id_groupingAccount: '', accountCode: '', accountName: '', isDeleted: '0', id_costingModel: '', costingModelJSON: '', ...o });
const m1 = (sell: number) => ({ id_costingModel: 'm1', costingModelJSON: JSON.stringify(model(sell)) });
const customers = [
  cust({ id: P, accountCode: 'P', accountName: 'Parent', id_groupingAccount: P, ...m1(0.07),
    envelopesJSON: JSON.stringify({ x: { y: [{ id: 'dddddddd-0000-0000-0000-000000000001', stockCode: 'WH1' }] } }) }),
  cust({ id: Q, accountCode: 'Q', accountName: 'Sub', id_parentAccount: P, id_groupingAccount: P, ...m1(0.07) }),
  cust({ id: S, accountCode: 'S', accountName: 'Own settings, same list', id_parentAccount: P, id_groupingAccount: S, ...m1(0.07) }),
  cust({ id: R, accountCode: 'R', accountName: 'Other', id_groupingAccount: R, id_costingModel: 'm2', costingModelJSON: JSON.stringify(model(0.09, { extras: { laminatedSheet: leaf(0.5, 0.8) } })) }),
];
const stock = [
  { id: ST, id_parent: '', id_customer: P, id_brand: '', stockCode: 'WH1', type: 'Outer Envelope', description: 'C5', isEnvelope: '1', isInsert: '0', isActive: '1', isStockManaged: '1', size: 'C5', weight: '8', thickness: '0', quantityInStock: '1', cost: '0.05', sellPrice: '0.10', sellPriceAdjustment: '0.01' },
  { id: ST2, id_parent: '', id_customer: P, id_brand: '', stockCode: 'WH2', type: 'Outer Envelope', description: 'C4', isEnvelope: '1', isInsert: '0', isActive: '1', isStockManaged: '1', size: 'C4', weight: '8', thickness: '0', quantityInStock: '1', cost: '0', sellPrice: '0', sellPriceAdjustment: '0' },
];
const envelopes = [{ id: 'dddddddd-0000-0000-0000-000000000001', id_customer: P, id_brand: '', id_stockItem: ST, isDeleted: '0', postalProvider: 'Royal Mail', postalFormat: 'Letter', postalService: '2nd Class',
  externalService: '2nd Class', maxWeight: '100', externalReference: '', internalReference: '', externalName: 'C5', customer: 'P', identifier: 'x' }];

describe('costing import plan', () => {
  const plan = buildPlan({ customers, brands: [], stock, envelopes });
  const code = (legacy: string) => plan.accounts.find((a) => a.legacyId === legacy)!.code;

  it('adds one list per distinct price list, to the account that holds it', () => {
    expect(plan.costing.map((m) => [code(m.hostLegacyId), m.sourceId]).sort()).toEqual([['P', 'm1'], ['R', 'm2']]);
  });
  it('points accounts that share their parent\'s list at the parent instead of copying it', () => {
    expect(plan.costingInherit.map(code)).toEqual(['S']);
  });
  it('maps every priced charge and only the non-zero adjustments', () => {
    const m = plan.costing.find((x) => x.sourceId === 'm1')!;
    expect(m.charges.length).toBe(15);
    expect(m.charges.find((c) => c.code === 'COLOUR_PAGE')).toEqual({ code: 'COLOUR_PAGE', cost: 0.04, sellPrice: 0.07, adjustment: 0 });
    expect(m.charges.find((c) => c.code === 'HAND_LETTER_ADJUSTMENT')).toEqual({ code: 'HAND_LETTER_ADJUSTMENT', cost: 0, sellPrice: 0, adjustment: 0.5 });
    expect(m.charges.some((c) => c.code === 'HAND_SMALL_BATCH_ADJUSTMENT' || c.code === 'ADJUSTMENT')).toBe(false);
  });
  it('prices the envelopes the account uses from their stock items', () => {
    const m = plan.costing.find((x) => x.sourceId === 'm1')!;
    expect(m.envelopes).toEqual([{ stockLegacyId: ST, cost: 0.05, sellPrice: 0.1, adjustment: 0.01 }]);
  });
  it('says so when a price has nowhere to go, and imports the rest', () => {
    expect(plan.warnings.some((w) => /laminated sheet/.test(w) && /R/.test(w))).toBe(true);
    expect(plan.skipped['costingPricesNotImported']).toBe(1);
  });
  it('warns and skips an unreadable price list', () => {
    const p = buildPlan({ customers: [cust({ id: P, accountCode: 'P', accountName: 'P', id_groupingAccount: P, id_costingModel: 'm1', costingModelJSON: '{oops' })], brands: [], stock: [], envelopes: [] });
    expect(p.costing).toEqual([]);
    expect(p.warnings.some((w) => /price list could not be read/.test(w))).toBe(true);
  });
  it('does nothing for accounts with no price list', () => {
    const p = buildPlan({ customers: [cust({ id: P, accountCode: 'P', accountName: 'P', id_groupingAccount: P })], brands: [], stock: [], envelopes: [] });
    expect(p.costing).toEqual([]); expect(p.warnings.filter((w) => /price list/.test(w))).toEqual([]);
  });
  it('chargesFrom copes with an empty model', () => { expect(chargesFrom({})).toEqual([]); });
});

describe('colour mode in the import', () => {
  it('maps the FileMaker colour modes and warns about unknown values', () => {
    const c = (id: string, mode: string) => cust({ id, accountCode: id, accountName: id, id_groupingAccount: id, colourMode: mode });
    const p = buildPlan({ customers: [c(P, '0'), c(Q, '1'), c('R', '2'), c('S', '3'), c('T', '9')], brands: [], stock: [], envelopes: [] });
    const m = (code: string) => p.accounts.find((a) => a.code === code)!.colourMode;
    expect([m(P), m(Q), m('R'), m('S'), m('T')]).toEqual(['ORIGINAL', 'ALL_MONO', 'FIRST_PACK_PAGE', 'FIRST_MAILPIECE_PAGE', 'ORIGINAL']);
    expect(p.warnings.filter((w) => /colour mode/.test(w))).toEqual(['Account T: FileMaker colour mode 9 is not understood; imported as ORIGINAL']);
  });
});

describe('archive tags and logos in the import', () => {
  it('imports the customer and directory tags and logos; the provider tag is not in the export', () => {
    const p = buildPlan({ customers: [cust({ id: P, accountCode: 'P', accountName: 'P', id_groupingAccount: P, isArchiveMailpieces: '1', id_archivingProvider: 'prov-1',
      customerMetadataTag: ' ACME ', directoryMetadataTag: 'acme/dir', logo1: 'LOGO1', logo2: '' })], brands: [], stock: [], envelopes: [] });
    const a = p.accounts[0]!;
    expect([a.archiveCustomerTag, a.archiveDirectoryTag, a.logo1, a.logo2]).toEqual(['ACME', 'acme/dir', 'LOGO1', null]);
    expect(p.warnings.some((w) => /Account P: archives mailpieces under provider prov-1/.test(w))).toBe(true);
  });
  it('does not import a logo that is too long for the MRDF', () => {
    const p = buildPlan({ customers: [cust({ id: P, accountCode: 'P', accountName: 'P', id_groupingAccount: P, logo1: 'TOOLONGNAME' })], brands: [], stock: [], envelopes: [] });
    expect(p.accounts[0]!.logo1).toBeNull();
    expect(p.warnings.some((w) => /logo1 "TOOLONGNAME" is longer than 8/.test(w))).toBe(true);
  });
});
