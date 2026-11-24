import readXlsxFile from 'read-excel-file/node';
import { ValidationError } from '../errors.js';

export type Cell = string | number | boolean | Date | null;
/** One data row of the file: `row` is its row number in the spreadsheet (the heading row is 1), `cells` is keyed by the normalised heading. */
export interface FileRow { row: number; cells: Record<string, Cell> }
export interface RatesFile { headings: string[]; rows: FileRow[] }

/** 'postalProvider', 'Postal provider' and 'postal_provider' are the same heading. */
export const normalise = (h: unknown): string => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Reads comma-separated text, with "quoted, fields" and "" for a quote inside one. A leading byte order mark is ignored. */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], field = '', quoted = false, any = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (quoted) {
      if (c === '"') { if (t[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c;
    } else if (c === '"') { quoted = true; any = true; }
    else if (c === ',') { row.push(field); field = ''; any = true; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      if (any || field !== '') { row.push(field); out.push(row); }
      row = []; field = ''; any = false;
    } else { field += c; any = true; }
  }
  if (any || field !== '') { row.push(field); out.push(row); }
  return out;
}

const MAX_ROWS = 20_000;

/** Reads the first sheet of an .xlsx file, or a .csv file, into rows keyed by heading. Blank rows are skipped. */
export async function readRatesFile(data: Buffer, fileName: string): Promise<RatesFile> {
  if (!data || data.length === 0) throw new ValidationError({ file: 'The file is empty.' });
  const isXlsx = data.length > 4 && data[0] === 0x50 && data[1] === 0x4b; // a zip: .xlsx files are
  let table: Cell[][];
  if (isXlsx) {
    try { table = (await readXlsxFile(data)) as Cell[][]; }
    catch { throw new ValidationError({ file: 'That file could not be read as an Excel (.xlsx) workbook.' }); }
  } else if (/\.xlsx?$/i.test(fileName) && !/\.csv$/i.test(fileName)) {
    throw new ValidationError({ file: 'That is not a readable .xlsx file. Save it as .xlsx (Excel Workbook) or as .csv and try again.' });
  } else {
    table = parseCsv(data.toString('utf8')).map((r) => r.map((v) => (v.trim() === '' ? null : v.trim())));
  }
  if (table.length === 0) throw new ValidationError({ file: 'The file has no rows.' });
  if (table.length > MAX_ROWS) throw new ValidationError({ file: `The file has more than ${MAX_ROWS} rows.` });
  const headings = table[0]!.map(normalise);
  const rows: FileRow[] = [];
  table.slice(1).forEach((cells, i) => {
    if (cells.every((c) => c === null || c === '')) return;
    const rec: Record<string, Cell> = {};
    headings.forEach((h, j) => { if (h && !(h in rec)) rec[h] = cells[j] ?? null; });
    rows.push({ row: i + 2, cells: rec });
  });
  return { headings, rows };
}
