import { FLAGS, type EnvelopesMode, type CustomerDetail, type CustomerDetailsInput, type EnvelopeInput, type FlagKey, type MatchRule, type SequenceRule } from './types.js';

/** Plain-English names for the account flags, shared by the audit log and (via the API) the screen. */
export const FLAG_LABELS: Record<FlagKey, string> = {
  isAddressMatching: 'Address matching', isArchiveMailpieces: 'Archive mailpieces', isCreateOutputFiles: 'Create output files',
  isSso: 'SSO', isSameDayService: 'Same-day service',
  isUseMrdf: 'Use MRDF', isTesting: 'Testing', isDeleted: 'Deleted',
};

const show = (v: string | null): string => (v === null || v === '' ? '(none)' : `"${v}"`);

/** One readable sentence per change to the customer record; empty when nothing changed. */
export function describeDetailsChange(old: CustomerDetail, next: CustomerDetailsInput, newParentCode: string | null, newPendingFrom: string | null, newInvoicingCode: string | null = null): string[] {
  const out: string[] = [];
  const text = (label: string, a: string | null, b: string | null): void => { if ((a ?? null) !== (b ?? null)) out.push(`${label}: ${show(a)} → ${show(b)}`); };
  text('Account code', old.code, next.code);
  text('Name', old.name, next.name);
  text('Job number', old.misJobNumber, next.misJobNumber);
  if (old.jobNumberRolloverDay !== next.jobNumberRolloverDay) out.push(`Job number rollover day: ${old.jobNumberRolloverDay} → ${next.jobNumberRolloverDay}`);
  if ((old.pendingJobNumber ?? null) !== (next.pendingJobNumber ?? null)) {
    out.push(`Pending job number: ${show(old.pendingJobNumber)} → ${show(next.pendingJobNumber)}${next.pendingJobNumber && newPendingFrom ? ` (takes effect ${newPendingFrom})` : ''}`);
  }
  text('Return address', old.returnAddress, next.returnAddress);
  text('Parent', old.parent?.code ?? null, newParentCode);
  text('Invoicing account', old.invoicing?.code ?? null, newInvoicingCode);
  text('Batching key', old.batchingKey, next.batchingKey);
  text('Pack sequence key', old.packSequenceKey, next.packSequenceKey);
  for (const f of FLAGS) if (old.flags[f] !== next.flags[f]) out.push(`${FLAG_LABELS[f]}: ${old.flags[f] ? 'on' : 'off'} → ${next.flags[f] ? 'on' : 'off'}`);
  return out;
}

export const ENVELOPES_MODE_LABELS: Record<EnvelopesMode, string> = { OWN: 'its own list', INHERIT: "the parent's list", EXTEND: "the parent's list plus its own" };
export const describeEnvelopesMode = (from: EnvelopesMode, to: EnvelopesMode): string => `Envelopes: ${ENVELOPES_MODE_LABELS[from]} → ${ENVELOPES_MODE_LABELS[to]}`;

export const describeEnvelope = (brand: string | null, band: string, rate: string, stock: string): string =>
  `${brand ?? 'any brand'} / ${band} / ${rate} / ${stock}`;

export const describeMatchRules = (rules: MatchRule[]): string =>
  rules.length === 0 ? 'none' : rules.map((r) => (r.isInclude ? `include ${r.key}` : `exclude ${r.key} = "${r.value}"`)).join('; ');

export const describeSequenceRules = (rules: SequenceRule[]): string =>
  rules.length === 0 ? 'none' : [...rules].sort((a, b) => a.number - b.number).map((r) => `${r.number}. ${r.value}`).join('; ');

export const describeEnvelopeInput = (e: EnvelopeInput): string => `band ${e.deliveryBand}, reference ${show(e.reference)}`;

export const describeBecameSubAccount = (parentCode: string, ownerCode: string): string => `Became a sub-account of ${parentCode}: settings now come from ${ownerCode}`;
export const describeBecameCustomer = (code: string, name: string): string => `Account ${code} "${name}" now holds its own settings, as a customer`;
export const describeSubAccountOf = (code: string, name: string): string => `Account ${code} "${name}" became a sub-account of this customer`;
export const describeLeftAsCustomer = (code: string, name: string): string => `Account ${code} "${name}" left, to hold its own settings as a customer`;
export const noChildCustomers = (names: string[]): string => `${names.length} customer${names.length === 1 ? ' is' : 's are'} placed under this one (${names.slice(0, 3).join(', ')}${names.length > 3 ? ', …' : ''}). Move ${names.length === 1 ? 'it' : 'them'} to another parent first.`;
