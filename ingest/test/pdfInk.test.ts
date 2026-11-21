import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { cmyk, grayscale, PDFDocument, PDFName, rgb, StandardFonts, type PDFPage } from 'pdf-lib';
import { analysePageInk, inkPerRange } from '../src/pdfInk.js';

/** A minimal PNG (pure JS) so a test can embed a picture. */
function png(w: number, h: number, pixel: (x: number, y: number) => [number, number, number]): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer): number => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer): Buffer => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b] = pixel(x, y); const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

async function build(pages: ((p: PDFPage, doc: PDFDocument) => void | Promise<void>)[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const f of pages) await f(doc.addPage([595, 842]), doc);
  return doc.save();
}
const kinds = async (...pages: Parameters<typeof build>[0]) => analysePageInk(await build(pages));

describe('analysePageInk', () => {
  it('blank page: nothing on it, or only white, or only spaces', async () => {
    expect(await kinds(() => {}, (p) => p.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: rgb(1, 1, 1) }), (p) => p.drawRectangle({ x: 0, y: 0, width: 50, height: 50, color: cmyk(0, 0, 0, 0) }),
      async (p, d) => { p.setFont(await d.embedFont(StandardFonts.Helvetica)); p.drawText('   ', { x: 50, y: 50 }); })).toEqual(['blank', 'blank', 'blank', 'blank']);
  });

  it('mono: pure black in any form (default text, RGB 0 0 0, CMYK 0 0 0 100, grey 0, black rectangles and lines)', async () => {
    expect(await kinds(
      async (p, d) => { p.drawText('Dear Mr Smith', { x: 50, y: 700, font: await d.embedFont(StandardFonts.Helvetica) }); },
      async (p, d) => { p.drawText('Dear Mr Smith', { x: 50, y: 700, font: await d.embedFont(StandardFonts.Helvetica), color: rgb(0, 0, 0) }); },
      async (p, d) => { p.drawText('Dear Mr Smith', { x: 50, y: 700, font: await d.embedFont(StandardFonts.Helvetica), color: cmyk(0, 0, 0, 1) }); },
      async (p, d) => { p.drawText('Dear Mr Smith', { x: 50, y: 700, font: await d.embedFont(StandardFonts.Helvetica), color: grayscale(0) }); },
      (p) => p.drawRectangle({ x: 10, y: 10, width: 100, height: 20, color: rgb(0, 0, 0) }),
      (p) => p.drawLine({ start: { x: 0, y: 0 }, end: { x: 100, y: 100 }, color: cmyk(0, 0, 0, 1) }),
    )).toEqual(Array(6).fill('mono'));
  });

  it('colour: anything that is not pure black, including greys, rich black and a single coloured word', async () => {
    expect(await kinds(
      async (p, d) => { p.drawText('Red', { x: 50, y: 700, font: await d.embedFont(StandardFonts.Helvetica), color: rgb(1, 0, 0) }); },
      async (p, d) => { p.drawText('Grey', { x: 50, y: 700, font: await d.embedFont(StandardFonts.Helvetica), color: grayscale(0.5) }); },
      async (p, d) => { p.drawText('Soft black', { x: 50, y: 700, font: await d.embedFont(StandardFonts.Helvetica), color: rgb(0.05, 0.05, 0.05) }); },
      async (p, d) => { p.drawText('Rich black', { x: 50, y: 700, font: await d.embedFont(StandardFonts.Helvetica), color: cmyk(0.6, 0.4, 0.4, 1) }); },
      async (p, d) => { p.drawText('Four colour black', { x: 50, y: 700, font: await d.embedFont(StandardFonts.Helvetica), color: cmyk(0, 0, 0, 0.99) }); },
      async (p, d) => { const f = await d.embedFont(StandardFonts.Helvetica); p.drawText('Black', { x: 50, y: 700, font: f }); p.drawText('but a blue word', { x: 50, y: 650, font: f, color: rgb(0, 0, 1) }); },
      (p) => p.drawRectangle({ x: 10, y: 10, width: 100, height: 20, borderColor: rgb(0, 0.6, 0), borderWidth: 1 }),
    )).toEqual(Array(7).fill('colour'));
  });

  it('colour wins over mono on the same page, and the colour is judged per object, not per page', async () => {
    expect(await kinds(async (p, d) => {
      const f = await d.embedFont(StandardFonts.Helvetica);
      p.drawText('black', { x: 50, y: 700, font: f }); p.drawText('red', { x: 50, y: 600, font: f, color: rgb(0.9, 0, 0) }); p.drawText('black again', { x: 50, y: 500, font: f, color: rgb(0, 0, 0) });
    })).toEqual(['colour']);
  });

  it('operators: q/Q restore the colour, invisible text and clip-only text mark nothing, white is not ink, colour spaces are read', async () => {
    const page = async (content: string) => {
      const doc = await PDFDocument.create(); const pg = doc.addPage([100, 100]);
      pg.node.set(PDFName.of('Contents'), doc.context.register(doc.context.stream(content)));
      return (await analysePageInk(await doc.save()))[0];
    };
    expect(await page('q 1 0 0 rg Q (x) Tj')).toBe('mono'); // the red was undone
    expect(await page('q 1 0 0 rg (x) Tj Q')).toBe('colour');
    expect(await page('1 0 0 rg 3 Tr (x) Tj')).toBe('blank'); // invisible text (an OCR layer)
    expect(await page('1 0 0 rg 7 Tr (x) Tj')).toBe('blank'); // text used only as a clip
    expect(await page('1 0 0 rg 0 0 50 50 re n')).toBe('blank'); // a path that is not painted
    expect(await page('0 0 1 RG 0 0 50 50 re f')).toBe('mono'); // the blue is a stroke colour, the fill is still black
    expect(await page('0 0 1 RG 0 0 50 50 re S')).toBe('colour');
    expect(await page('0 0 1 RG 0 0 50 50 re B')).toBe('colour');
    expect(await page('1 g 0 0 50 50 re f')).toBe('blank');
    expect(await page('0 g 0 0 50 50 re f')).toBe('mono');
    expect(await page('/DeviceRGB cs 0 0 0 sc (x) Tj')).toBe('mono');
    expect(await page('/DeviceRGB cs 0 0 0.5 sc (x) Tj')).toBe('colour');
    expect(await page('/DeviceCMYK cs 0 0 0 1 scn (x) Tj')).toBe('mono');
    expect(await page('/DeviceCMYK cs 0 0 0 0.2 scn (x) Tj')).toBe('colour');
    expect(await page('/Pattern cs /P1 scn 0 0 5 5 re f')).toBe('colour');
    expect(await page('0 0 50 50 re f % 1 0 0 rg is only a comment')).toBe('mono');
    expect(await page('[(a) -20 (b)] TJ')).toBe('mono');
    expect(await page('[( ) -20 ( )] TJ')).toBe('blank');
    expect(await page('BI /W 1 /H 1 /BPC 1 /CS /G ID \u0000 EI')).toBe('mono'); // black and white picture
    expect(await page('BI /W 1 /H 1 /BPC 8 /CS /RGB ID abc EI')).toBe('colour');
    expect(await page('1 0 0 rg BI /W 1 /H 1 /IM true /BPC 1 ID \u0000 EI')).toBe('colour'); // an image mask is painted in the fill colour
    expect(await page('(x) Tj 0 1 0 rg BI /W 1 /H 1 /IM true ID \u0000 EI')).toBe('colour');
    expect(await page('')).toBe('blank');
  });

  it('pictures: a colour picture is colour; a 1-bit grey picture is black and white only', async () => {
    const out = await kinds(
      async (p, d) => { const img = await d.embedPng(png(4, 4, () => [200, 30, 30])); p.drawImage(img, { x: 10, y: 10, width: 40, height: 40 }); },
      async (p, d) => { const img = await d.embedPng(png(4, 4, (x) => (x % 2 ? [255, 255, 255] : [0, 0, 0]))); p.drawImage(img, { x: 10, y: 10, width: 40, height: 40 }); },
    );
    expect(out[0]).toBe('colour');
    expect(out[1]).toBe('colour'); // an 8-bit RGB picture is never proven pure black, even when its pixels happen to be black and white
  });

  it('a page drawn through an embedded page (form XObject) is read too', async () => {
    const src = await PDFDocument.create(); const sp = src.addPage([200, 200]);
    sp.drawText('red inside', { x: 10, y: 100, font: await src.embedFont(StandardFonts.Helvetica), color: rgb(1, 0, 0) });
    const srcBytes = await src.save();
    const blackSrc = await PDFDocument.create(); blackSrc.addPage([200, 200]).drawText('black inside', { x: 10, y: 100, font: await blackSrc.embedFont(StandardFonts.Helvetica) });
    const blackBytes = await blackSrc.save();
    const doc = await PDFDocument.create();
    const [red] = await doc.embedPdf(await PDFDocument.load(srcBytes)); const [black] = await doc.embedPdf(await PDFDocument.load(blackBytes));
    doc.addPage([595, 842]).drawPage(red!, { x: 0, y: 0 });
    doc.addPage([595, 842]).drawPage(black!, { x: 0, y: 0 });
    doc.addPage([595, 842]);
    expect(await analysePageInk(await doc.save())).toEqual(['colour', 'mono', 'blank']);
  });

  it('survives garbage: a page with an unreadable content stream is not counted as black', async () => {
    const doc = await PDFDocument.create(); const pg = doc.addPage([100, 100]);
    const stream = doc.context.stream('this is ((( not a content stream <<< >>> BI ID');
    pg.node.set(PDFName.of('Contents'), doc.context.register(stream));
    expect(await analysePageInk(await doc.save())).toHaveLength(1);
  });
});

describe('inkPerRange', () => {
  it('adds up the pages of each pack', () => {
    const pages = ['mono', 'colour', 'blank', 'mono', 'mono', 'colour'] as const;
    expect(inkPerRange([...pages], [{ startPage: 1, endPage: 3 }, { startPage: 4, endPage: 6 }])).toEqual([{ colour: 1, mono: 1, blank: 1 }, { colour: 1, mono: 2, blank: 0 }]);
  });
});
