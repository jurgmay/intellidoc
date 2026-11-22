import { describe, expect, it } from 'vitest';
import { batchKeywords } from '../src/compose/keywords.js';

const archive = { customerTag: 'ACME', providerTag: 'IRON', directoryTag: 'acme/statements' };

describe('batchKeywords', () => {
  it('writes nothing for a customer that does not archive on ordinary paper', () => {
    expect(batchKeywords({ archive: null, edgeToEdge: false })).toBeUndefined();
  });
  it('writes the three archive tags, comma separated with no spaces', () => {
    expect(batchKeywords({ archive, edgeToEdge: false })).toBe('archiving_customer:ACME,archiving_provider:IRON,archiving_directory:acme/statements');
  });
  it('writes only the tags that are set', () => {
    expect(batchKeywords({ archive: { customerTag: 'ACME', providerTag: null, directoryTag: null }, edgeToEdge: false })).toBe('archiving_customer:ACME');
    expect(batchKeywords({ archive: { customerTag: null, providerTag: null, directoryTag: null }, edgeToEdge: false })).toBeUndefined();
  });
  it('writes the SRA4 imposition for edge-to-edge paper', () => {
    expect(batchKeywords({ archive: null, edgeToEdge: true })).toBe('imposition:SRA4');
  });
  it('writes both, archive first, where a customer archives on edge-to-edge paper', () => {
    expect(batchKeywords({ archive, edgeToEdge: true })).toBe('archiving_customer:ACME,archiving_provider:IRON,archiving_directory:acme/statements,imposition:SRA4');
  });
});
