import type { FormatInput, FormatView, PaperInput, PaperView } from './types.js';

const show = (v: number | string | null): string => (v === null || v === '' ? 'not set' : String(v));

export function describePaperChange(old: PaperView, next: PaperInput): string | null {
  const parts: string[] = [];
  if (old.batchName !== next.batchName) parts.push(`batch name ${show(old.batchName)} -> ${show(next.batchName)}`);
  if ((old.paperCode ?? '') !== (next.paperCode ?? '')) parts.push(`paper code ${show(old.paperCode)} -> ${show(next.paperCode)}`);
  return parts.length ? `Paper "${old.name}": ${parts.join(', ')}` : null;
}
export const describePaperDeleted = (name: string): string => `Paper "${name}" deleted`;

export function describeFormatChange(old: FormatView, next: FormatInput): string | null {
  const parts: string[] = [];
  if (old.maxWeightG !== next.maxWeightG) parts.push(`most weight ${old.maxWeightG}g -> ${next.maxWeightG}g`);
  if (old.maxThicknessMm !== next.maxThicknessMm) parts.push(`most thickness ${show(old.maxThicknessMm)} -> ${show(next.maxThicknessMm)}${next.maxThicknessMm === null ? '' : ' mm'}`);
  if (old.maxSheets !== next.maxSheets) parts.push(`most sheets ${show(old.maxSheets)} -> ${show(next.maxSheets)}`);
  return parts.length ? `Postal format "${old.name}": ${parts.join(', ')}` : null;
}

export const describeAnonymousAdded = (n: string): string => `Anonymous addressee ${n} added`;
export const describeAnonymousDeleted = (n: string): string => `Anonymous addressee ${n} removed`;
