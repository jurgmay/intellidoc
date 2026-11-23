/** The control marks the print production equipment reads, drawn with pdf-lib on an optional-content layer ("Control marks"). */
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef, PDFString, PDFHexString, PDFOperator, PDFOperatorNames, grayscale, rgb, pushGraphicsState, popGraphicsState, type PDFFont, type PDFPage } from 'pdf-lib';
import bwipjs from 'bwip-js';

/** Black for every mark: DeviceGray 0, so it is black toner only whatever the RIP does with RGB. */
const BLACK = grayscale(0);

export const MM = 72 / 25.4;
/** The page size the settings start with (A4); the Settings page can change it, so this is only the first-time value and the fallback when a caller gives none. */
export const DEFAULT_PAGE_MM = { widthMm: 210, heightMm: 297 };
export interface PageSize { widthMm: number; heightMm: number }

export interface MarkSettings {
  seq: { fontPt: number; leftMm: number; topMm: number; widthMm: number; heightMm: number };
  dm: { leftMm: number; topMm: number; widthMm: number; heightMm: number };
  dot: { xMm: number; yMm: number; diameterMm: number };
  /** The MRDF page codes, drawn on the front of every sheet when the customer uses MRDF. */
  mrdf?: { dm: { leftMm: number; topMm: number; widthMm: number; heightMm: number }; ocr: { fontPt: number; leftMm: number; topMm: number; widthMm: number; heightMm: number } };
}

/** "Right("00000" & code; 5)": the last `n` characters, zero-padded on the left. */
export const rightPad = (v: number | string, n: number): string => `00000000000000000000${v}`.slice(-n);
/** Text printed in the address window: batch code and sequence, e.g. 1042/000123. */
export const sequenceText = (batchCode: number, seq: number): string => `${batchCode}/${rightPad(seq, 6)}`;
/** The window Data Matrix: 5 digits of batch code, 6 of sequence, then 00000. The first 11 characters are the bookmark. */
export const dataMatrixText = (batchCode: number, seq: number): string => `${rightPad(batchCode, 5)}${rightPad(seq, 6)}00000`;

const require = createRequire(import.meta.url);
export async function loadOcrbFont(): Promise<Uint8Array> {
  // bwip-js does not export its fonts folder, so find the package root from its entry point
  const entry: string = require.resolve('bwip-js');
  const marker = `${sep}bwip-js${sep}`;
  const root = entry.slice(0, entry.lastIndexOf(marker) + marker.length - 1);
  return new Uint8Array(await readFile(join(root, 'fonts', 'OCRB7.ttf')));
}

/** The Data Matrix as filled rectangles (vector, so it prints crisply): [x, y, w, h] in modules, y from the top, horizontal runs merged. */
export function dataMatrixRects(text: string): { size: number; rects: [number, number, number, number][] } {
  const [r] = bwipjs.raw({ bcid: 'datamatrix', text }) as unknown as [{ pixs: number[]; pixx: number; pixy: number }];
  const rects: [number, number, number, number][] = [];
  for (let y = 0; y < r.pixy; y++) {
    let x = 0;
    while (x < r.pixx) {
      if (!r.pixs[y * r.pixx + x]) { x++; continue; }
      const start = x;
      while (x < r.pixx && r.pixs[y * r.pixx + x]) x++;
      rects.push([start, y, x - start, 1]);
    }
  }
  return { size: Math.max(r.pixx, r.pixy), rects };
}

/** Creates the "Control marks" layer once per document. */
export function addMarksLayer(doc: PDFDocument): PDFRef {
  const ocg = doc.context.register(doc.context.obj({ Type: 'OCG', Name: PDFString.of('Control marks') }));
  const ocgs = doc.context.obj([ocg]);
  const d = doc.context.obj({ Order: [ocg], ON: [ocg], AS: [] });
  doc.catalog.set(PDFName.of('OCProperties'), doc.context.obj({ OCGs: ocgs, D: d }));
  return ocg;
}

const PROP_NAME = 'CtrlMarks';
/** Starts marked content on the "Control marks" layer; the caller ends it with endLayer. */
function beginLayer(page: PDFPage, ocg: PDFRef): void {
  const res = page.node.Resources() ?? page.doc.context.obj({});
  const props = (res.lookupMaybe(PDFName.of('Properties'), PDFDict) ?? page.doc.context.obj({})) as PDFDict;
  props.set(PDFName.of(PROP_NAME), ocg);
  res.set(PDFName.of('Properties'), props);
  page.node.set(PDFName.of('Resources'), res);
  page.pushOperators(PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [PDFName.of('OC'), PDFName.of(PROP_NAME)]), pushGraphicsState());
}
function endLayer(page: PDFPage): void { page.pushOperators(popGraphicsState(), PDFOperator.of(PDFOperatorNames.EndMarkedContent)); }

/** A square Data Matrix fitted in a box (mm from the top left of the trim box). */
function drawMatrix(page: PDFPage, text: string, box: { leftMm: number; topMm: number; widthMm: number; heightMm: number }, trim: { x: number; y: number; height: number }): void {
  const { size, rects } = dataMatrixRects(text);
  const side = Math.min(box.widthMm, box.heightMm) * MM, mod = side / size;
  const ox = trim.x + box.leftMm * MM, oy = trim.y + trim.height - box.topMm * MM;
  for (const [x, y, w, h] of rects) page.drawRectangle({ x: ox + x * mod, y: oy - (y + h) * mod, width: w * mod, height: h * mod, color: BLACK });
}

/** The MRDF codes of one sheet front: a Data Matrix and the same sheet in OCR-B, both black. */
export function drawMrdfMarks(page: PDFPage, ocg: PDFRef, font: PDFFont, m: NonNullable<MarkSettings['mrdf']>, text: { matrix: string; ocr: string },
  trim: { x: number; y: number; width: number; height: number }): void {
  beginLayer(page, ocg);
  drawMatrix(page, text.matrix, m.dm, trim);
  const o = m.ocr, tw = font.widthOfTextAtSize(text.ocr, o.fontPt), capH = font.heightAtSize(o.fontPt, { descender: false });
  page.drawText(text.ocr, { font, size: o.fontPt, color: BLACK, x: trim.x + o.leftMm * MM + (o.widthMm * MM - tw) / 2, y: trim.y + trim.height - o.topMm * MM - (o.heightMm * MM + capH) / 2 });
  endLayer(page);
}

/** Draws the marks of the first page of a mailpiece. `trim` is the page's trim box: positions are measured from its top left. */
export function drawMarks(page: PDFPage, ocg: PDFRef, font: PDFFont, m: MarkSettings, text: { sequence: string; matrix: string },
  trim: { x: number; y: number; width: number; height: number }, dotColour: 'red' | 'black'): void {
  beginLayer(page, ocg);
  const left = (mm: number): number => trim.x + mm * MM;
  const topY = (mm: number): number => trim.y + trim.height - mm * MM; // top-down to PDF coordinates

  // Window sequence number, centred in its box
  const s = m.seq;
  const tw = font.widthOfTextAtSize(text.sequence, s.fontPt);
  const capH = font.heightAtSize(s.fontPt, { descender: false });
  page.drawText(text.sequence, {
    font, size: s.fontPt, color: BLACK,
    x: left(s.leftMm) + (s.widthMm * MM - tw) / 2,
    y: topY(s.topMm) - (s.heightMm * MM + capH) / 2,
  });

  // Window Data Matrix: square, fitted in its box
  drawMatrix(page, text.matrix, m.dm, trim);

  // Pack start dot (red; black when the page is printed mono)
  page.drawCircle({ x: left(m.dot.xMm), y: topY(m.dot.yMm), size: (m.dot.diameterMm * MM) / 2, color: dotColour === 'red' ? rgb(1, 0, 0) : BLACK });

  endLayer(page);
}

/** One bookmark per mailpiece, titled with the first 11 characters of its Data Matrix, pointing at its first page. */
export function addBookmarks(doc: PDFDocument, items: { title: string; pageIndex: number }[]): void {
  if (!items.length) return;
  const pages = doc.getPages();
  const outlines = doc.context.nextRef();
  const refs = items.map(() => doc.context.nextRef());
  items.forEach((it, i) => {
    const d = doc.context.obj({
      Title: PDFHexString.fromText(it.title), Parent: outlines,
      Dest: [pages[it.pageIndex]!.ref, 'Fit'],
      ...(i > 0 ? { Prev: refs[i - 1] } : {}), ...(i < items.length - 1 ? { Next: refs[i + 1] } : {}),
    });
    doc.context.assign(refs[i]!, d);
  });
  doc.context.assign(outlines, doc.context.obj({ Type: 'Outlines', First: refs[0], Last: refs[refs.length - 1], Count: PDFNumber.of(items.length) }));
  doc.catalog.set(PDFName.of('Outlines'), outlines);
  doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
}
