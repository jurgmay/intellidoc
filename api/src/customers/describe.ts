import { FLAGS, type CustomerDetail, type CustomerDetailsInput, type EnvelopeInput, type FlagKey, type MatchRule, type SequenceRule } from './types.js';

/** Plain-English names for the account flags, shared by the audit log and (via the API) the screen. */
export const FLAG_LABELS: Record<FlagKey, string> = {
  isAddressMatching: 'Address matching', isArchiveMailpieces: 'Archive mailpieces', isCreateOutputFiles: 'Create output files',
  isCreateSeparateBatches: 'Create separate batches', isNhs: 'NHS', isSso: 'SSO', isSameDayService: 'Same-day service',
  isUseMrdf: 'Use MRDF', isTesting: 'Testing', isDeleted: 'Deleted',
};

const show = (v: string | null): string => (v === null || v === '' ? '(none)' : `"${v}"`);

/** One readable sentence per change to the customer record; empty when nothing changed. */
export function describeDetailsChange(old: CustomerDetail, next: CustomerDetailsInput): string[] {
  const out: string[] = [];
  const text = (label: string, a: string | null, b: string | null): void => { if ((a ?? null) !== (b ?? null)) out.push(`${label}: ${show(a)} → ${show(b)}`); };
  text('Account code', old.code, next.code);
  text('Name', old.name, next.name);
  text('MIS job number', old.misJobNumber, next.misJobNumber);
  text('Return address', old.returnAddress, next.returnAddress);
  text('Batching key', old.batchingKey, next.batchingKey);
  text('Pack sequence key', old.packSequenceKey, next.packSequenceKey);
  for (const f of FLAGS) if (old.flags[f] !== next.flags[f]) out.push(`${FLAG_LABELS[f]}: ${old.flags[f] ? 'on' : 'off'} → ${next.flags[f] ? 'on' : 'off'}`);
  return out;
}

export const describeEnvelope = (brand: string | null, band: string, rate: string, stock: string): string =>
  `${brand ?? 'any brand'} / ${band} / ${rate} / ${stock}`;

export const describeMatchRules = (rules: MatchRule[]): string =>
  rules.length === 0 ? 'none' : rules.map((r) => (r.isInclude ? `include ${r.key}` : `exclude ${r.key} = "${r.value}"`)).join('; ');

export const describeSequenceRules = (rules: SequenceRule[]): string =>
  rules.length === 0 ? 'none' : [...rules].sort((a, b) => a.number - b.number).map((r) => `${r.number}. ${r.value}`).join('; ');

export const describeEnvelopeInput = (e: EnvelopeInput): string => `band ${e.deliveryBand}, reference ${show(e.reference)}`;
