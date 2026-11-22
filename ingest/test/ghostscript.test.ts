import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { cmyk, grayscale, PDFDocument, PDFName, rgb } from 'pdf-lib';
import { composeBatch } from '../src/compose/compose.js';
import { GhostscriptGrey } from '../src/compose/grey.js';
import { planBatch, type PlanMailpiece, type PlanPack } from '../src/compose/plan.js';
import { analysePageInk } from '../src/pdfInk.js';

/**
 * The greyscale conversion with the real Ghostscript. Skipped where Ghostscript is not installed (set GS_PATH if it is not on the PATH);
 * the tests that need no Ghostscript still run. Ink is measured two ways: IntelliDoc's own page analyser, and Ghostscript's inkcov device.
 */
const GS = process.env['GS_PATH'] || (process.platform === 'win32' ? 'gswin64c' : 'gs');
const haveGs = spawnSync(GS, ['--version']).error === undefined;
const havePdftotext = spawnSync('pdftotext', ['-v']).error === undefined;
const dir = mkdtempSync(join(tmpdir(), 'idoc-gs-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function png(w: number, h: number, pixel: (x: number, y: number) => [number, number, number]): Uint8Array {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer): number => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer): Buffer => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = pixel(x, y); const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

/** Four A4 pages: RGB text, a CMYK box, a colour picture, and black text on a grey box (already mono). The first has a TrimBox. */
async function colourSource(withMonoPage = true): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  const p1 = d.addPage([595.276, 841.89]); p1.drawText('Red page', { x: 100, y: 700, size: 24, color: rgb(1, 0, 0) });
  p1.setTrimBox(14.17, 14.17, 566.93, 813.55);
  d.addPage([595.276, 841.89]).drawRectangle({ x: 100, y: 500, width: 300, height: 150, color: cmyk(1, 0.2, 0, 0) });
  const p3 = d.addPage([595.276, 841.89]);
  p3.drawImage(await d.embedPng(png(64, 64, (x, y) => [x * 4, y * 4, 128])), { x: 100, y: 400, width: 256, height: 256 });
  if (!withMonoPage) return d.save();
  const p4 = d.addPage([595.276, 841.89]);
  p4.drawRectangle({ x: 100, y: 500, width: 300, height: 100, color: grayscale(0.7) }); p4.drawText('Black text', { x: 100, y: 700, size: 24, color: rgb(0, 0, 0) });
  return d.save();
}

/** Coverage per page from Ghostscript's inkcov device: [c, m, y, k]. */
function inkcov(bytes: Uint8Array): number[][] {
  const f = join(dir, `cov-${Math.random().toString(36).slice(2)}.pdf`); writeFileSync(f, bytes);
  const out = execFileSync(GS, ['-q', '-dBATCH', '-dNOPAUSE', '-sDEVICE=inkcov', '-o', '-', f], { encoding: 'utf8' });
  return out.split('\n').filter((l) => /CMYK OK/.test(l)).map((l) => l.trim().split(/\s+/).slice(0, 4).map(Number));
}

describe('GhostscriptGrey without Ghostscript', () => {
  it('says plainly when the executable is not found', async () => {
    await expect(new GhostscriptGrey('no-such-ghostscript-exe').convert(await colourSource())).rejects.toThrow(/Ghostscript was not found \(no-such-ghostscript-exe\).*GS_PATH/);
  });
});

describe.skipIf(!haveGs)('GhostscriptGrey with the real Ghostscript', { timeout: 60_000 }, () => {
  it('turns every colour into grey and keeps the page count, sizes and TrimBox', async () => {
    const src = await colourSource();
    expect(await analysePageInk(src)).toEqual(['colour', 'colour', 'colour', 'mono']);
    expect(inkcov(src).slice(0, 3).every(([c, m, y]) => c! + m! + y! > 0)).toBe(true); // really coloured to start with
    const out = await new GhostscriptGrey(GS).convert(src);
    expect(await analysePageInk(out)).toEqual(['mono', 'mono', 'mono', 'mono']);
    for (const [c, m, y] of inkcov(out)) expect([c, m, y]).toEqual([0, 0, 0]);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(4);
    for (const p of doc.getPages()) { expect(p.getWidth()).toBeCloseTo(595.276, 1); expect(p.getHeight()).toBeCloseTo(841.89, 1); }
    const tb = doc.getPage(0).getTrimBox();
    expect([tb.x, tb.y, tb.width, tb.height].map((v) => Math.round(v * 100) / 100)).toEqual([14.17, 14.17, 566.93, 813.55]);
  });

  it('greys a PDF made by Ghostscript itself, with a CMYK shading and RGB text (features pdf-lib cannot write)', async () => {
    const ps = join(dir, 'shade.ps'); const pdf = join(dir, 'shade.pdf');
    writeFileSync(ps, `%!PS
<< /PageSize [595 842] >> setpagedevice
<< /ShadingType 2 /ColorSpace /DeviceCMYK /Coords [50 0 500 0] /Function << /FunctionType 2 /Domain [0 1] /C0 [1 0 0 0] /C1 [0 1 1 0] /N 1 >> /Extend [true true] >> shfill
/Helvetica findfont 30 scalefont setfont 1 0 0 setrgbcolor 100 400 moveto (Shaded) show
showpage
`);
    execFileSync(GS, ['-q', '-dBATCH', '-dNOPAUSE', '-sDEVICE=pdfwrite', `-sOutputFile=${pdf}`, ps]);
    const src = new Uint8Array(execFileSync('node', ['-e', `process.stdout.write(require('fs').readFileSync(${JSON.stringify(pdf)}))`], { maxBuffer: 1 << 24 }));
    expect(await analysePageInk(src)).toEqual(['colour']);
    const out = await new GhostscriptGrey(GS).convert(src);
    expect(await analysePageInk(out)).toEqual(['mono']);
    for (const [c, m, y] of inkcov(out)) expect([c, m, y]).toEqual([0, 0, 0]);
  });

  it('fails with Ghostscript\'s own message for a file that is not a PDF', async () => {
    await expect(new GhostscriptGrey(GS).convert(new TextEncoder().encode('this is not a PDF'))).rejects.toThrow(/Ghostscript (failed|returned)/);
  });

  it('keeps the text readable after the conversion', async () => {
    if (!havePdftotext) return;
    const out = await new GhostscriptGrey(GS).convert(await colourSource());
    const f = join(dir, 'text.pdf'); writeFileSync(f, out);
    expect(execFileSync('pdftotext', ['-f', '1', '-l', '1', f, '-'], { encoding: 'utf8' })).toContain('Red page');
    expect(execFileSync('pdftotext', ['-f', '4', '-l', '4', f, '-'], { encoding: 'utf8' })).toContain('Black text');
  });

  it('composes a whole print file with it: colour pages are grey, the marks are black only, the metadata is intact', async () => {
    const pack = (id: number, start: number, end: number): PlanPack => ({ packId: id, startPage: start, endPage: end, submittingAccountId: 1, releaseDate: new Date('2026-01-01'), documentSequence: 99, forceMono: false });
    const mps: PlanMailpiece[] = [{ mailpieceId: 1, sequenceNumber: null, weightBandG: 100, isCancelled: false, colourMode: 'ALL_MONO', isAddressMatching: false, packs: [pack(1, 1, 2)] },
      { mailpieceId: 2, sequenceNumber: null, weightBandG: 250, isCancelled: false, colourMode: 'ALL_MONO', isAddressMatching: false, packs: [pack(2, 3, 3)] }];
    const plan = planBatch(mps, { maxPagesPerPdf: 100, runSheetPages: 0 });
    const marks = { seq: { fontPt: 8, leftMm: 20, topMm: 40, widthMm: 45, heightMm: 4 }, dm: { leftMm: 20, topMm: 30, widthMm: 8, heightMm: 8 }, dot: { xMm: 205.5, yMm: 269, diameterMm: 2 } };
    const [f] = await composeBatch({ batchCode: 1042, source: await colourSource(false), runSheet: null, plan, marks, grey: new GhostscriptGrey(GS), fileName: (n) => `1042_${n}.pdf`, keywords: ['imposition:SRA4'] });
    const ink = await analysePageInk(f!.bytes);
    expect(ink.every((k) => k === 'mono' || k === 'blank')).toBe(true);
    expect(ink.filter((k) => k === 'mono').length).toBe(3);
    // every colour page was greyed, and the marks are black only: no cyan, magenta or yellow anywhere in the file
    for (const [c, m, y] of inkcov(f!.bytes)) expect([c, m, y]).toEqual([0, 0, 0]);
    const doc = await PDFDocument.load(f!.bytes);
    expect(doc.getPageCount()).toBe(f!.pageCount);
    expect(doc.getKeywords()).toBe('imposition:SRA4');
    expect(doc.getTitle()).toBe('1042_1.pdf');
    expect(doc.catalog.lookup(PDFName.of('OCProperties'))).toBeDefined(); // the "Control marks" layer survives
  });
});

describe.skipIf(!haveGs)('what the composer leaves alone', { timeout: 60_000 }, () => {
  it('does not convert a page that is already pure black, so its RGB black stays RGB', async () => {
    // Documented behaviour (docs/pdf-composition.md): only colour pages go through Ghostscript.
    const d = await PDFDocument.create(); d.addPage([595.276, 841.89]).drawText('Black text', { x: 100, y: 700, size: 24, color: rgb(0, 0, 0) });
    const src = await d.save();
    expect(await analysePageInk(src)).toEqual(['mono']);
    const [c, m, y] = inkcov(src)[0]!; expect(c! + m! + y!).toBeGreaterThan(0); // Ghostscript reads RGB black as a mix of all three
  });
});
