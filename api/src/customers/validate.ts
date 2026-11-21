import { ValidationError } from '../errors.js';
import { parseEmails } from '../settings/catalogue.js';
import { FLAGS, type CustomerDetailsInput, type EnvelopeInput, type FlagKey, type MatchRule, type SequenceRule } from './types.js';

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
type Body = Record<string, unknown> | null | undefined;

function text(errs: Record<string, string>, body: Body, field: string, label: string, max: number, required: boolean): string | null {
  const raw = body?.[field];
  if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    if (required) errs[field] = `${label} is required`;
    return null;
  }
  if (typeof raw !== 'string') { errs[field] = `${label} must be text`; return null; }
  const t = raw.trim();
  if (t.length > max) { errs[field] = `${label} can be at most ${max} characters`; return null; }
  return t;
}
const done = (errs: Record<string, string>): void => { if (Object.keys(errs).length) throw new ValidationError(errs); };

export function parseNewAccount(body: Body): { code: string; name: string } {
  const errs: Record<string, string> = {};
  const code = text(errs, body, 'code', 'Account code', 100, true);
  const name = text(errs, body, 'name', 'Name', 200, true);
  done(errs);
  return { code: code!, name: name! };
}

export function parseAccountUpdate(body: Body): { code: string; name: string; isDeleted: boolean } {
  const errs: Record<string, string> = {};
  const base = parseNewAccountSafe(body, errs);
  const del = body?.['isDeleted'];
  if (typeof del !== 'boolean') errs['isDeleted'] = 'Deleted must be on or off';
  done(errs);
  return { ...base, isDeleted: del as boolean };
}
function parseNewAccountSafe(body: Body, errs: Record<string, string>): { code: string; name: string } {
  return { code: text(errs, body, 'code', 'Account code', 100, true) ?? '', name: text(errs, body, 'name', 'Name', 200, true) ?? '' };
}

export function parseDetails(body: Body): CustomerDetailsInput {
  const errs: Record<string, string> = {};
  const code = text(errs, body, 'code', 'Account code', 100, true);
  const name = text(errs, body, 'name', 'Name', 200, true);
  const misJobNumber = text(errs, body, 'misJobNumber', 'Job number', 50, false);
  if (body?.['pendingJobNumber'] === undefined) errs['pendingJobNumber'] = 'Pending job number must be given (use null for none)';
  const pendingJobNumber = text(errs, body, 'pendingJobNumber', 'Pending job number', 50, false);
  const returnAddress = text(errs, body, 'returnAddress', 'Return address', 500, false);
  const batchingKey = text(errs, body, 'batchingKey', 'Batching key', 100, false);
  const packSequenceKey = text(errs, body, 'packSequenceKey', 'Pack sequence key', 100, false);
  const pid = body?.['parentId'];
  let parentId: number | null = null;
  if (pid === undefined) errs['parentId'] = 'Parent must be given (use null for none)';
  else if (pid !== null) { if (typeof pid !== 'number' || !Number.isInteger(pid) || pid < 1) errs['parentId'] = 'Parent is not valid'; else parentId = pid; }
  const flagsRaw = (body?.['flags'] ?? {}) as Record<string, unknown>;
  const flags = {} as Record<FlagKey, boolean>;
  for (const f of FLAGS) {
    if (typeof flagsRaw[f] !== 'boolean') errs[`flags.${f}`] = `${f} must be on or off`;
    flags[f] = flagsRaw[f] === true;
  }
  done(errs);
  return { code: code!, name: name!, misJobNumber, pendingJobNumber, returnAddress, flags, batchingKey, packSequenceKey, parentId };
}

export function parseBrandName(body: Body): string {
  const errs: Record<string, string> = {};
  const name = text(errs, body, 'name', 'Brand name', 200, true);
  done(errs);
  return name!;
}

export function parseEnvelope(body: Body): EnvelopeInput {
  const errs: Record<string, string> = {};
  const deliveryBand = text(errs, body, 'deliveryBand', 'Delivery band', 50, true);
  const reference = text(errs, body, 'reference', 'Reference', 100, false);
  const externalName = text(errs, body, 'externalName', 'External name', 200, false);
  const int = (field: string, label: string, required: boolean): number | null => {
    const v = body?.[field];
    if (v === null || v === undefined) { if (required) errs[field] = `${label} is required`; return null; }
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) { errs[field] = `${label} is not valid`; return null; }
    return v;
  };
  const brandId = int('brandId', 'Brand', false);
  const postalRateId = int('postalRateId', 'Postal service and weight band', true);
  const stockItemId = int('stockItemId', 'Envelope', true);
  const over = body?.['isOversticker'];
  if (typeof over !== 'boolean') errs['isOversticker'] = 'Oversticker must be on or off';
  done(errs);
  return { brandId, deliveryBand: deliveryBand!, postalRateId: postalRateId!, stockItemId: stockItemId!, reference, externalName, isOversticker: over as boolean };
}

export function parseMatchRules(body: Body): MatchRule[] {
  const list = body?.['rules'];
  if (!Array.isArray(list)) throw new ValidationError({ rules: 'Expected { "rules": [ ... ] }' });
  const errs: Record<string, string> = {};
  const out: MatchRule[] = [];
  list.forEach((r: Record<string, unknown>, i) => {
    const key = typeof r?.['key'] === 'string' ? r['key'].trim() : '';
    const value = typeof r?.['value'] === 'string' && r['value'].trim() !== '' ? r['value'].trim() : null;
    const isInclude = r?.['isInclude'];
    if (typeof isInclude !== 'boolean') errs[`rules.${i}`] = `Rule ${i + 1}: choose include or exclude`;
    else if (!key) errs[`rules.${i}`] = `Rule ${i + 1}: the passthrough key is required`;
    else if (key.length > 100) errs[`rules.${i}`] = `Rule ${i + 1}: the key can be at most 100 characters`;
    else if (!isInclude && value === null) errs[`rules.${i}`] = `Rule ${i + 1}: an exclude rule needs the value that excludes a pack`;
    else if (value !== null && value.length > 400) errs[`rules.${i}`] = `Rule ${i + 1}: the value can be at most 400 characters`;
    else out.push({ isInclude: isInclude as boolean, key, value: isInclude ? null : value });
  });
  done(errs);
  return out;
}

export function parseSequenceRules(body: Body): SequenceRule[] {
  const list = body?.['rules'];
  if (!Array.isArray(list)) throw new ValidationError({ rules: 'Expected { "rules": [ ... ] }' });
  const errs: Record<string, string> = {};
  const out: SequenceRule[] = [];
  const seen = new Set<string>();
  list.forEach((r: Record<string, unknown>, i) => {
    const value = typeof r?.['value'] === 'string' ? r['value'].trim() : '';
    const number = r?.['number'];
    if (!value) errs[`rules.${i}`] = `Row ${i + 1}: the value is required`;
    else if (value.length > 400) errs[`rules.${i}`] = `Row ${i + 1}: the value can be at most 400 characters`;
    else if (typeof number !== 'number' || !Number.isInteger(number) || number < 1) errs[`rules.${i}`] = `Row ${i + 1}: the position must be a whole number of 1 or more`;
    else if (seen.has(value.toLowerCase())) errs[`rules.${i}`] = `Row ${i + 1}: "${value}" is listed twice`;
    else { seen.add(value.toLowerCase()); out.push({ value, number }); }
  });
  done(errs);
  return out;
}

export function parseEmailList(body: Body): string[] {
  const list = body?.['emails'];
  if (!Array.isArray(list) || list.some((e) => typeof e !== 'string')) throw new ValidationError({ emails: 'Expected { "emails": [ ... ] }' });
  const all = (list as string[]).flatMap((e) => parseEmails(e));
  const bad = all.filter((e) => !EMAIL.test(e));
  if (bad.length) throw new ValidationError({ emails: `Not an e-mail address: ${bad.join(', ')}` });
  const seen = new Set<string>();
  return all.filter((e) => { const k = e.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
}
