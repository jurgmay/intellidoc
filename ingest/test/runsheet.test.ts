import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { envelopeText, buildRunSheet, printMethod, weightBandLines, postalServiceText, type RunSheetInput } from '../src/runsheet/data.js';
import { mergePdfs, renderRunSheet } from '../src/runsheet/pdf.js';
import { printFileName } from '../src/compose/job.js';
import { spawnSync } from 'node:child_process';

const input: RunSheetInput = {
  batchCode: 1042, brand: 'Leeds Building Society', batchNumber: 16, batchTotal: 23, jobNumber: 'J-77', customerName: 'Uinsure', submitted: new Date('2026-11-20T10:00:00Z'),
  paper: 'A4 White', isDuplex: true, colour: 'Colour', mailpieces: 1234, pages: 5000, department: 'Machine enclosing',
  envelopeCode: 'WH21279', envelopeDescription: 'C5 Envelope', inserts: [{ code: 'WH1', description: 'Leaflet', quantity: 1 }],
  postalProvider: 'The Delivery Group', postalServiceName: 'Mailmark Economy', serviceCode: 'MM2', postalFormat: 'Letter',
  weightBandsG: [100, 100, 250, null], returnAddress: 'Latcham\nUnit 1\u000bTown',
};

describe('run sheet data', () => {
  it('wording of print method follows the FileMaker calculation', () => {
    expect(printMethod('A4 White', true, 'Colour')).toBe('Finished size A4; printed 1-up on A4 White; colour; duplex');
    expect(printMethod('A4 White - Edge-to-edge', false, 'Mono')).toBe('Finished size A4; 1-up on SRA4; mono; simplex');
    expect(printMethod('A5 White', true, 'Colour')).toBe('Finished size A5; 2-up on A4 white (cut and stack); colour; duplex');
    expect(printMethod('A4 White', false, 'Colour', true)).toBe('Finished size A3; scale to A3; 1-up on A3 white; colour; duplex');
  });
  it('weight band lines are lightest first, unbanded last', () => {
    expect(weightBandLines([250, 100, 100, null])).toEqual(['2 x 100g', '1 x 250g', '1 x unbanded']);
  });
  it('postal service shows the code when there is one', () => {
    expect(postalServiceText('2nd Class', 'T2')).toBe('2nd Class (T2)');
    expect(postalServiceText('2nd Class', null)).toBe('2nd Class');
  });
  it('builds the sheet; file name is batch code + .pdf', () => {
    const d = buildRunSheet(input);
    expect(d.fileName).toBe('J-77 - IntelliDoc - Uinsure - 1042 - Batch 16 of 23.pdf');
    expect(d.envelope).toBe('WH21279 : C5 Envelope');
    expect(d.inserts).toEqual(['WH1 : Leaflet']);
    expect(d.department).toBe('Machine Enclosing');
    expect(d.postalService).toBe('Mailmark Economy (MM2)');
    expect(d.returnAddress).toBe('Latcham, Unit 1, Town');
    expect(d.dateSubmitted).toBe('20/11/2026');
  });
});

describe('envelope wording', () => {
  it('shows the code only for warehouse stock; a provisional code is left off', () => {
    expect(envelopeText('WH21279', 'C5 Envelope')).toBe('WH21279 : C5 Envelope');
    expect(envelopeText('wh21279', 'C5 Envelope')).toBe('wh21279 : C5 Envelope');
    expect(envelopeText('50017', 'C5 Envelope')).toBe('C5 Envelope');
    expect(envelopeText('', 'C5 Envelope')).toBe('C5 Envelope');
    expect(buildRunSheet({ ...input, envelopeCode: '50017' }).envelope).toBe('C5 Envelope');
    expect(buildRunSheet({ ...input, inserts: [{ code: '50018', description: 'Leaflet', quantity: 2 }] }).inserts).toEqual(['50018 : Leaflet (x2)']); // inserts always show their code
  });
});

describe('print file names', () => {
  const base = 'J-77 - IntelliDoc - Uinsure - 1042 - Batch 16 of 23.pdf';
  it('are the name on the run sheet, with the segment added when a batch has several files', () => {
    expect(buildRunSheet(input).fileName).toBe(base);
    expect(printFileName(base, 1, 1)).toBe(base);
    expect(printFileName(base, 1, 2)).toBe('J-77 - IntelliDoc - Uinsure - 1042 - Batch 16 of 23 - Segment 1 of 2.pdf');
    expect(printFileName(base, 2, 2)).toBe('J-77 - IntelliDoc - Uinsure - 1042 - Batch 16 of 23 - Segment 2 of 2.pdf');
  });
  it('have no characters Windows refuses, and no job number prefix when there is none', () => {
    const d = buildRunSheet({ ...input, jobNumber: '', customerName: 'A/B: "Co" <x>?' });
    expect(d.fileName).toBe('IntelliDoc - A-B- -Co- -x-- - 1042 - Batch 16 of 23.pdf');
    expect(/[\\/:*?"<>|]/.test(d.fileName)).toBe(false);
  });
});

describe('run sheet pdf', () => {
  it('keeps a long sheet on a second page instead of running off the bottom', async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ code: `WH${1000 + i}`, description: `Insert number ${i + 1} with a description`, quantity: 1 }));
    const pdf = await renderRunSheet(buildRunSheet({ ...input, inserts: many }));
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBe(2);
    if (spawnSync('pdftotext', ['-v']).error === undefined) {
      const { writeFileSync, mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
      const f = join(mkdtempSync(join(tmpdir(), 'rs-')), 'x.pdf'); writeFileSync(f, pdf);
      const text = (n: number): string => spawnSync('pdftotext', ['-f', String(n), '-l', String(n), '-layout', f, '-'], { encoding: 'utf8' }).stdout;
      expect(text(1)).toContain('page 1 of 2'); expect(text(2)).toContain('page 2 of 2');
      expect(text(1)).not.toContain('WH1000'); // a row that fits on a page is kept together, so the Inserts row moved to page 2
      expect(text(2)).toContain('WH1000'); expect(text(2)).toContain('WH1029'); expect(text(2)).toContain('Return address'); // nothing lost
      expect(text(2)).toContain('Fulfilment details (continued)');
    }
  });
  it('carries one row that is longer than a page over the page, losing nothing', async () => {
    const many = Array.from({ length: 120 }, (_, i) => ({ code: `WH${1000 + i}`, description: `Insert number ${i + 1}`, quantity: 1 }));
    const pdf = await renderRunSheet(buildRunSheet({ ...input, inserts: many }));
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(3);
    if (spawnSync('pdftotext', ['-v']).error === undefined) {
      const { writeFileSync, mkdtempSync } = await import('node:fs'); const { tmpdir } = await import('node:os'); const { join } = await import('node:path');
      const f = join(mkdtempSync(join(tmpdir(), 'rs-')), 'y.pdf'); writeFileSync(f, pdf);
      const all = spawnSync('pdftotext', ['-layout', f, '-'], { encoding: 'utf8' }).stdout;
      for (const code of ['WH1000', 'WH1060', 'WH1119']) expect(all).toContain(code);
      expect(all).toContain('Return address'); expect(all).toContain('Inserts (continued)');
    }
  });
  it('a normal sheet stays on one page with no page number', async () => {
    expect((await PDFDocument.load(await renderRunSheet(buildRunSheet(input)))).getPageCount()).toBe(1);
  });

  it('renders one A4 page, and merging keeps every page', async () => {
    const a = await renderRunSheet(buildRunSheet(input));
    const b = await renderRunSheet(buildRunSheet({ ...input, batchCode: 1043 }));
    const doc = await PDFDocument.load(a);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(595.28, 1);
    expect((await PDFDocument.load(await mergePdfs([a, b]))).getPageCount()).toBe(2);
  });
});

describe('postal badge', () => {
  it('uses the world icon only when the service name says international', () => {
    expect(buildRunSheet(input).isInternational).toBe(false);
    expect(buildRunSheet({ ...input, postalServiceName: 'Royal Mail International Standard' }).isInternational).toBe(true);
  });
});
