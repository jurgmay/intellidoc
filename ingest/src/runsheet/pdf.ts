import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import bwipjs from 'bwip-js';
import type { RunSheetData } from './data.js';

const MM = 72 / 25.4;
const LEFT = 20 * MM;
const WIDTH = 170 * MM;
const BLUE = rgb(52 / 255, 103 / 255, 177 / 255);
const LABEL = rgb(65 / 255, 176 / 255, 214 / 255);
const RULE = rgb(0.86, 0.88, 0.92);
const RED = rgb(0.9, 0.1, 0.1);
const LABEL_W = 42 * MM;
const require = createRequire(import.meta.url);

async function poppins(weight: 400 | 500 | 600): Promise<Uint8Array> {
  return new Uint8Array(await readFile(require.resolve(`@fontsource/poppins/files/poppins-latin-${weight}-normal.woff`)));
}

/** Greedy word wrap on measured width. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width || !line) line = next; else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

/** Replace characters the font subset can't draw. */
function safe(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
}

async function dataMatrix(text: string): Promise<Uint8Array> {
  return bwipjs.toBuffer({ bcid: 'datamatrix', text, scale: 4, padding: 0 });
}

interface Row { label: string; values: string[]; red?: boolean }

/** One A4 page laid out like the FileMaker run sheet. Poppins (OFL) is embedded. */
export async function renderRunSheet(data: RunSheetData, logoPng?: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`Run sheet ${data.batchCode}`);
  const page = doc.addPage([595.28, 841.89]);
  const light = await doc.embedFont(await poppins(400), { subset: true });
  const medium = await doc.embedFont(await poppins(500), { subset: true });
  const semi = await doc.embedFont(await poppins(600), { subset: true });
  let y = page.getHeight() - 14 * MM;

  let logoH = 0;
  if (logoPng) {
    const img = await doc.embedPng(logoPng);
    logoH = 16 * MM;
    page.drawImage(img, { x: LEFT, y: y - logoH, width: (img.width / img.height) * logoH, height: logoH });
  }
  const dm = await doc.embedPng(await dataMatrix(data.batchCode));
  const dmSize = 12 * MM;
  page.drawImage(dm, { x: LEFT + WIDTH - dmSize, y: y - dmSize, width: dmSize, height: dmSize });
  y -= logoH + 16 * MM;

  page.drawText(safe(data.customerName), { x: LEFT, y, size: 18, font: semi, color: BLUE });
  y -= 7 * MM;
  if (data.brand) { page.drawText(safe(data.brand), { x: LEFT, y, size: 12, font: light, color: BLUE }); }
  y -= 14 * MM;

  const section = (title: string, rows: Row[]): void => {
    page.drawText(title, { x: LEFT, y, size: 11, font: semi, color: BLUE });
    y -= 7 * MM;
    for (const r of rows) {
      page.drawText(safe(r.label), { x: LEFT, y, size: 8.5, font: medium, color: LABEL });
      for (const v of r.values.length ? r.values : ['']) {
        for (const l of wrap(safe(v), light, 8.5, WIDTH - LABEL_W)) {
          page.drawText(l, { x: LEFT + LABEL_W, y, size: 8.5, font: light, color: r.red ? RED : rgb(0, 0, 0) });
          y -= 4.6 * MM;
        }
      }
      if (!r.values.length) y -= 4.6 * MM;
      y += 1.2 * MM;
      page.drawLine({ start: { x: LEFT, y }, end: { x: LEFT + WIDTH, y }, thickness: 0.6, color: RULE });
      y -= 5 * MM;
    }
    y -= 4 * MM;
  };

  section('Job details', [
    { label: 'Imprint Job Number', values: [data.jobNumber] },
    { label: 'Batch code', values: [data.batchCode] },
    { label: 'File name', values: [data.fileName] },
    { label: 'Date submitted', values: [data.dateSubmitted] },
  ]);
  section('Production details', [
    { label: 'Print method', values: [data.printMethod] },
    { label: 'Total mailpieces', values: [data.totalMailpieces.toLocaleString('en-GB')] },
    { label: 'Total pages', values: [data.totalPages.toLocaleString('en-GB')] },
  ]);
  const fulfil: Row[] = [{ label: 'Department', values: [data.department] }, { label: 'Envelope', values: [data.envelope] }];
  if (data.inserts.length) fulfil.push({ label: 'Inserts', values: data.inserts, red: true });
  fulfil.push({ label: 'Postal provider', values: [data.postalProvider] }, { label: 'Postal service', values: [data.postalService] },
    { label: 'Postal format', values: [data.postalFormat] }, { label: 'Weight bands', values: data.weightBands },
    { label: 'Return address', values: data.returnAddress ? [data.returnAddress] : [] });
  section('Fulfilment details', fulfil);
  footer(page, light, data);
  return doc.save();
}

function footer(page: PDFPage, font: PDFFont, data: RunSheetData): void {
  page.drawText(safe(`Batch ${data.batchCode}`), { x: LEFT, y: 10 * MM, size: 7, font, color: rgb(0.5, 0.5, 0.5) });
}

/** Merges single-page PDFs (already rendered) into one document, in the order given. */
export async function mergePdfs(parts: Uint8Array[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const p of parts) {
    const src = await PDFDocument.load(p);
    for (const pg of await out.copyPages(src, src.getPageIndices())) out.addPage(pg);
  }
  return out.save();
}
