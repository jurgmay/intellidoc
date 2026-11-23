import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { buildMarksPreviewPdf, GhostscriptPng, renderMarksPreview, type PngRenderer } from '../src/compose/preview.js';
import { DEFAULT_PAGE_MM, MM, rotatedTextOrigin } from '../src/compose/marks.js';

const marks = { seq: { fontPt: 8, leftMm: 20, topMm: 40, widthMm: 45, heightMm: 4 }, dm: { leftMm: 20, topMm: 30, widthMm: 8, heightMm: 8 }, dot: { xMm: 205.5, yMm: 269, diameterMm: 2 },
  mrdf: { dm: { leftMm: 10, topMm: 10, widthMm: 8, heightMm: 8 }, ocr: { fontPt: 8.2, leftMm: 20, topMm: 10, widthMm: 30, heightMm: 4 } } };
const win = { leftMm: 15, topMm: 25, widthMm: 90, heightMm: 35 };
const GS = process.env['GS_PATH'] || (process.platform === 'win32' ? 'gswin64c' : 'gs');
const haveGs = spawnSync(GS, ['--version']).error === undefined;

describe('the marks preview page', () => {
  it('is one page of the size in the settings, not a fixed A4', async () => {
    for (const size of [DEFAULT_PAGE_MM, { widthMm: 297, heightMm: 420 }]) {
      const doc = await PDFDocument.load(await buildMarksPreviewPdf('window', marks, win, size));
      expect(doc.getPageCount()).toBe(1);
      expect(doc.getPage(0).getWidth()).toBeCloseTo(size.widthMm * MM, 1);
      expect(doc.getPage(0).getHeight()).toBeCloseTo(size.heightMm * MM, 1);
    }
  });
  it('draws the marks with the composer (a Control marks layer) for the first page and the MRDF page', async () => {
    for (const which of ['window', 'mrdf'] as const) {
      const doc = await PDFDocument.load(await buildMarksPreviewPdf(which, marks, win, DEFAULT_PAGE_MM));
      expect(doc.catalog.lookup(PDFName.of('OCProperties'), PDFDict).has(PDFName.of('OCGs'))).toBe(true);
    }
  });
  it('needs the MRDF settings for the MRDF page', async () => {
    await expect(buildMarksPreviewPdf('mrdf', { ...marks, mrdf: undefined }, win, DEFAULT_PAGE_MM)).rejects.toThrow(/MRDF/);
  });
  it('hands the PDF to the renderer and returns its PNG', async () => {
    const seen: number[] = [];
    const fake: PngRenderer = { png: async (pdf) => { seen.push((await PDFDocument.load(pdf)).getPageCount()); return new Uint8Array([1, 2, 3]); } };
    expect(await renderMarksPreview('window', marks, win, DEFAULT_PAGE_MM, fake)).toEqual(new Uint8Array([1, 2, 3]));
    expect(seen).toEqual([1]);
  });
  it.skipIf(!haveGs)('renders a real PNG with Ghostscript, as wide as the page at the chosen resolution', async () => {
    const png = await renderMarksPreview('window', marks, win, DEFAULT_PAGE_MM, new GhostscriptPng(GS, 100));
    expect([...png.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(png.buffer, png.byteOffset);
    expect(view.getUint32(16)).toBe(Math.round((210 / 25.4) * 100)); // width, in pixels
    expect(view.getUint32(20)).toBe(Math.round((297 / 25.4) * 100));
  });
  it('says so when Ghostscript is not installed', async () => {
    await expect(new GhostscriptPng('definitely-not-gs').png(await buildMarksPreviewPdf('window', marks, win, DEFAULT_PAGE_MM))).rejects.toThrow(/Ghostscript was not found/);
  });
});

describe('the MRDF OCR code rotation', () => {
  const tw = 30, capH = 4, cx = 100, cy = 200;
  /** The middle of the text once drawn: from its start along the (turned) baseline by half its width, then up the (turned) cap height by half. */
  const middle = (deg: number) => {
    const o = rotatedTextOrigin(cx, cy, tw, capH, deg), a = (-deg * Math.PI) / 180;
    return { x: o.x + (tw / 2) * Math.cos(a) - (capH / 2) * Math.sin(a), y: o.y + (tw / 2) * Math.sin(a) + (capH / 2) * Math.cos(a), end: { x: o.x + tw * Math.cos(a), y: o.y + tw * Math.sin(a) }, start: o };
  };
  it('keeps the text centred on the box centre at 0, 90, 180 and 270', () => {
    for (const deg of [0, 90, 180, 270]) { const m = middle(deg); expect(m.x).toBeCloseTo(cx, 9); expect(m.y).toBeCloseTo(cy, 9); }
  });
  it('turns clockwise: 90 reads downwards, 180 upside down, 270 upwards', () => {
    const d = (deg: number) => { const m = middle(deg); return { dx: Math.sign(Math.round(m.end.x - m.start.x)), dy: Math.sign(Math.round(m.end.y - m.start.y)) }; };
    expect(d(0)).toEqual({ dx: 1, dy: 0 });
    expect(d(90)).toEqual({ dx: 0, dy: -1 }); // PDF y points up, so downwards is negative
    expect(d(180)).toEqual({ dx: -1, dy: 0 });
    expect(d(270)).toEqual({ dx: 0, dy: 1 });
  });
  it('is drawn in the preview, with the box turned too', async () => {
    for (const rotationDeg of [0, 90, 180, 270]) {
      const pdf = await buildMarksPreviewPdf('mrdf', { ...marks, mrdf: { ...marks.mrdf, ocr: { ...marks.mrdf.ocr, rotationDeg } } }, win, DEFAULT_PAGE_MM);
      expect((await PDFDocument.load(pdf)).getPageCount()).toBe(1);
    }
  });
});
