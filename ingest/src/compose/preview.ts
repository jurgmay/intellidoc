/**
 * A picture of where the control marks fall on a page, for the Settings page. The page is drawn with the same functions that make the print
 * files (drawMarks, drawMrdfMarks), on a blank page with the envelope window, the boxes the marks are fitted in and a 10 mm grid, then
 * Ghostscript turns it into a PNG. The extra guides are preview only and never reach a print file.
 */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, StandardFonts, grayscale, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { addMarksLayer, dataMatrixText, drawMarks, drawMrdfMarks, loadOcrbFont, MM, sequenceText, type MarkSettings, type PageSize } from './marks.js';
import { mrdfPageCodes } from './mrdf.js';

const run = promisify(execFile);

export interface WindowSettings { leftMm: number; topMm: number; widthMm: number; heightMm: number }
/** window: the first page of a mailpiece (sequence number, Data Matrix, pack start dot). mrdf: the MRDF page codes on the front of a sheet. */
export type PreviewPage = 'window' | 'mrdf';

/** Sample numbers, so the marks are drawn the way they print: batch 1042, mailpiece 123. */
const SAMPLE = { batchCode: 1042, sequence: 123 };

const GRID = grayscale(0.88), GRID_STRONG = grayscale(0.7), GUIDE_TEXT = grayscale(0.45);
const WINDOW_FILL = rgb(0.86, 0.93, 1), WINDOW_LINE = rgb(0.2, 0.45, 0.8), BOX_LINE = rgb(0.93, 0.55, 0.1);

interface Frame { left: number; bottom: number; height: number }
/** A box given in mm from the top left of the page, as a PDF rectangle. */
function rect(f: Frame, b: { leftMm: number; topMm: number; widthMm: number; heightMm: number }): { x: number; y: number; width: number; height: number } {
  return { x: f.left + b.leftMm * MM, y: f.bottom + f.height - (b.topMm + b.heightMm) * MM, width: b.widthMm * MM, height: b.heightMm * MM };
}

function drawGrid(page: PDFPage, f: Frame, font: PDFFont, size: PageSize): void {
  const w = size.widthMm, h = size.heightMm;
  for (let mm = 0; mm <= w; mm += 10) {
    page.drawLine({ start: { x: f.left + mm * MM, y: f.bottom }, end: { x: f.left + mm * MM, y: f.bottom + f.height }, thickness: mm % 50 === 0 ? 0.4 : 0.2, color: mm % 50 === 0 ? GRID_STRONG : GRID });
    if (mm % 50 === 0 && mm > 0) page.drawText(String(mm), { x: f.left + mm * MM + 1.5, y: f.bottom + f.height - 7, size: 6, font, color: GUIDE_TEXT });
  }
  for (let mm = 0; mm <= h; mm += 10) {
    page.drawLine({ start: { x: f.left, y: f.bottom + f.height - mm * MM }, end: { x: f.left + w * MM, y: f.bottom + f.height - mm * MM }, thickness: mm % 50 === 0 ? 0.4 : 0.2, color: mm % 50 === 0 ? GRID_STRONG : GRID });
    if (mm % 50 === 0 && mm > 0) page.drawText(String(mm), { x: f.left + 1.5, y: f.bottom + f.height - mm * MM + 1.5, size: 6, font, color: GUIDE_TEXT });
  }
}

function outline(page: PDFPage, r: ReturnType<typeof rect>): void {
  page.drawRectangle({ ...r, borderColor: BOX_LINE, borderWidth: 0.4, borderDashArray: [2, 1.5] });
}

/** The preview as a one-page PDF of the given page size (the trim box is the whole page). */
export async function buildMarksPreviewPdf(which: PreviewPage, marks: MarkSettings, win: WindowSettings, size: PageSize): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const ocrb = await doc.embedFont(await loadOcrbFont(), { subset: true });
  const guide = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([size.widthMm * MM, size.heightMm * MM]);
  const trim = { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() };
  const frame: Frame = { left: 0, bottom: 0, height: page.getHeight() };

  drawGrid(page, frame, guide, size);
  const ocg = addMarksLayer(doc);
  let caption: string;
  if (which === 'window') {
    page.drawRectangle({ ...rect(frame, win), color: WINDOW_FILL, borderColor: WINDOW_LINE, borderWidth: 0.8 });
    page.drawText('Envelope window', { x: rect(frame, win).x + 3, y: rect(frame, win).y + rect(frame, win).height - 9, size: 6.5, font: guide, color: WINDOW_LINE });
    outline(page, rect(frame, { leftMm: marks.seq.leftMm, topMm: marks.seq.topMm, widthMm: marks.seq.widthMm, heightMm: marks.seq.heightMm }));
    const side = Math.min(marks.dm.widthMm, marks.dm.heightMm);
    outline(page, rect(frame, { leftMm: marks.dm.leftMm, topMm: marks.dm.topMm, widthMm: side, heightMm: side }));
    drawMarks(page, ocg, ocrb, marks, { sequence: sequenceText(SAMPLE.batchCode, SAMPLE.sequence), matrix: dataMatrixText(SAMPLE.batchCode, SAMPLE.sequence) }, trim, 'red');
    caption = 'First page of a mailpiece';
  } else {
    if (!marks.mrdf) throw new Error('The MRDF page codes are not set');
    const m = marks.mrdf;
    const side = Math.min(m.dm.widthMm, m.dm.heightMm);
    outline(page, rect(frame, { leftMm: m.dm.leftMm, topMm: m.dm.topMm, widthMm: side, heightMm: side }));
    outline(page, rect(frame, m.ocr));
    drawMrdfMarks(page, ocg, ocrb, m, mrdfPageCodes(SAMPLE.batchCode, SAMPLE.sequence, 1, 2), trim);
    caption = 'Front of a sheet, MRDF page codes';
  }
  page.drawText(`${caption}. Sample data: batch ${SAMPLE.batchCode}, mailpiece ${SAMPLE.sequence}. Grid every 10 mm from the top left of the page; orange dashes are the boxes the marks are fitted in.`,
    { x: 8, y: 8, size: 5.5, font: guide, color: GUIDE_TEXT });
  return doc.save();
}

/** Turns the first page of a PDF into a PNG. */
export interface PngRenderer { png(pdf: Uint8Array): Promise<Uint8Array> }

export class GhostscriptPng implements PngRenderer {
  /** `GS_PATH` names the executable (gswin64c on Windows, gs elsewhere), the same as for the greyscale conversion. */
  constructor(private readonly exe: string = process.env['GS_PATH'] || (process.platform === 'win32' ? 'gswin64c' : 'gs'), private readonly dpi = 110) {}

  async png(pdf: Uint8Array): Promise<Uint8Array> {
    const dir = await mkdtemp(join(tmpdir(), 'idoc-preview-'));
    try {
      const input = join(dir, 'in.pdf'), output = join(dir, 'out.png');
      await writeFile(input, pdf);
      try {
        await run(this.exe, ['-q', '-dBATCH', '-dNOPAUSE', '-dSAFER', '-sDEVICE=png16m', `-r${this.dpi}`, '-dTextAlphaBits=4', '-dGraphicsAlphaBits=4', '-dFirstPage=1', '-dLastPage=1',
          `-sOutputFile=${output}`, input], { maxBuffer: 16 * 1024 * 1024 });
      } catch (e) {
        const err = e as NodeJS.ErrnoException & { stderr?: string };
        if (err.code === 'ENOENT') throw new Error(`Ghostscript was not found (${this.exe}). Install it, or set GS_PATH to its executable.`);
        throw new Error(`Ghostscript failed: ${(err.stderr || err.message).trim().slice(0, 500)}`);
      }
      return new Uint8Array(await readFile(output));
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
}

/** The picture itself: PNG bytes. */
export async function renderMarksPreview(which: PreviewPage, marks: MarkSettings, win: WindowSettings, size: PageSize, renderer: PngRenderer = new GhostscriptPng()): Promise<Uint8Array> {
  return renderer.png(await buildMarksPreviewPdf(which, marks, win, size));
}
