import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PDFDocument, rgb } from 'pdf-lib';
import { buildHeader, buildInput, buildMrdf, buildRecord, encodeAnsi, fieldWidth, HEADER_FIELDS, HEADER_LENGTH, INPUT_FIELDS, INPUT_LENGTH, mailpiecePages, mrdfCycleId, mrdfPageCodes,
  mrdfTimestamp, padNum, padText, type MrdfBatch } from '../src/compose/mrdf.js';
import { planBatch, type PlanMailpiece, type PlanPack } from '../src/compose/plan.js';
import { composeBatch } from '../src/compose/compose.js';

const sum = (f: typeof HEADER_FIELDS): number => f.reduce((s, x) => s + fieldWidth(x), 0);
/** Offset and width of a field, found by walking the specs. */
const at = (fields: typeof HEADER_FIELDS, name: string): [number, number] => {
  let o = 0;
  for (const f of fields) { if (f.name === name) return [o, fieldWidth(f)]; o += fieldWidth(f); }
  throw new Error(name);
};
const cut = (rec: string, fields: typeof HEADER_FIELDS, name: string): string => { const [o, w] = at(fields, name); return rec.slice(o, o + w); };

const batch: MrdfBatch = {
  batchCode: 1042, accountCode: 'ACME', returnAddress: ['Acme Ltd', '1 High St', 'Leeds'], logo1: 'LOGO1',
  now: new Date(2026, 10, 22, 14, 3, 5),
  pieces: [
    { sequenceNumber: 2, pages: 6, addressLines: ['Ms A Smith', '2 Low Rd', 'Town', 'County'], postcode: 'LS1 1AA' },
    { sequenceNumber: 1, pages: 2, addressLines: ['Mr B Jones'], postcode: 'M1 2BB' },
  ],
};

describe('MRDF field tables', () => {
  it('give the record lengths of the FileMaker file', () => {
    expect(sum(HEADER_FIELDS)).toBe(HEADER_LENGTH);
    expect(sum(INPUT_FIELDS)).toBe(INPUT_LENGTH);
    expect(HEADER_LENGTH).toBe(790);
    expect(INPUT_LENGTH).toBe(1406);
  });
  it('have no duplicate names and end with the X', () => {
    for (const f of [HEADER_FIELDS, INPUT_FIELDS]) {
      const names = f.map((x) => x.name);
      expect(new Set(names).size).toBe(names.length);
      expect(f[f.length - 1]).toEqual({ name: 'EndOfRecordIndicator', kind: 'fixed', value: 'X' });
    }
  });
});

describe('padding', () => {
  it('pads text on the right with spaces and cuts it', () => {
    expect(padText('AB', 5)).toBe('AB   ');
    expect(padText('ABCDEFG', 5)).toBe('ABCDE');
    expect(padText(null, 3)).toBe('   ');
  });
  it('pads numbers on the left with zeros and keeps the rightmost digits', () => {
    expect(padNum(42, 6)).toBe('000042');
    expect(padNum(1234567, 5)).toBe('34567');
    expect(padNum(null, 3)).toBe('000');
  });
  it('turns line breaks inside a value into spaces so a record stays on one line', () => {
    expect(buildRecord([{ name: 'a', kind: 'text', width: 8 }], { a: 'x\r\ny' })).toBe('x y     ');
  });
});

describe('MRDF header', () => {
  const h = buildHeader(batch);
  it('is 790 characters with the values FileMaker set', () => {
    expect(h).toHaveLength(790);
    expect(h.endsWith('X')).toBe(true);
    expect(cut(h, HEADER_FIELDS, 'JobID')).toBe('0000001042');
    expect(cut(h, HEADER_FIELDS, 'RunID')).toBe('000000000001042');
    expect(cut(h, HEADER_FIELDS, 'CreationDate')).toBe('22/11/2026 14:03:05');
    expect(cut(h, HEADER_FIELDS, 'CycleID')).toBe('11_26');
    expect(cut(h, HEADER_FIELDS, 'DataSetType')).toBe('2');
    expect(cut(h, HEADER_FIELDS, 'PlannedMailpieceCount')).toBe('000002');
    expect(cut(h, HEADER_FIELDS, 'PlannedSheetCount')).toBe('0000000004'); // 1 + 3 sheets
    expect(cut(h, HEADER_FIELDS, 'ChargebackCarrier')).toBe('SM ');
    expect(cut(h, HEADER_FIELDS, 'ChargebackClass')).toBe('002');
    expect(cut(h, HEADER_FIELDS, 'InserterMode')).toBe('SM_CH_01');
    expect(cut(h, HEADER_FIELDS, 'PostageMeter12Setting')).toBe('0.000');
    expect(cut(h, HEADER_FIELDS, 'InsertFeeder01Mode')).toBe('6');
    expect(cut(h, HEADER_FIELDS, 'InsertFeeder02Mode')).toBe('1');
    expect(cut(h, HEADER_FIELDS, 'InsertFeeder16Mode')).toBe('1');
    expect(cut(h, HEADER_FIELDS, 'EnvelopeFeederDocID')).toBe('None           ');
    expect(cut(h, HEADER_FIELDS, 'InsertFeeder16DocID')).toBe('None           ');
    expect(cut(h, HEADER_FIELDS, 'PrintJobName')).toBe('Hybrid Default ');
    expect(cut(h, HEADER_FIELDS, 'Filler')).toBe(' '.repeat(100));
  });
  it('formats the date and cycle', () => {
    expect(mrdfTimestamp(new Date(2027, 0, 5, 9, 8, 7))).toBe('05/01/2027 09:08:07');
    expect(mrdfCycleId(new Date(2027, 0, 5))).toBe('01_27');
  });
});

describe('MRDF input record', () => {
  const [b, a] = [buildInput(batch, batch.pieces[1]!), buildInput(batch, batch.pieces[0]!)];
  it('is 1406 characters', () => { expect(a).toHaveLength(1406); expect(b).toHaveLength(1406); expect(a.endsWith('X')).toBe(true); });
  it('carries the piece, the sheets, the account and the addresses', () => {
    expect(cut(a, INPUT_FIELDS, 'JobID')).toBe('0000001042');
    expect(cut(a, INPUT_FIELDS, 'PieceID')).toBe('000002');
    expect(cut(a, INPUT_FIELDS, 'TotalSheetsInputFdr1')).toBe('003');
    expect(cut(b, INPUT_FIELDS, 'TotalSheetsInputFdr1')).toBe('001');
    expect(cut(a, INPUT_FIELDS, 'AccountIdentifier')).toBe('ACME'.padEnd(20));
    expect(cut(a, INPUT_FIELDS, 'RecipientName')).toBe('Ms A Smith'.padEnd(40));
    expect(cut(a, INPUT_FIELDS, 'RecipientAddress1')).toBe('2 Low Rd'.padEnd(40));
    expect(cut(a, INPUT_FIELDS, 'RecipientAddress3')).toBe('County'.padEnd(40));
    expect(cut(a, INPUT_FIELDS, 'RecipientAddress4')).toBe(' '.repeat(40));
    expect(cut(a, INPUT_FIELDS, 'PostCode')).toBe('LS1 1AA ');
    expect(cut(a, INPUT_FIELDS, 'BusinessReturnAddress2')).toBe('1 High St'.padEnd(40));
    expect(cut(a, INPUT_FIELDS, 'BusinessReturnAddress4')).toBe(' '.repeat(40));
    expect(cut(a, INPUT_FIELDS, 'LogoBitmapSelect1')).toBe('LOGO1   ');
    expect(cut(a, INPUT_FIELDS, 'LogoBitmapSelect2')).toBe(' '.repeat(8));
    expect(cut(a, INPUT_FIELDS, 'HManifestSeqNumber')).toBe('0000000000000000000000002');
    expect(cut(a, INPUT_FIELDS, 'HManifestFinishedWeight')).toBe('000.933');
    expect(cut(a, INPUT_FIELDS, 'HManifestPostage')).toBe('00.355');
    expect(cut(a, INPUT_FIELDS, 'HostSortID')).toBe('Hybrid Mail 01042 ');
    expect(cut(a, INPUT_FIELDS, 'ProcessingCategory')).toBe('ML');
    expect(cut(a, INPUT_FIELDS, 'RateCategory')).toBe('SP');
    expect(cut(a, INPUT_FIELDS, 'TraySize')).toBe('1');
    expect(cut(a, INPUT_FIELDS, 'InsertFeed16')).toBe('0');
  });
  it('cuts a long line to its 40 characters', () => {
    const r = buildInput(batch, { sequenceNumber: 1, pages: 2, addressLines: ['N'.repeat(60)], postcode: 'X' });
    expect(cut(r, INPUT_FIELDS, 'RecipientName')).toBe('N'.repeat(40));
    expect(r).toHaveLength(1406);
  });
});

describe('MRDF file', () => {
  const text = buildMrdf(batch);
  it('is the header then the pieces in sequence order, each line ending CRLF', () => {
    const lines = text.split('\r\n');
    expect(lines).toHaveLength(4); // 3 records + the empty piece after the last CRLF
    expect(lines[3]).toBe('');
    expect(lines[0]).toHaveLength(790);
    expect(cut(lines[1]!, INPUT_FIELDS, 'PieceID')).toBe('000001');
    expect(cut(lines[2]!, INPUT_FIELDS, 'PieceID')).toBe('000002');
  });
  it('is written one byte per character in Windows-1252', () => {
    const e = encodeAnsi('Zoë – “€” ŵ');
    expect([...e]).toEqual([0x5a, 0x6f, 0xeb, 0x20, 0x96, 0x20, 0x93, 0x80, 0x94, 0x20, 0x3f]);
    const withAccent = buildMrdf({ ...batch, pieces: [{ sequenceNumber: 1, pages: 2, addressLines: ['Zoë Ó'], postcode: 'A1' }] });
    expect(encodeAnsi(withAccent)).toHaveLength(withAccent.length);
  });
});

describe('MRDF page codes', () => {
  it('are batch, piece, sheet, sheets then 000 in the Data Matrix, and sheet, sheets, piece in the OCR code', () => {
    expect(mrdfPageCodes(1042, 7, 1, 6)).toEqual({ matrix: '0000001042' + '000007' + '01' + '03' + '000', ocr: '0103000007' });
    expect(mrdfPageCodes(1042, 7, 5, 6)).toEqual({ matrix: '0000001042' + '000007' + '03' + '03' + '000', ocr: '0303000007' });
    expect(mrdfPageCodes(1042, 7, 5, 6).matrix).toHaveLength(23);
  });
});

// ---- from the plan, and in the composed PDF ----
const pack = (id: number, start: number, end: number): PlanPack => ({ packId: id, startPage: start, endPage: end, submittingAccountId: 1, releaseDate: new Date('2026-01-01'), documentSequence: 99, forceMono: false });
const mp = (id: number, packs: PlanPack[], weight: number): PlanMailpiece => ({ mailpieceId: id, sequenceNumber: null, weightBandG: weight, isCancelled: false, colourMode: 'ORIGINAL', isAddressMatching: false, packs });
const mailpieces = [mp(1, [pack(1, 1, 3), pack(2, 4, 4)], 250), mp(2, [pack(3, 5, 6)], 100)];
const plan = planBatch(mailpieces, { maxPagesPerPdf: 100, runSheetPages: 2 });

describe('mailpiecePages', () => {
  it('counts the printed pages of each mailpiece, padding included and the run sheet not', () => {
    expect([...mailpiecePages(plan)]).toEqual([[1, 2], [2, 6]]);
  });
});

const marks = {
  seq: { fontPt: 8, leftMm: 20, topMm: 40, widthMm: 45, heightMm: 4 }, dm: { leftMm: 20, topMm: 30, widthMm: 8, heightMm: 8 }, dot: { xMm: 205.5, yMm: 269, diameterMm: 2 },
  mrdf: { dm: { leftMm: 150, topMm: 10, widthMm: 8, heightMm: 8 }, ocr: { fontPt: 8.2, leftMm: 120, topMm: 10, widthMm: 28, heightMm: 4 } },
};
async function pdf(pages: number, label: string): Promise<Uint8Array> {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([595.276, 841.89]).drawText(`${label} ${i + 1}`, { x: 100, y: 700, size: 20, color: rgb(0, 0, 0) });
  return d.save();
}
const hasPdftotext = spawnSync('pdftotext', ['-v']).error === undefined;

describe('composeBatch with MRDF', () => {
  const run = async (mrdf: boolean) => (await composeBatch({ batchCode: 1042, source: await pdf(6, 'Page'), runSheet: await pdf(2, 'Run'), plan, marks, grey: null, fileName: () => 'o.pdf', mrdf }))[0]!;

  it('adds the codes to the front of every sheet and nothing to the backs', async () => {
    const [on, off] = [await run(true), await run(false)];
    expect(on.pageCount).toBe(off.pageCount);
    expect(on.bytes.length).toBeGreaterThan(off.bytes.length);
  });
  it('needs the MRDF positions', async () => {
    await expect(composeBatch({ batchCode: 1, source: await pdf(6, 'Page'), runSheet: await pdf(2, 'Run'), plan, marks: { ...marks, mrdf: undefined }, grey: null, fileName: () => 'o.pdf', mrdf: true })).rejects.toThrow(/MRDF/);
  });
  it.skipIf(!hasPdftotext)('prints sheet, sheets and piece as the OCR code on pages 3, 5, 7 and 9 only', async () => {
    const f = await run(true);
    const dir = mkdtempSync(join(tmpdir(), 'idoc-mrdf-')); const file = join(dir, 'o.pdf'); writeFileSync(file, f.bytes);
    const page = (n: number) => execFileSync('pdftotext', ['-f', String(n), '-l', String(n), file, '-'], { encoding: 'utf8' });
    expect(page(3)).toContain('0101000001');
    expect(page(5)).toContain('0103000002');
    expect(page(7)).toContain('0203000002');
    expect(page(9)).toContain('0303000002');
    for (const n of [1, 2, 4, 6, 8, 10]) expect(page(n)).not.toMatch(/\d{10}/);
  });
});
