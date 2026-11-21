import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { PDFDocument, rgb, pushGraphicsState, popGraphicsState, moveTo, lineTo, closePath, clip, endPath, appendBezierCurve, type PDFFont, type PDFPage } from 'pdf-lib';
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
const DEFAULT_LOGO = new URL('../../assets/intellidoc-logo.png', import.meta.url);

const K = 0.5522847498;
/** Clips to a circle, runs `draw`, restores. */
function inCircle(page: PDFPage, cx: number, cy: number, r: number, draw: () => void): void {
  page.pushOperators(pushGraphicsState(), moveTo(cx + r, cy),
    appendBezierCurve(cx + r, cy + K * r, cx + K * r, cy + r, cx, cy + r), appendBezierCurve(cx - K * r, cy + r, cx - r, cy + K * r, cx - r, cy),
    appendBezierCurve(cx - r, cy - K * r, cx - K * r, cy - r, cx, cy - r), appendBezierCurve(cx + K * r, cy - r, cx + r, cy - K * r, cx + r, cy),
    closePath(), clip(), endPath());
  draw();
  page.pushOperators(popGraphicsState());
}

/** Round Union Jack (UK) or a globe (international), centred at cx, cy. */
function drawPostBadge(page: PDFPage, international: boolean, cx: number, cy: number, r: number): void {
  const navy = rgb(0.0, 0.14, 0.4), red = rgb(0.8, 0.07, 0.17), white = rgb(1, 1, 1);
  if (international) {
    page.drawCircle({ x: cx, y: cy, size: r, color: rgb(0.2, 0.45, 0.75) });
    const line = { color: white, thickness: 0.7 };
    page.drawCircle({ x: cx, y: cy, size: r - 0.4, borderColor: white, borderWidth: 0.7 });
    page.drawLine({ start: { x: cx - r, y: cy }, end: { x: cx + r, y: cy }, ...line });
    page.drawLine({ start: { x: cx, y: cy - r }, end: { x: cx, y: cy + r }, ...line });
    page.drawEllipse({ x: cx, y: cy, xScale: r * 0.5, yScale: r, borderColor: white, borderWidth: 0.7 });
    return;
  }
  inCircle(page, cx, cy, r, () => {
    const a = { x: cx - r, y: cy - r }, b = { x: cx + r, y: cy + r }, c = { x: cx - r, y: cy + r }, d = { x: cx + r, y: cy - r };
    page.drawRectangle({ x: cx - r, y: cy - r, width: 2 * r, height: 2 * r, color: navy });
    for (const [s, e, t, col] of [[a, b, r * 0.4, white], [c, d, r * 0.4, white], [a, b, r * 0.16, red], [c, d, r * 0.16, red]] as const) page.drawLine({ start: s, end: e, thickness: t, color: col });
    page.drawLine({ start: { x: cx - r, y: cy }, end: { x: cx + r, y: cy }, thickness: r * 0.55, color: white });
    page.drawLine({ start: { x: cx, y: cy - r }, end: { x: cx, y: cy + r }, thickness: r * 0.55, color: white });
    page.drawLine({ start: { x: cx - r, y: cy }, end: { x: cx + r, y: cy }, thickness: r * 0.3, color: red });
    page.drawLine({ start: { x: cx, y: cy - r }, end: { x: cx, y: cy + r }, thickness: r * 0.3, color: red });
  });
}

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

interface Row { label: string; values: string[]; red?: boolean; badge?: 'uk' | 'world' }

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
  {
    const img = await doc.embedPng(logoPng ?? new Uint8Array(await readFile(DEFAULT_LOGO)));
    logoH = 13 * MM;
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
      if (r.badge) drawPostBadge(page, r.badge === 'world', LEFT + WIDTH - 5 * MM, y + 6 * MM, 3.4 * MM);
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
  fulfil.push({ label: 'Postal provider', values: [data.postalProvider] }, { label: 'Postal service', values: [data.postalService], badge: data.isInternational ? 'world' : 'uk' },
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
