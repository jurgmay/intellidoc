/**
 * Colour mode: how a customer's mail is printed when the PDF is composed. It decides what is billed, so pricing applies it to the page counts read from the PDF.
 *   ORIGINAL            print as in the incoming PDF
 *   FIRST_PACK_PAGE     the first page of each pack in colour, the rest mono
 *   FIRST_MAILPIECE_PAGE the first page of each mailpiece (its first pack, in envelope order) in colour, the rest mono
 *   ALL_MONO            everything mono
 * Blank pages stay blank in every mode. The counts do not say which page is blank, so the first page of a pack is taken to be a printed one
 * (a pack with no printed pages is left alone). A pack whose own option says Mono is all mono in every mode.
 */
export const COLOUR_MODES = ['ORIGINAL', 'FIRST_PACK_PAGE', 'FIRST_MAILPIECE_PAGE', 'ALL_MONO'] as const;
export type ColourMode = (typeof COLOUR_MODES)[number];
/** `forceMono`: the pack's own option says Mono, so all of its pages are mono whatever the mode (the composer does the same). */
export interface PackPages { colour: number; mono: number; blank: number; forceMono?: boolean }

export function composedPages(mode: ColourMode, packs: PackPages[]): PackPages {
  const out: PackPages = { colour: 0, mono: 0, blank: 0 };
  packs.forEach((p, i) => {
    const printed = p.colour + p.mono;
    let colour = p.colour;
    if (mode === 'ALL_MONO' || p.forceMono) colour = 0;
    else if (mode === 'FIRST_PACK_PAGE') colour = printed > 0 ? 1 : 0;
    else if (mode === 'FIRST_MAILPIECE_PAGE') colour = i === 0 && printed > 0 ? 1 : 0;
    out.colour += colour; out.mono += printed - colour; out.blank += p.blank;
  });
  return out;
}
