import { describe, expect, it } from 'vitest';
import { composedPages, paddingPages } from '../src/costing/colour.js';

const packs = [{ colour: 2, mono: 1, blank: 1 }, { colour: 0, mono: 3, blank: 0 }, { colour: 0, mono: 0, blank: 2 }];
describe('composedPages', () => {
  it('ORIGINAL keeps the counts', () => expect(composedPages('ORIGINAL', packs)).toEqual({ colour: 2, mono: 4, blank: 3 }));
  it('ALL_MONO has no colour and keeps blanks', () => expect(composedPages('ALL_MONO', packs)).toEqual({ colour: 0, mono: 6, blank: 3 }));
  it('FIRST_PACK_PAGE: one colour page per pack that prints; a pack with no printed pages is left alone', () =>
    expect(composedPages('FIRST_PACK_PAGE', packs)).toEqual({ colour: 2, mono: 4, blank: 3 }));
  it('FIRST_MAILPIECE_PAGE: one colour page, in the first pack only', () => expect(composedPages('FIRST_MAILPIECE_PAGE', packs)).toEqual({ colour: 1, mono: 5, blank: 3 }));
  it('a pack whose own option is Mono is all mono in every mode, and the rest are unaffected', () => {
    const mixed = [{ colour: 2, mono: 1, blank: 0, forceMono: true }, { colour: 3, mono: 0, blank: 1 }];
    expect(composedPages('ORIGINAL', mixed)).toEqual({ colour: 3, mono: 1 + 2, blank: 1 });
    expect(composedPages('FIRST_PACK_PAGE', mixed)).toEqual({ colour: 1, mono: 5, blank: 1 });
    expect(composedPages('FIRST_MAILPIECE_PAGE', mixed)).toEqual({ colour: 0, mono: 6, blank: 1 }); // the first pack is mono, so the mailpiece has no colour page
  });
  it('handles no packs', () => expect(composedPages('FIRST_PACK_PAGE', [])).toEqual({ colour: 0, mono: 0, blank: 0 }));
});

describe('paddingPages', () => {
  const pk = (colour: number, mono: number, blank: number) => ({ colour, mono, blank });
  it('is one blank page for each pack with an odd number of pages', () => {
    expect(paddingPages([pk(1, 0, 0), pk(0, 2, 0), pk(1, 1, 1), pk(0, 0, 4)])).toBe(2);
    expect(paddingPages([pk(0, 3, 0), pk(0, 3, 0)])).toBe(2);   // two 3-page packs: 6 pages printed as 8
  });
  it('is nothing for no packs or whole sheets', () => {
    expect(paddingPages([])).toBe(0);
    expect(paddingPages([pk(1, 1, 0), pk(0, 4, 0)])).toBe(0);
  });
});
