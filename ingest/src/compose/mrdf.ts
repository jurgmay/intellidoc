/**
 * MRDF: the Bluecrest inserter data file. One fixed-width text file per batch, <batchCode>.txt: a Header record, then one Input record per
 * mailpiece, each ending with an "X" and a line break. Written in ANSI (Windows-1252) with CRLF line ends.
 * The field order and widths are the ones FileMaker used (the "Auto enter" calculation of each field in MRDF_InputHeader and MRDF_InputRecords),
 * so the machine reads the files exactly as before. Pure: no database, no files (see writeMrdf in mrdfFile.ts).
 */
import type { BatchPlan } from './plan.js';

/**
 * text: left-justified, space padded, cut to the width (Left(Self & spaces; n)).
 * num: right-justified, zero padded, the rightmost digits kept (Right(zeros & Self; n)).
 * fixed: always this value (its length is the width).
 */
export type FieldSpec =
  | { name: string; kind: 'text'; width: number }
  | { name: string; kind: 'num'; width: number }
  | { name: string; kind: 'fixed'; value: string };

const t = (name: string, width: number): FieldSpec => ({ name, kind: 'text', width });
const n = (name: string, width: number): FieldSpec => ({ name, kind: 'num', width });
const f = (name: string, value: string): FieldSpec => ({ name, kind: 'fixed', value });
const range = (count: number, make: (i: string) => FieldSpec): FieldSpec[] => Array.from({ length: count }, (_, i) => make(String(i + 1).padStart(2, '0')));

export const HEADER_LENGTH = 790;
export const INPUT_LENGTH = 1406;

export const HEADER_FIELDS: FieldSpec[] = [
  n('JobID', 10), n('RunID', 15), t('CreationDate', 19), t('GroupID', 15), t('JobType', 15), t('ApplicationID', 15), t('CycleID', 5), t('ClientID', 15),
  t('SLADueDate', 19), t('SLAWarningOffset', 5), t('ReprintDueDate', 19), t('ReprintWarningOffset', 5), t('DataSetType', 1), t('PlannedMailpieceCount', 6),
  n('PlannedSheetCount', 10), t('ChargebackAccount', 24), t('ChargebackSubAccount', 16), t('ChargebackCarrier', 3), t('ChargebackClass', 3), t('InserterMode', 8),
  ...range(12, (i) => t(`PostageMeter${i}Setting`, 5)),
  ...range(16, (i) => t(`InsertFeeder${i}Mode`, 1)),
  t('EnvelopeFeederDocID', 15),
  ...range(16, (i) => t(`InsertFeeder${i}DocID`, 15)),
  t('PrintJobName', 15), t('BREPrintJobName', 15), t('UserDefinedField1', 30), t('UserDefinedField2', 30), t('MailrunUniqueID', 30), t('PIOMJobID', 10),
  f('Filler', ' '.repeat(100)), f('EndOfRecordIndicator', 'X'),
];

/**
 * HostSortID is 20 characters in the field definition, but its calculation, Left("Hybrid Mail " & Right(JobID; 5) & " "; 20), only ever makes 18
 * ("Hybrid Mail " is 12, five digits and a space make 18) and FileMaker wrote that. The machine has been reading 1406-character records, so 18 is kept.
 */
export const HOST_SORT_ID_WIDTH = 18;

export const INPUT_FIELDS: FieldSpec[] = [
  n('JobID', 10), n('PieceID', 6), n('TotalSheetsInputFdr1', 3), f('TotalSheetsInputFdr2', '000'),
  f('SubsetSheetNumInptFdr1', '000'), f('SubsetSheetNumInptFdr2', '000'), f('StitchSheetNumInptFdr1', '000'), f('StitchSheetNumInptFdr2', '000'),
  t('AccountIdentifier', 20), f('InputWeight', '0.000'),
  ...range(16, (i) => f(`InsertFeed${i}`, '0')),
  ...range(6, (i) => f(`SelectiveAccessory${i.slice(1)}`, '0')),
  f('AccountPull', '0'), f('QualityAudit', '0'), f('AlertAndClear', '0'),
  t('RecipientName', 40), ...[1, 2, 3, 4, 5].map((i) => t(`RecipientAddress${i}`, 40)),
  t('PostCode', 8), f('ZipCheckDigit', ' '),
  ...[1, 2, 3, 4, 5].map((i) => t(`BusinessReturnAddress${i}`, 40)),
  t('LogoBitmapSelect1', 8), t('LogoBitmapSelect2', 8), t('MarketingTextMessage', 40), t('MailmarkCode', 90),
  n('HManifestSeqNumber', 25), f('HManifestFinishedWeight', '000.933'), f('HManifestRateBreak', '01'), f('HManifestPostage', '00.355'), t('HManifestUserDefined', 25),
  t('HostSortID', HOST_SORT_ID_WIDTH), f('ProcessingCategory', 'ML'), f('RateCategory', 'SP'),
  t('TrayNumber', 4), f('TraySize', '1'), t('TraySortationLevel', 4), t('TrayDestination', 11), t('GroupDestination', 10), t('TrayLabelCityState', 25), t('TrayLabelZip', 5),
  t('TrayLabelContentsText', 25), t('TrayLabelSource', 15), t('TrayLabelBarcode', 10), t('IntelligentTrayBarcode', 24), t('TrayUpOptTrayTagLine', 40),
  t('TrayPostalDestName', 40), t('TrayCINDescription', 40), t('TrayMailersNameCitySt', 40), t('TrayRouteAuto', 4), t('TrayHumanReadBarcod', 30), t('TrayMailersArea', 40),
  t('PalletNumber', 4), t('ChargebackAccount', 24), t('ChargebackSubAccount', 16), t('ChargebackCarrier', 3), t('ChargebackClass', 3), t('ReprintIndex', 20),
  t('PreviousMailrunUniqueID', 30), t('PreviousMRDF', 15), t('PreviousPieceID', 6),
  ...[1, 2, 3, 4, 5].map((i) => t(`UserDefinedField${i}`, 30)),
  f('EndOfRecordIndicator', 'X'),
];

export const fieldWidth = (s: FieldSpec): number => (s.kind === 'fixed' ? s.value.length : s.width);

/** Left(v & spaces; width): left-justified, padded with spaces, cut to the width. */
export const padText = (v: string | number | null | undefined, width: number): string => `${v ?? ''}`.padEnd(width, ' ').slice(0, width);
/** Right(zeros & v; width): right-justified, padded with zeros, the rightmost characters kept. */
export const padNum = (v: string | number | null | undefined, width: number): string => `${'0'.repeat(width)}${v ?? ''}`.slice(-width);

/** One record: the fields in order, each at its width. Values for fixed fields are ignored. Line characters inside a value become spaces. */
export function buildRecord(fields: FieldSpec[], values: Record<string, string | number | null | undefined>): string {
  return fields.map((s) => {
    if (s.kind === 'fixed') return s.value;
    const raw = values[s.name];
    const v = typeof raw === 'string' ? raw.replace(/[\r\n\t]+/g, ' ') : raw;
    return s.kind === 'text' ? padText(v, s.width) : padNum(v, s.width);
  }).join('');
}

/** Dates in the form FileMaker wrote: dd/mm/yyyy hh:mm:ss (19 characters). */
export function mrdfTimestamp(d: Date): string {
  const p = (x: number): string => String(x).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
/** The cycle: month and two-digit year, e.g. 11_26 (FileMaker took them from the date text). */
export const mrdfCycleId = (d: Date): string => `${String(d.getMonth() + 1).padStart(2, '0')}_${String(d.getFullYear() % 100).padStart(2, '0')}`;

export interface MrdfPiece {
  sequenceNumber: number;
  /** Printed pages of the mailpiece, padding included (a whole number of sheets). */
  pages: number;
  /** The addressee, then the address lines (the postcode is separate). */
  addressLines: string[];
  postcode: string;
}
export interface MrdfBatch {
  batchCode: number;
  /** The customer's account code. */
  accountCode: string;
  /** The customer's return address, one line each. */
  returnAddress: string[];
  logo1?: string;
  logo2?: string;
  pieces: MrdfPiece[];
  now: Date;
}

export const sheetsOf = (pages: number): number => Math.ceil(pages / 2);

export function buildHeader(b: MrdfBatch): string {
  const feederModes = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`InsertFeeder${String(i + 1).padStart(2, '0')}Mode`, i === 0 ? '6' : '1']));
  const docIds = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`InsertFeeder${String(i + 1).padStart(2, '0')}DocID`, 'None']));
  const meters = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`PostageMeter${String(i + 1).padStart(2, '0')}Setting`, '0.000']));
  return buildRecord(HEADER_FIELDS, {
    JobID: b.batchCode, RunID: b.batchCode, CreationDate: mrdfTimestamp(b.now), CycleID: mrdfCycleId(b.now), ReprintWarningOffset: '00000', DataSetType: '2',
    PlannedMailpieceCount: padNum(b.pieces.length, 6), PlannedSheetCount: b.pieces.reduce((s, p) => s + sheetsOf(p.pages), 0),
    ChargebackCarrier: 'SM', ChargebackClass: '002', InserterMode: 'SM_CH_01', ...meters, ...feederModes, EnvelopeFeederDocID: 'None', ...docIds, PrintJobName: 'Hybrid Default',
  });
}

export function buildInput(b: MrdfBatch, p: MrdfPiece): string {
  const [name = '', ...rest] = p.addressLines;
  const v: Record<string, string | number> = {
    JobID: b.batchCode, PieceID: p.sequenceNumber, TotalSheetsInputFdr1: sheetsOf(p.pages), AccountIdentifier: b.accountCode,
    RecipientName: name, PostCode: p.postcode, LogoBitmapSelect1: b.logo1 ?? '', LogoBitmapSelect2: b.logo2 ?? '',
    HManifestSeqNumber: p.sequenceNumber, HostSortID: `Hybrid Mail ${padNum(b.batchCode, 5)} `,
  };
  rest.slice(0, 5).forEach((l, i) => { v[`RecipientAddress${i + 1}`] = l; });
  b.returnAddress.slice(0, 5).forEach((l, i) => { v[`BusinessReturnAddress${i + 1}`] = l; });
  return buildRecord(INPUT_FIELDS, v);
}

/** The whole file as text: header, then the pieces in sequence order, each record followed by CRLF. */
export function buildMrdf(b: MrdfBatch): string {
  const header = buildHeader(b);
  if (header.length !== HEADER_LENGTH) throw new Error(`MRDF header is ${header.length} characters, expected ${HEADER_LENGTH}`);
  const lines = [header];
  for (const p of [...b.pieces].sort((x, y) => x.sequenceNumber - y.sequenceNumber)) {
    const r = buildInput(b, p);
    if (r.length !== INPUT_LENGTH) throw new Error(`MRDF input record ${p.sequenceNumber} is ${r.length} characters, expected ${INPUT_LENGTH}`);
    lines.push(r);
  }
  return lines.map((l) => `${l}\r\n`).join('');
}

// Windows-1252 differs from Latin-1 only in 0x80-0x9F
const CP1252: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
  0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};
/** ANSI bytes: one byte per character, so the fixed widths hold. A character Windows-1252 has no place for becomes "?". */
export function encodeAnsi(text: string): Buffer {
  const out = Buffer.alloc([...text].length);
  [...text].forEach((ch, i) => {
    const c = ch.codePointAt(0)!;
    out[i] = c < 0x80 || (c >= 0xa0 && c <= 0xff) ? c : (CP1252[c] ?? 0x3f);
  });
  return out;
}

/** Printed pages per mailpiece, from the plan: the run sheet is not part of any mailpiece; padding pages are. Keyed by sequence number. */
export function mailpiecePages(plan: BatchPlan): Map<number, number> {
  const out = new Map<number, number>();
  for (const seg of plan.segments) {
    let cur: number | null = null;
    for (const p of seg.pages) {
      if (p.mailpieceStart) { cur = p.mailpieceStart.sequenceNumber; out.set(cur, 0); }
      if (p.kind !== 'run-sheet' && cur !== null) out.set(cur, out.get(cur)! + 1);
    }
  }
  return out;
}

/** The two codes printed on each odd page (the front of each sheet) of a mailpiece when the customer uses MRDF. `pageInPiece` is 1-based and odd. */
export function mrdfPageCodes(batchCode: number, sequenceNumber: number, pageInPiece: number, piecePages: number): { matrix: string; ocr: string } {
  const sheet = padNum((pageInPiece + 1) / 2, 2), sheets = padNum(sheetsOf(piecePages), 2), seq = padNum(sequenceNumber, 6);
  return { matrix: `${padNum(batchCode, 10)}${seq}${sheet}${sheets}000`, ocr: `${sheet}${sheets}${seq}` };
}
