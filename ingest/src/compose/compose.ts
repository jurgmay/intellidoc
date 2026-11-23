import { PDFDocument, PDFName, PDFString, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { analysePageInk } from '../pdfInk.js';
import { pagesToGrey, type BatchPlan, type PlannedSegment } from './plan.js';
import { addBookmarks, addMarksLayer, dataMatrixText, drawMarks, drawMrdfMarks, loadOcrbFont, sequenceText, type MarkSettings } from './marks.js';
import { mailpiecePages, mrdfPageCodes } from './mrdf.js';
import type { GreyConverter } from './grey.js';

export interface ComposeInput {
  batchCode: number;
  /** The customer's PDF for the whole job. */
  source: Uint8Array;
  /** The batch's run sheet. Its page count must match plan.runSheetPages (an odd run sheet is followed by a blank page). */
  runSheet: Uint8Array | null;
  plan: BatchPlan;
  marks: MarkSettings;
  /** Needed only when a page that is in colour has to be printed mono. */
  grey: GreyConverter | null;
  /** The file name of a segment, given its number and how many segments the batch has. */
  fileName: (segmentNumber: number, segmentCount: number) => string;
  /** PDF keywords, e.g. imposition:SRA4. */
  keywords?: string[];
  /** The customer uses MRDF: every sheet front also carries the MRDF Data Matrix and OCR code (needs marks.mrdf). */
  mrdf?: boolean;
  /** Told after each print file is built (how many of how many). */
  onFile?: (done: number, total: number) => void;
  /**
   * How far through this batch (0 to 1) and what it is doing, called often enough that a bar driven by it keeps moving: reading the PDF's colour (0 to 0.2),
   * converting colour pages to grey (to 0.3), building the files (to 1), each by its own steps. The caller may thin the calls out.
   */
  onProgress?: (fraction: number, detail: string) => void;
}

export interface ComposedFile {
  segmentNumber: number; fileName: string; bytes: Uint8Array; pageCount: number;
  mailpieceCount: number; firstSequence: number | null; lastSequence: number | null;
}

type Box = { x: number; y: number; width: number; height: number };
const A4: [number, number] = [595.276, 841.89];

/** Source pages (1-based) that are in colour and have to be greyed: blank and already-mono pages are left alone. */
export async function colourPagesToGrey(source: Uint8Array, plan: BatchPlan, onProgress?: (done: number, total: number) => void): Promise<number[]> {
  const wanted = pagesToGrey(plan);
  if (!wanted.length) return [];
  const ink = await analysePageInk(source, onProgress);
  return wanted.filter((p) => ink[p - 1] === 'colour');
}

export async function composeBatch(input: ComposeInput): Promise<ComposedFile[]> {
  const src = await PDFDocument.load(input.source);
  const runDoc = input.runSheet ? await PDFDocument.load(input.runSheet) : null;
  const runPages = input.plan.segments[0]?.pages.filter((p) => p.kind === 'run-sheet').length ?? 0;
  if (runPages > 0 && !runDoc) throw new Error('The plan reserves pages for a run sheet but none was given');
  if (runDoc && runDoc.getPageCount() + (runDoc.getPageCount() % 2) !== runPages) throw new Error(`The run sheet has ${runDoc.getPageCount()} pages but the plan reserved ${runPages}`);

  // Greyscale: one conversion for the whole batch
  const say = input.onProgress ?? (() => undefined);
  say(0, 'opening the PDF');
  const toGrey = await colourPagesToGrey(input.source, input.plan, (d, t) => say(0.2 * (d / t), `checking the colour of page ${d.toLocaleString('en-GB')} of ${t.toLocaleString('en-GB')}`));
  say(0.2, 'checked the colour of the pages');
  let greyDoc: PDFDocument | null = null;
  const greyIndex = new Map<number, number>();
  if (toGrey.length) {
    if (!input.grey) throw new Error(`${toGrey.length} colour pages must be printed mono but no greyscale converter is available (install Ghostscript)`);
    const tmp = await PDFDocument.create();
    (await tmp.copyPages(src, toGrey.map((p) => p - 1))).forEach((pg, i) => { tmp.addPage(pg); greyIndex.set(toGrey[i]!, i); });
    say(0.2, `converting ${toGrey.length.toLocaleString('en-GB')} colour pages to grey`);
    greyDoc = await PDFDocument.load(await input.grey.convert(await tmp.save()));
  }
  say(0.3, 'building the files');

  const font = await loadOcrbFont();
  const files: ComposedFile[] = [];
  // The files are most of the work and each is as big as its mailpieces: share 0.3 to 1 out in proportion to them.
  const totalPieces = Math.max(1, input.plan.segments.reduce((t, s) => t + s.mailpieces.length, 0));
  let piecesDone = 0;
  for (const seg of input.plan.segments) {
    const from = 0.3 + 0.7 * (piecesDone / totalPieces), span = 0.7 * (seg.mailpieces.length / totalPieces);
    files.push(await composeSegment(input, seg, { src, runDoc, greyDoc, greyIndex, font, progress: (f, what) => say(from + span * f, `file ${files.length + 1} of ${input.plan.segments.length}: ${what}`) }));
    piecesDone += seg.mailpieces.length;
    say(0.3 + 0.7 * (piecesDone / totalPieces), `file ${files.length} of ${input.plan.segments.length} built`);
    input.onFile?.(files.length, input.plan.segments.length);
  }
  return files;
}

async function composeSegment(input: ComposeInput, seg: PlannedSegment,
  ctx: { src: PDFDocument; runDoc: PDFDocument | null; greyDoc: PDFDocument | null; greyIndex: Map<number, number>; font: Uint8Array; progress?: (fraction: number, what: string) => void }): Promise<ComposedFile> {
  const out = await PDFDocument.create();
  out.registerFontkit(fontkit);
  const fileName = input.fileName(seg.segmentNumber, input.plan.segments.length);

  // Copy what this segment needs in as few calls as possible, then place it in order
  const fromSrc: number[] = [], fromGrey: number[] = [], fromRun: number[] = [];
  let runIdx = 0;
  const where = seg.pages.map((p) => {
    if (p.kind === 'blank') return null;
    if (p.kind === 'run-sheet') return runIdx < (ctx.runDoc?.getPageCount() ?? 0) ? { from: 'run' as const, at: fromRun.push(runIdx++) - 1 } : null;
    if (p.mono && ctx.greyIndex.has(p.sourcePage!)) return { from: 'grey' as const, at: fromGrey.push(ctx.greyIndex.get(p.sourcePage!)!) - 1 };
    return { from: 'src' as const, at: fromSrc.push(p.sourcePage! - 1) - 1 };
  });
  const step = ctx.progress ?? (() => undefined);
  step(0, 'copying the pages');
  const srcPages = fromSrc.length ? await out.copyPages(ctx.src, fromSrc) : [];
  const greyPages = fromGrey.length ? await out.copyPages(ctx.greyDoc!, fromGrey) : [];
  const runPages = fromRun.length ? await out.copyPages(ctx.runDoc!, fromRun) : [];

  step(0.4, 'placing the pages');
  const placed: PDFPage[] = [];
  let last: [number, number] = A4;
  seg.pages.forEach((_, i) => {
    const w = where[i];
    let page: PDFPage;
    if (!w) page = out.addPage(last);
    else { page = out.addPage(w.from === 'src' ? srcPages[w.at]! : w.from === 'grey' ? greyPages[w.at]! : runPages[w.at]!); }
    last = [page.getWidth(), page.getHeight()];
    placed.push(page);
  });

  // Control marks and bookmarks
  const ocg = addMarksLayer(out);
  const ocrb = await out.embedFont(ctx.font, { subset: true });
  const bookmarks: { title: string; pageIndex: number }[] = [];
  let lastYield = Date.now();
  for (const [i, p] of seg.pages.entries()) {
    // A file can be thousands of pages of synchronous drawing: report and let the program breathe about every 200 ms.
    if (Date.now() - lastYield > 200) { step(0.5 + 0.4 * (i / seg.pages.length), 'adding the marks'); await new Promise((r) => setImmediate(r)); lastYield = Date.now(); }
    if (!p.mailpieceStart) continue;
    const seq = p.mailpieceStart.sequenceNumber;
    const matrix = dataMatrixText(input.batchCode, seq);
    const srcPage = ctx.src.getPage(p.sourcePage! - 1);
    const trim: Box = srcPage.getTrimBox();
    drawMarks(placed[i]!, ocg, ocrb, input.marks, { sequence: sequenceText(input.batchCode, seq), matrix }, trim, p.mono ? 'black' : 'red');
    bookmarks.push({ title: matrix.slice(0, 11), pageIndex: i });
  }
  addBookmarks(out, bookmarks);

  // MRDF codes on the front of every sheet. Packs are padded to whole sheets, so a mailpiece starts on a front and its odd pages are all source pages.
  if (input.mrdf) {
    if (!input.marks.mrdf) throw new Error('MRDF is on but the MRDF mark positions are not set');
    const pages = mailpiecePages(input.plan);
    let seq = 0, first = 0;
    seg.pages.forEach((p, i) => {
      if (p.mailpieceStart) { seq = p.mailpieceStart.sequenceNumber; first = i; }
      if (p.kind !== 'source' || seq === 0) return;
      const inPiece = i - first + 1;
      if (inPiece % 2 === 0) return;
      drawMrdfMarks(placed[i]!, ocg, ocrb, input.marks.mrdf!, mrdfPageCodes(input.batchCode, seq, inPiece, pages.get(seq)!), ctx.src.getPage(p.sourcePage! - 1).getTrimBox());
    });
  }

  // Metadata: PDF/X-4, not trapped, title = file name
  out.setTitle(fileName); out.setProducer('IntelliDoc'); out.setCreator('IntelliDoc');
  if (input.keywords?.length) out.setKeywords(input.keywords);
  const info = (out as unknown as { getInfoDict(): { set(k: PDFName, v: PDFString | PDFName): void } }).getInfoDict(); // private in the typings, public at run time
  info.set(PDFName.of('GTS_PDFXVersion'), PDFString.of('PDF/X-4'));
  info.set(PDFName.of('Trapped'), PDFName.of('False'));

  step(0.9, 'saving the file');
  const bytes = await out.save({ useObjectStreams: false });
  return {
    segmentNumber: seg.segmentNumber, fileName, bytes, pageCount: seg.pages.length, mailpieceCount: seg.mailpieces.length,
    firstSequence: seg.mailpieces[0]?.sequenceNumber ?? null, lastSequence: seg.mailpieces[seg.mailpieces.length - 1]?.sequenceNumber ?? null,
  };
}
