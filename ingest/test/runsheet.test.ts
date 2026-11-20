import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildRunSheet, printMethod, weightBandLines, postalServiceText, type RunSheetInput } from '../src/runsheet/data.js';
import { mergePdfs, renderRunSheet } from '../src/runsheet/pdf.js';

const input: RunSheetInput = {
  batchCode: 1042, jobNumber: 'J-77', customerName: 'Uinsure', submitted: new Date('2026-11-20T10:00:00Z'),
  paper: 'A4 White', isDuplex: true, colour: 'Colour', mailpieces: 1234, pages: 5000, department: 'Machine enclosing',
  envelopeCode: 'WH21279', envelopeDescription: 'C5 Envelope', inserts: [{ code: 'WH1', description: 'Leaflet', quantity: 1 }],
  postalProvider: 'The Delivery Group', postalServiceName: 'Mailmark Economy', serviceCode: 'MM2', postalFormat: 'Letter',
  weightBandsG: [100, 100, 250, null], returnAddress: 'Latcham\nUnit 1\u000bTown',
};

describe('run sheet data', () => {
  it('wording of print method follows the FileMaker calculation', () => {
    expect(printMethod('A4 White', true, 'Colour')).toBe('Finished size A4; printed 1-up on A4 White; colour; duplex');
    expect(printMethod('A4 White - Edge-to-edge', false, 'Mono')).toBe('Finished size A4; 2-up on SRA3 (cut and stack); mono; simplex');
    expect(printMethod('A5 White', true, 'Colour')).toBe('Finished size A5; 2-up on A4 white (cut and stack); colour; duplex');
    expect(printMethod('A4 White', false, 'Colour', true)).toBe('Finished size A3; scale to A3; 1-up on A3 white; colour; duplex');
  });
  it('weight band lines are lightest first, unbanded last', () => {
    expect(weightBandLines([250, 100, 100, null])).toEqual(['2 x up to 100g', '1 x up to 250g', '1 x unbanded']);
  });
  it('postal service shows the code when there is one', () => {
    expect(postalServiceText('2nd Class', 'T2')).toBe('2nd Class (T2)');
    expect(postalServiceText('2nd Class', null)).toBe('2nd Class');
  });
  it('builds the sheet; file name is batch code + .pdf', () => {
    const d = buildRunSheet(input);
    expect(d.fileName).toBe('1042.pdf');
    expect(d.envelope).toBe('WH21279 : C5 Envelope');
    expect(d.inserts).toEqual(['WH1 : Leaflet']);
    expect(d.postalService).toBe('Mailmark Economy (MM2)');
    expect(d.returnAddress).toBe('Latcham, Unit 1, Town');
    expect(d.dateSubmitted).toBe('20 Nov 2026');
  });
});

describe('run sheet pdf', () => {
  it('renders one A4 page, and merging keeps every page', async () => {
    const a = await renderRunSheet(buildRunSheet(input));
    const b = await renderRunSheet(buildRunSheet({ ...input, batchCode: 1043 }));
    const doc = await PDFDocument.load(a);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getPage(0).getWidth()).toBeCloseTo(595.28, 1);
    expect((await PDFDocument.load(await mergePdfs([a, b]))).getPageCount()).toBe(2);
  });
});
