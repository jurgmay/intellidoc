import type { IngestPack, MatchExclusionReason, ParsedPack } from './types.js';
import type { AccountConfig, ReferenceData } from './reference.js';
import { isAnonymousAddressee, normaliseLine, normalisePostcode } from './address.js';
import type { NormalisedAddress } from './types.js';

export function exclusionFor(pack: ParsedPack, address: NormalisedAddress, acct: AccountConfig, ref: ReferenceData): MatchExclusionReason | null {
  if (!acct.matchingEnabled) return 'MATCHING_DISABLED';
  if (address.hadNotice) return 'NOTICE_ENCLOSED';
  if (isAnonymousAddressee(pack, address, ref.anonymousAddressees)) return 'ANONYMOUS_ADDRESSEE';
  if (acct.matchExclude.some((r) => pack.passthrough[r.key] === r.value)) return 'ACCOUNT_RULE';
  return null;
}

/**
 * Key that decides whether two packs MAY share an envelope. Anything that is part of batch identity must be
 * part of this key too (a mailpiece lives in exactly one batch). The address hash includes the recipient,
 * so different people never share a key. Excluded packs get a unique key.
 */
export function matchKey(p: IngestPack, acct: AccountConfig): string {
  if (p.matchExclusion) return `X:${p.parsed.guid}`;
  const inc = acct.matchIncludeKeys.map((k) => `${k}=${p.parsed.passthrough[k] ?? ''}`);
  return [
    p.address.hash, p.customerCode, p.brand ?? '', p.parsed.options.envelopeCode,
    p.parsed.options.deliveryMethod, p.parsed.options.paper, p.batchingValue, ...inc,
  ].join('\u001f');
}

/** Group packs into mailpiece groups; asserts the GDPR invariant before returning. */
export function groupPacks(packs: IngestPack[], ref: ReferenceData): IngestPack[][] {
  const groups = new Map<string, IngestPack[]>();
  for (const p of packs) {
    const acct = ref.accounts.get(p.accountCode)!;
    const k = p.matchKey || matchKey(p, acct);
    const g = groups.get(k);
    if (g) g.push(p); else groups.set(k, [p]);
  }
  const out = [...groups.values()];
  for (const g of out) assertSingleRecipient(g);
  return out;
}

/** Belt and braces: independent of the hash, verify every pack in a group has the identical addressee + address. */
export function assertSingleRecipient(g: IngestPack[]): void {
  if (g.length < 2) return;
  const sig = (p: IngestPack): string => [
    normaliseLine(p.parsed.address.firstName), normaliseLine(p.parsed.address.surname),
    ...p.address.lines.map(normaliseLine), normalisePostcode(p.address.postcode),
  ].join('\u001f');
  const s0 = sig(g[0]!);
  for (const p of g) {
    if (p.matchExclusion) throw new Error(`GDPR violation: excluded pack ${p.parsed.guid} grouped with others`);
    if (sig(p) !== s0) throw new Error(`GDPR violation: different recipients grouped (${g[0]!.parsed.guid} / ${p.parsed.guid})`);
  }
}
