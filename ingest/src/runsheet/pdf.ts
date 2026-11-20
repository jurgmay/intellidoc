import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import bwipjs from 'bwip-js';
import type { RunSheetData } from './data.js';

const MM = 72 / 25.4;
const LEFT = 20 * MM;
const WIDTH = 170 * MM;
const HEADER = rgb(52 / 255, 103 / 255, 177 / 255);
const LABEL_W = 42 * MM;

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

/** WinAnsi can't draw every character (e.g. smart quotes beyond Latin-1); replace what the standard font can't encode. */
function safe(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
}

async function dataMatrix(text: string): Promise<Uint8Array> {
  return bwipjs.toBuffer({ bcid: 'datamatrix', text, scale: 4, padding: 0 });
}

/** One A4 page. Fonts: Helvetica stands in for Poppins until the licensed font files are supplied. */
export async function renderRunSheet(data: RunSheetData, logoPng?: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Run sheet ${data.batchCode}`);
  const page = doc.addPage([595.28, 841.89]);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let y = page.getHeight() - 20 * MM;

  if (logoPng) {
    const img = await doc.embedPng(logoPng);
    const h = 14 * MM;
    page.drawImage(img, { x: LEFT, y: y - h, width: (img.width / img.height) * h, height: h });
  }
  const dm = await doc.embedPng(await dataMatrix(data.batchCode));
  const dmSize = 24 * MM;
  page.drawImage(dm, { x: LEFT + WIDTH - dmSize, y: y - dmSize, width: dmSize, height: dmSize });
  y -= 30 * MM;

  const section = (title: string, rows: [string, string[]][]): void => {
    page.drawText(title, { x: LEFT, y, size: 12, font: bold, color: HEADER });
    y -= 3 * MM;
    page.drawLine({ start: { x: LEFT, y }, end: { x: LEFT + WIDTH, y }, thickness: 0.8, color: HEADER });
    y -= 6 * MM;
    for (const [label, values] of rows) {
      page.drawText(safe(label), { x: LEFT, y, size: 10, font: bold });
      let first = true;
      for (const v of values.length ? values : ['']) {
        for (const l of wrap(safe(v), regular, 10, WIDTH - LABEL_W)) {
          page.drawText(l, { x: LEFT + LABEL_W, y, size: 10, font: regular });
          y -= 5 * MM;
          first = false;
        }
      }
      if (first) y -= 5 * MM;
      y -= 1.5 * MM;
    }
    y -= 6 * MM;
  };

  section('Job details', [
    ['Job number', [data.jobNumber]],
    ['Customer', [data.customerName]],
    ['Batch code', [data.batchCode]],
    ['File name', [data.fileName]],
    ['Date submitted', [data.dateSubmitted]],
  ]);
  section('Production details', [
    ['Print method', [data.printMethod]],
    ['Total mailpieces', [data.totalMailpieces.toLocaleString('en-GB')]],
    ['Total pages', [data.totalPages.toLocaleString('en-GB')]],
  ]);
  const fulfil: [string, string[]][] = [
    ['Department', [data.department]],
    ['Envelope', [data.envelope]],
  ];
  if (data.inserts.length) fulfil.push(['Inserts', data.inserts]);
  fulfil.push(['Postal provider', [data.postalProvider]], ['Postal service', [data.postalService]], ['Postal format', [data.postalFormat]],
    ['Weight bands', data.weightBands]);
  if (data.returnAddress) fulfil.push(['Return address', [data.returnAddress]]);
  section('Fulfilment details', fulfil);
  drawPageFooter(page, regular, data);
  return doc.save();
}

function drawPageFooter(page: PDFPage, font: PDFFont, data: RunSheetData): void {
  page.drawText(safe(`Batch ${data.batchCode}`), { x: LEFT, y: 10 * MM, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
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
