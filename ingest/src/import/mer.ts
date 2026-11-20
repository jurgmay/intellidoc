/**
 * FileMaker "Merge" (.mer) export reader: UTF-8 CSV with a header row of field names. FileMaker writes embedded
 * line breaks as VT (\x0b); they are turned into "\n" so JSON columns parse. Dates stay as dd/mm/yyyy text.
 */
export type Row = Record<string, string>;

export function parseMer(text: string): Row[] {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() ?? [];
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').replace(/\x0b/g, '\n')])));
}

export const lc = (s: string | undefined): string => (s ?? '').trim().toLowerCase();
export const flag = (s: string | undefined): boolean => (s ?? '').trim() === '1';
export const num = (s: string | undefined): number | null => { const t = (s ?? '').trim(); if (t === '') return null; const n = Number(t); return Number.isFinite(n) ? n : null; };
export function json<T = unknown>(s: string | undefined): T | null {
  if (!s || !s.trim()) return null;
  try { return JSON.parse(s) as T; } catch { return null; }
}
