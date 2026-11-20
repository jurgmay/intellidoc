import { createHash } from 'node:crypto';
import type { NormalisedAddress, ParsedPack } from './types.js';

const NOTICE = /^\s*IMPORTANT\s+NOTICE\s+ENCLOSED\s*$/i;

/** Conservative normalisation: only ever makes MORE strings equal when they differ in case, spacing or punctuation. */
export function normaliseLine(s: string): string {
  return s
    .toUpperCase()
    .replace(/&/g, ' AND ')
    .replace(/[-.,'’`/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalisePostcode(s: string): string {
  return s.toUpperCase().replace(/\s+/g, '');
}

/**
 * Builds the address used for matching. The recipient (first/surname AND every addressee line)
 * is part of the hash, so two different people can never share a hash (GDPR rule).
 * The "IMPORTANT NOTICE ENCLOSED" line is dropped and only its presence recorded.
 */
export function normaliseAddress(pack: ParsedPack): NormalisedAddress {
  const a = pack.address;
  const pc = normalisePostcode(a.postcode);
  let hadNotice = false;
  let lines = a.lines.map((l) => l.trim()).filter((l) => l.length > 0);
  lines = lines.filter((l) => {
    if (NOTICE.test(l)) { hadNotice = true; return false; }
    return true;
  });
  // The last line is normally the postcode; it is stored separately.
  const last = lines[lines.length - 1];
  if (last !== undefined && normalisePostcode(last) === pc) lines = lines.slice(0, -1);

  const canonical = [
    `R:${normaliseLine(a.firstName)}|${normaliseLine(a.surname)}`,
    ...lines.map((l, i) => `L${i}:${normaliseLine(l)}`),
    `P:${pc}`,
    `C:${a.country.toUpperCase()}`,
  ].join('\n');
  const hash = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return { lines, postcode: a.postcode.trim().toUpperCase(), country: a.country.toLowerCase(), hash, hadNotice };
}

/** Anonymous addressees (THE OCCUPIER...) never merge. */
export function isAnonymousAddressee(pack: ParsedPack, address: NormalisedAddress, anonymous: ReadonlySet<string>): boolean {
  const squash = (s: string): string => normaliseLine(s).replace(/ /g, '');
  const candidates = [squash(`${pack.address.firstName} ${pack.address.surname}`)];
  if (address.lines[0] !== undefined) candidates.push(squash(address.lines[0]));
  return candidates.some((c) => anonymous.has(c));
}
