import { describe, expect, it } from 'vitest';
import { parseMer } from '../../src/import/mer.js';
import { buildPlan } from '../../src/import/plan.js';

const A = 'aaaaaaaa-0000-0000-0000-000000000001', B = 'aaaaaaaa-0000-0000-0000-000000000002', C = 'aaaaaaaa-0000-0000-0000-000000000003';
const BR = 'bbbbbbbb-0000-0000-0000-000000000001';
const S1 = 'cccccccc-0000-0000-0000-000000000001', S2 = 'cccccccc-0000-0000-0000-000000000002', S3 = 'cccccccc-0000-0000-0000-000000000003';
const E1 = 'dddddddd-0000-0000-0000-000000000001', E2 = 'dddddddd-0000-0000-0000-000000000002', E3 = 'dddddddd-0000-0000-0000-000000000003';

const cust = (o: Record<string, string>) => ({ id: '', id_parentAccount: '', id_groupingAccount: '', accountCode: '', accountName: '', isDeleted: '0', ...o });
const customers = [
  cust({ id: A, accountCode: 'ACME', accountName: 'Acme', id_groupingAccount: A, hpodAccountPassword: 'SECRET',
    notificationEmails: 'a@x.co\nb@x.co; a@x.co', addressMatchJSON: JSON.stringify({ addressMatching: ['TenantID'], addressMatchingExclude: [{ passthroughKey: 'DocType', passthroughValue: 'S20' }] }),
    packSequenceJSON: JSON.stringify({ passthroughKey: 'DocType', sequences: [{ passthroughValue: 'Invoice', sequenceNumber: 1 }] }),
    envelopesJSON: JSON.stringify({ x: { y: [{ id: E1, stockCode: 'WH1' }, { id: E3, stockCode: 'WH1' }] } }) }),
  cust({ id: B, accountCode: 'ACME_SUB', accountName: 'Acme sub', id_parentAccount: A, id_groupingAccount: A }),
  cust({ id: C, accountCode: 'ORPHAN', accountName: 'Orphan', id_groupingAccount: 'ffffffff-0000-0000-0000-00000000dead', isDeleted: '1' }),
];
const stockRow = (o: Record<string, string>) => ({ id: '', id_parent: '', id_customer: A, id_brand: '', stockCode: '', type: 'Outer Envelope', description: 'C5 Envelope', isEnvelope: '1', isInsert: '0',
  isActive: '1', isStockManaged: '1', size: 'C5', weight: '8', thickness: '0', quantityInStock: '500', ...o });
const stock = [
  stockRow({ id: S1, stockCode: 'WH1' }),
  stockRow({ id: S2, stockCode: 'WH1', description: 'Clash', isActive: '0' }),
  stockRow({ id: S3, stockCode: '', type: 'Booklet', isEnvelope: '1', isInsert: '1', size: '', description: 'Booklet' }),
];
const env = (o: Record<string, string>) => ({ id: '', id_customer: A, id_brand: BR, id_stockItem: S1, isDeleted: '0', postalProvider: 'Royal Mail', postalFormat: 'Letter', postalService: '2nd Class',
  externalService: '2nd Class', maxWeight: '100', externalReference: '', internalReference: '', externalName: 'C5 Envelope', customer: 'Acme', identifier: 'x', ...o });
const envelopes = [env({ id: E1 }), env({ id: E2 }), env({ id: E3, externalService: '', id_stockItem: 'missing' })];

describe('parseMer', () => {
  it('handles quotes, embedded VT line breaks, a BOM and CRLF', () => {
    const rows = parseMer('﻿a,b\r\n"x, y","l1\x0bl2 ""q"""\r\nz,\r\n');
    expect(rows).toEqual([{ a: 'x, y', b: 'l1\nl2 "q"' }, { a: 'z', b: '' }]);
  });
});

describe('buildPlan', () => {
  const plan = buildPlan({ customers, brands: [{ id: BR, id_customer: A, name: 'Bront�' }, { id: 'x', id_customer: 'nope', name: 'Lost' }], stock, envelopes });

  it('builds the account hierarchy and treats a dangling grouping account as its own customer', () => {
    expect(plan.accounts.find((a) => a.code === 'ACME')!.groupingLegacyId).toBeNull();
    expect(plan.accounts.find((a) => a.code === 'ACME_SUB')).toMatchObject({ groupingLegacyId: A, parentLegacyId: A });
    expect(plan.accounts.find((a) => a.code === 'ORPHAN')).toMatchObject({ groupingLegacyId: null, isDeleted: true });
    expect(plan.warnings.some((w) => /ORPHAN.*not in the export/.test(w))).toBe(true);
  });
  it('reads rules and de-duplicates notification emails', () => {
    const a = plan.accounts.find((x) => x.code === 'ACME')!;
    expect(a.emails).toEqual(['a@x.co', 'b@x.co']);
    expect(a.matchRules).toEqual([{ isInclude: true, key: 'TenantID', value: null }, { isInclude: false, key: 'DocType', value: 'S20' }]);
    expect(a.sequenceRules).toEqual([{ value: 'Invoice', sequence: 1 }]);
    expect(a.packSequenceKey).toBe('DocType');
  });
  it('never carries credentials into the plan', () => { expect(JSON.stringify(plan)).not.toMatch(/SECRET|hpod/i); });
  it('flags a corrupted brand name and skips brands of unknown customers', () => {
    expect(plan.brands).toHaveLength(1);
    expect(plan.warnings.some((w) => /corrupted/.test(w))).toBe(true);
  });
  it('gives a duplicated stock code to the active item only, and derives isEnvelope from the type', () => {
    expect(plan.stock.find((s) => s.legacyId === S1)!.code).toBe('WH1');
    expect(plan.stock.find((s) => s.legacyId === S2)!.code).toBeNull();
    expect(plan.stock.find((s) => s.legacyId === S3)).toMatchObject({ isEnvelope: false, isInsert: true, code: null });
  });
  it('imports only envelopes referenced by an account, skips missing stock and falls back to the service as delivery band', () => {
    expect(plan.envelopes.map((e) => e.legacyId)).toEqual([E1]);
    expect(plan.skipped['envelopesStale']).toBe(1);        // E2 is in no account
    expect(plan.skipped['envelopesMissingStock']).toBe(1); // E3
  });
  it('creates the postal rate an envelope points at', () => {
    expect(plan.rates).toContainEqual(expect.objectContaining({ provider: 'Royal Mail', format: 'Letter', service: '2nd Class', maxG: 100 }));
  });
});
