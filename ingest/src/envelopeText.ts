/**
 * The envelope text a customer system sends, e.g. "C4 Envelope", "C4 envelope ref: Bristol office",
 * "C4 envelope ref: Bristol office (Planning)", "C5 Envelope (Planning)".
 *   reference: follows "ref: " up to the end of the text or " (" ; brand: always in parentheses.
 * Real references can themselves contain brackets ("Somerset Council (County Hall, Taunton)"), so a reference
 * the account is configured with wins over the plain " (" rule.
 */
export interface EnvelopeText { size: string | null; reference: string; brand: string | null }

export function parseEnvelopeText(value: string, knownReferences: string[] = [], knownBrands: string[] = []): EnvelopeText {
  const text = value.trim();
  const size = /^(C\d|A\d|DL)\b/i.exec(text)?.[1]?.toUpperCase() ?? null;
  const at = text.toLowerCase().indexOf('ref: ');
  let reference = '';
  let tail = text;
  if (at >= 0) {
    const after = text.slice(at + 5).trim();
    const known = knownReferences
      .filter((r) => r && after.toLowerCase().startsWith(r.toLowerCase()) && (after.length === r.length || after.slice(r.length).startsWith(' (')))
      .sort((a, b) => b.length - a.length)[0];
    if (known) { reference = known; tail = after.slice(known.length); }
    else { const j = after.indexOf(' ('); reference = (j < 0 ? after : after.slice(0, j)).trim(); tail = j < 0 ? '' : after.slice(j); }
  }
  const group = /\(([^()]*)\)\s*$/.exec(tail)?.[1]?.trim();
  let brand: string | null = null;
  if (group) {
    const known = knownBrands.find((b) => b.toLowerCase() === group.toLowerCase());
    // without a "ref:" a bracket could be anything ("(1st Class)"), so only accept a brand we know
    brand = known ?? (at >= 0 ? group : null);
  }
  return { size, reference, brand };
}
