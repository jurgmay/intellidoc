import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PDFDict, PDFDocument, PDFName, PDFString, PDFHexString, PDFArray, rgb } from 'pdf-lib';
import { assignSequences, isMonoPage, orderPacks, pagesToGrey, planBatch, type PlanMailpiece, type PlanPack } from '../src/compose/plan.js';
import { dataMatrixText, rightPad, sequenceText } from '../src/compose/marks.js';
import { composeBatch } from '../src/compose/compose.js';
import { ghostscriptArgs, type GreyConverter } from '../src/compose/grey.js';
import { analysePageInk } from '../src/pdfInk.js';

const pack = (id: number, start: number, end: number, o: Partial<PlanPack> = {}): PlanPack =>
  ({ packId: id, startPage: start, endPage: end, submittingAccountId: 1, releaseDate: new Date('2026-01-01'), documentSequence: 99, forceMono: false, ...o });
const mp = (id: number, packs: PlanPack[], o: Partial<PlanMailpiece> = {}): PlanMailpiece =>
  ({ mailpieceId: id, sequenceNumber: null, weightBandG: 100, isCancelled: false, colourMode: 'ORIGINAL', isAddressMatching: false, packs, ...o });

describe('sequence numbers', () => {
  it('are given lightest first, then in source order; unknown weights last; cancelled mailpieces get none', () => {
    const s = assignSequences([mp(1, [pack(1, 1, 2)], { weightBandG: 250 }), mp(2, [pack(2, 3, 4)], { weightBandG: 100 }), mp(3, [pack(3, 5, 6)], { weightBandG: null }),
      mp(4, [pack(4, 7, 8)], { weightBandG: 100 }), mp(5, [pack(5, 9, 9)], { isCancelled: true })]);
    expect([...s]).toEqual([[2, 1], [4, 2], [1, 3], [3, 4]]);
  });
  it('are kept when the batch is composed again; new mailpieces follow the highest', () => {
    const s = assignSequences([mp(1, [pack(1, 1, 2)], { sequenceNumber: 7 }), mp(2, [pack(2, 3, 4)]), mp(3, [pack(3, 5, 6)], { sequenceNumber: 2 })]);
    expect([...s]).toEqual([[2, 8]]);
  });
});

describe('colour modes', () => {
  it('say which pages are mono', () => {
    const pages = (mode: Parameters<typeof isMonoPage>[0], force = false) => [[0, 1], [0, 2], [1, 1], [1, 2]].map(([pi, n]) => isMonoPage(mode, force, pi!, n!));
    expect(pages('ORIGINAL')).toEqual([false, false, false, false]);
    expect(pages('ALL_MONO')).toEqual([true, true, true, true]);
    expect(pages('FIRST_PACK_PAGE')).toEqual([false, true, false, true]);
    expect(pages('FIRST_MAILPIECE_PAGE')).toEqual([false, true, true, true]);
    expect(pages('ORIGINAL', true)).toEqual([true, true, true, true]); // the pack's own Mono option
  });
});

describe('pack order', () => {
  it('is owner, release date, source order; with address matching it is the document sequence', () => {
    const a = pack(1, 1, 1, { submittingAccountId: 2, documentSequence: 1 }), b = pack(2, 2, 2, { submittingAccountId: 1, releaseDate: new Date('2026-02-01'), documentSequence: 3 });
    const c = pack(3, 3, 3, { submittingAccountId: 1, releaseDate: new Date('2026-01-01'), documentSequence: 2 });
    expect(orderPacks(mp(1, [a, b, c])).map((p) => p.packId)).toEqual([3, 2, 1]);
    expect(orderPacks(mp(1, [a, b, c], { isAddressMatching: true })).map((p) => p.packId)).toEqual([1, 3, 2]);
  });
});

describe('planBatch', () => {
  it('pads odd packs, puts the run sheet first and records each pack output pages', () => {
    const plan = planBatch([mp(1, [pack(1, 1, 3), pack(2, 4, 4)], { weightBandG: 250 }), mp(2, [pack(3, 5, 6)], { weightBandG: 100 })], { maxPagesPerPdf: 100, runSheetPages: 2 });
    const [s] = plan.segments;
    expect(plan.segments).toHaveLength(1);
    expect(s!.pages.map((p) => p.kind[0])).toEqual(['r', 'r', 's', 's', 's', 's', 's', 'b', 's', 'b']);
    expect(s!.mailpieces).toEqual([{ mailpieceId: 2, sequenceNumber: 1, outputPage: 3 }, { mailpieceId: 1, sequenceNumber: 2, outputPage: 5 }]);
    expect(s!.packs).toEqual([{ packId: 3, outputStart: 3, outputEnd: 4 }, { packId: 1, outputStart: 5, outputEnd: 8 }, { packId: 2, outputStart: 9, outputEnd: 10 }]);
    expect(s!.pages.filter((p) => p.mailpieceStart).map((p) => p.sourcePage)).toEqual([5, 1]);
  });
  it('closes a file after the mailpiece that takes it past the limit', () => {
    const mps = [1, 2, 3, 4].map((i) => mp(i, [pack(i, i * 2 - 1, i * 2)], { weightBandG: i })); // 2 pages each
    const plan = planBatch(mps, { maxPagesPerPdf: 5, runSheetPages: 0 });
    expect(plan.segments.map((s) => s.mailpieces.map((m) => m.mailpieceId))).toEqual([[1, 2, 3], [4]]); // 6 pages > 5, so the file ran over by one mailpiece
    expect(plan.segments[1]!.mailpieces[0]!.outputPage).toBe(1);
  });
  it('puts the run sheet in the first file only and counts it', () => {
    const mps = [1, 2, 3].map((i) => mp(i, [pack(i, i * 2 - 1, i * 2)], { weightBandG: i }));
    const plan = planBatch(mps, { maxPagesPerPdf: 4, runSheetPages: 2 });
    expect(plan.segments.map((s) => s.pages.length)).toEqual([6, 2]); // run sheet + mailpiece 1 = 4 (not over), + mailpiece 2 = 6 > 4: closed after it; mailpiece 3 starts file 2 with no run sheet
  });
  it('leaves out cancelled mailpieces and gives an empty plan for nothing to print', () => {
    expect(planBatch([mp(1, [pack(1, 1, 2)], { isCancelled: true })], { maxPagesPerPdf: 10, runSheetPages: 2 }).segments).toEqual([]);
  });
  it('lists the source pages to grey once', () => {
    const plan = planBatch([mp(1, [pack(1, 1, 3), pack(2, 4, 4)], { colourMode: 'FIRST_MAILPIECE_PAGE' })], { maxPagesPerPdf: 100, runSheetPages: 0 });
    expect(pagesToGrey(plan)).toEqual([2, 3, 4]);
  });
});

describe('mark text', () => {
  it('follows the FileMaker formulas', () => {
    expect(rightPad(42, 6)).toBe('000042');
    expect(sequenceText(1042, 123)).toBe('1042/000123');
    expect(dataMatrixText(1042, 123)).toBe('01042000123' + '00000');
    expect(dataMatrixText(1234567, 7)).toBe('34567' + '000007' + '00000'); // the last 5 digits of the batch code
  });
});

describe('ghostscriptArgs', () => {
  it('converts everything to DeviceGray without a shell', () => {
    const a = ghostscriptArgs('in.pdf', 'out.pdf');
    expect(a).toContain('-sColorConversionStrategy=Gray');
    expect(a).toContain('-sOutputFile=out.pdf');
    expect(a[a.length - 1]).toBe('in.pdf');
  });
});

// ---- the composer ----
async function sourcePdf(colours: ('red' | 'black')[]): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  colours.forEach((c, i) => { const p = d.addPage([595.276, 841.89]); p.drawText(`Page ${i + 1}`, { x: 100, y: 700, size: 20, color: c === 'red' ? rgb(1, 0, 0) : rgb(0, 0, 0) }); });
  return d.save();
}
async function runSheetPdf(pages: number): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([595.276, 841.89]).drawText(`Run sheet ${i + 1}`, { x: 100, y: 700, size: 20, color: rgb(0, 0, 0) });
  return d.save();
}
const marks = { seq: { fontPt: 8, leftMm: 20, topMm: 40, widthMm: 45, heightMm: 4 }, dm: { leftMm: 20, topMm: 30, widthMm: 8, heightMm: 8 }, dot: { xMm: 205.5, yMm: 269, diameterMm: 2 } };
class FakeGrey implements GreyConverter { seen: number[] = []; async convert(pdf: Uint8Array) { this.seen.push((await PDFDocument.load(pdf)).getPageCount()); return pdf; } }
const hasPdftotext = spawnSync('pdftotext', ['-v']).error === undefined;

describe('composeBatch', () => {
  const mailpieces = [mp(1, [pack(1, 1, 3), pack(2, 4, 4)], { weightBandG: 250, colourMode: 'FIRST_MAILPIECE_PAGE' }), mp(2, [pack(3, 5, 6)], { weightBandG: 100, colourMode: 'FIRST_MAILPIECE_PAGE' })];
  const run = async (g: GreyConverter | null, mode: 'FIRST_MAILPIECE_PAGE' | 'ALL_MONO' = 'FIRST_MAILPIECE_PAGE') => {
    const mps = mailpieces.map((m) => ({ ...m, colourMode: mode }));
    const plan = planBatch(mps, { maxPagesPerPdf: 100, runSheetPages: 2 });
    return composeBatch({ batchCode: 1042, source: await sourcePdf(['red', 'black', 'red', 'red', 'black', 'red']), runSheet: await runSheetPdf(1), plan, marks, grey: g, fileName: (n) => `1042_${n}.pdf`, keywords: ['imposition:SRA4'] });
  };

  it('builds the print file: run sheet, padded packs, in sequence order', async () => {
    const g = new FakeGrey();
    const [f] = await run(g);
    expect(f).toMatchObject({ fileName: '1042_1.pdf', pageCount: 10, mailpieceCount: 2, firstSequence: 1, lastSequence: 2 });
    expect(g.seen).toEqual([3]); // only the colour pages that must be mono: source pages 3, 4 and 6
    const doc = await PDFDocument.load(f!.bytes);
    expect(doc.getPageCount()).toBe(10);
    const ink = await analysePageInk(f!.bytes);
    expect(ink[1]).toBe('blank'); // the blank page that pads the one-page run sheet
  });

  it('carries the metadata, the Control marks layer and one bookmark per mailpiece', async () => {
    const [f] = await run(new FakeGrey());
    const doc = await PDFDocument.load(f!.bytes);
    expect(doc.getTitle()).toBe('1042_1.pdf');
    expect(doc.getKeywords()).toBe('imposition:SRA4');
    const ocp = doc.catalog.lookup(PDFName.of('OCProperties'), PDFDict);
    const ocg = (ocp.lookup(PDFName.of('OCGs'), PDFArray)).lookup(0, PDFDict);
    expect((ocg.lookup(PDFName.of('Name'), PDFString) as PDFString).decodeText()).toBe('Control marks');
    const outlines = doc.catalog.lookup(PDFName.of('Outlines'), PDFDict);
    const titles: string[] = [];
    for (let cur = outlines.lookup(PDFName.of('First'), PDFDict) as PDFDict | undefined; cur; cur = cur.lookupMaybe(PDFName.of('Next'), PDFDict)) titles.push((cur.lookup(PDFName.of('Title'), PDFHexString) as PDFHexString).decodeText());
    expect(titles).toEqual(['01042000001', '01042000002']);
    expect(f!.bytes.length).toBeGreaterThan(0);
  });

  it.skipIf(!hasPdftotext)('prints the sequence number on the first page of each mailpiece only', async () => {
    const [f] = await run(new FakeGrey());
    const dir = mkdtempSync(join(tmpdir(), 'idoc-compose-')); const file = join(dir, 'o.pdf'); writeFileSync(file, f!.bytes);
    const page = (n: number) => execFileSync('pdftotext', ['-f', String(n), '-l', String(n), file, '-'], { encoding: 'utf8' });
    expect(page(3)).toContain('1042/000001'); // mailpiece 2 is lighter so it is number 1 and comes first, after the 2 run sheet pages
    expect(page(3)).toContain('Page 5');
    expect(page(4)).not.toContain('1042/');
    expect(page(5)).toContain('1042/000002');
    expect(page(5)).toContain('Page 1');
    expect(page(1)).toContain('Run sheet 1');
  });

  it('draws the pack dot red on a colour page and black on a mono page', async () => {
    const [mono] = await run(new FakeGrey(), 'ALL_MONO');
    const [orig] = await run(new FakeGrey(), 'FIRST_MAILPIECE_PAGE');
    expect((await analysePageInk(mono!.bytes))[2]).toBe('mono'); // page 3: black source text, black marks
    expect((await analysePageInk(orig!.bytes))[2]).toBe('colour'); // page 3 stays as printed, the dot is red
  });

  it('asks for a greyscale converter only when a colour page has to be mono', async () => {
    await expect(run(null)).rejects.toThrow(/Ghostscript/);
    const plan = planBatch([mp(1, [pack(1, 2, 2)])], { maxPagesPerPdf: 10, runSheetPages: 0 });
    const [f] = await composeBatch({ batchCode: 1, source: await sourcePdf(['red', 'black']), runSheet: null, plan, marks, grey: null, fileName: () => 'x.pdf' });
    expect(f!.pageCount).toBe(2); // a black page, padded, no conversion needed
  });

  it('rejects a run sheet that does not match what the plan reserved', async () => {
    const plan = planBatch([mp(1, [pack(1, 1, 2)])], { maxPagesPerPdf: 10, runSheetPages: 2 });
    await expect(composeBatch({ batchCode: 1, source: await sourcePdf(['black', 'black']), runSheet: await runSheetPdf(4), plan, marks, grey: null, fileName: () => 'x.pdf' })).rejects.toThrow(/run sheet/);
  });
});
