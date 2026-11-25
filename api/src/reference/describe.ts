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
  if (old.maxWeightG !== next.maxWeightG) parts.push(`maximum weight ${old.maxWeightG}g -> ${next.maxWeightG}g`);
  if (old.maxThicknessMm !== next.maxThicknessMm) parts.push(`maximum thickness ${show(old.maxThicknessMm)} -> ${show(next.maxThicknessMm)}${next.maxThicknessMm === null ? '' : ' mm'}`);
  if (old.maxSheets !== next.maxSheets) parts.push(`maximum sheets ${show(old.maxSheets)} -> ${show(next.maxSheets)}`);
  if (old.maxLengthMm !== next.maxLengthMm) parts.push(`maximum length ${old.maxLengthMm} mm -> ${next.maxLengthMm} mm`);
  if (old.maxWidthMm !== next.maxWidthMm) parts.push(`maximum width ${old.maxWidthMm} mm -> ${next.maxWidthMm} mm`);
  return parts.length ? `Postal format "${old.name}": ${parts.join(', ')}` : null;
}

export const describeAnonymousAdded = (n: string): string => `Anonymous addressee ${n} added`;
export const describeAnonymousDeleted = (n: string): string => `Anonymous addressee ${n} removed`;
export const describeInsertSizeAdded = (n: string): string => `Insert size ${n} added`;
export const describeInsertSizeDeleted = (n: string): string => `Insert size ${n} removed`;
export function describeInsertSizeChange(old: { name: string; widthMm: number | null; heightMm: number | null }, next: { widthMm: number | null; heightMm: number | null }): string | null {
  const parts: string[] = [];
  if (old.widthMm !== next.widthMm) parts.push(`width ${old.widthMm === null ? '(none)' : `${old.widthMm} mm`} -> ${next.widthMm === null ? '(none)' : `${next.widthMm} mm`}`);
  if (old.heightMm !== next.heightMm) parts.push(`height ${old.heightMm === null ? '(none)' : `${old.heightMm} mm`} -> ${next.heightMm === null ? '(none)' : `${next.heightMm} mm`}`);
  return parts.length ? `Insert size ${old.name}: ${parts.join(', ')}` : null;
}
