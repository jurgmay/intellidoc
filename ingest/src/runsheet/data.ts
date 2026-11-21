import type { Batch, EnclosingMethod, IngestResult, Mailpiece } from '../types.js';
import type { ReferenceData } from '../reference.js';

/** Everything a run sheet shows, already worded. Rendering (pdf.ts) does no business logic. */
export interface RunSheetData {
  batchCode: string;
  brand: string | null;
  fileName: string;
  jobNumber: string;
  customerName: string;
  dateSubmitted: string;
  printMethod: string;
  totalMailpieces: number;
  totalPages: number;
  department: string;
  envelope: string;
  inserts: string[];
  postalProvider: string;
  postalService: string;
  /** UK flag vs world icon: true when the postal service name contains "international". */
  isInternational: boolean;
  postalFormat: string;
  weightBands: string[];
  returnAddress: string | null;
}

/** What is needed to build one run sheet; filled from the database (query.ts) or from an ingest result (fromIngest). */
export interface RunSheetInput {
  batchCode: number | string;
  brand: string | null;
  /** Position of this batch within its job (1-based) and the number of batches in the job: "Batch 16 of 23". */
  batchNumber: number;
  batchTotal: number;
  jobNumber: string;
  customerName: string;
  submitted: Date;
  paper: string;
  isDuplex: boolean;
  colour: string;
  mailpieces: number;
  pages: number;
  department: string;
  envelopeCode: string;
  envelopeDescription: string;
  inserts: { code: string; description: string; quantity: number }[];
  postalProvider: string;
  postalServiceName: string;
  serviceCode: string | null;
  postalFormat: string;
  /** One entry per mailpiece: the weight band (grams) it was priced in, or null when unknown. */
  weightBandsG: (number | null)[];
  returnAddress: string | null;
  isLargePrint?: boolean;
}

/** Paper names look like "A4 White", "A5 White", "A4 White - Edge-to-edge". */
export function paperFacts(paper: string): { size: string; description: string; edgeToEdge: boolean } {
  return { size: paper.slice(0, 2).toUpperCase(), description: paper.slice(3).toLowerCase(), edgeToEdge: /edge[- ]?to[- ]?edge/i.test(paper) };
}

/** Same wording as the FileMaker "Print method" calculation. */
export function printMethod(paper: string, isDuplex: boolean, colour: string, isLargePrint = false): string {
  const { size, description, edgeToEdge } = paperFacts(paper);
  const sides = isDuplex ? 'duplex' : 'simplex';
  const col = /colo/i.test(colour) ? 'colour' : 'mono';
  if (isLargePrint) return `Finished size A3; scale to A3; 1-up on A3 white; ${col}; duplex`;
  if (edgeToEdge) return `Finished size ${size}; 1-up on SRA4; ${col}; ${sides}`;
  if (size === 'A5') return `Finished size A5; 2-up on A4 ${description} (cut and stack); ${col}; ${sides}`;
  return `Finished size ${size}; printed 1-up on ${paper}; ${col}; ${sides}`;
}

/** "12 x 100g" lines, lightest band first. Mailpieces with no known band are listed last as "unbanded". */
export function weightBandLines(bands: (number | null)[]): string[] {
  const n = new Map<number | null, number>();
  for (const b of bands) n.set(b, (n.get(b) ?? 0) + 1);
  return [...n].sort((a, b) => (a[0] ?? Infinity) - (b[0] ?? Infinity))
    .map(([band, count]) => `${count.toLocaleString('en-GB')} x ${band === null ? 'unbanded' : `${band}g`}`);
}

export function postalServiceText(name: string, code: string | null): string {
  return code ? `${name} (${code})` : name;
}

/** FileMaker's print file name: "77440 - IntelliDoc - Uinsure - 81899 - Batch 16 of 23.pdf". */
export function fileNameFor(i: RunSheetInput): string {
  const raw = [i.jobNumber, 'IntelliDoc', i.customerName, String(i.batchCode), `Batch ${i.batchNumber} of ${i.batchTotal}`].filter((x) => x !== '').join(' - ');
  return `${raw.replace(/[\\/:*?"<>|]/g, '-')}.pdf`;
}

export function buildRunSheet(i: RunSheetInput): RunSheetData {
  const code = String(i.batchCode);
  return {
    batchCode: code,
    brand: i.brand,
    fileName: fileNameFor(i),
    jobNumber: i.jobNumber,
    customerName: i.customerName,
    dateSubmitted: i.submitted.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/London' }),
    printMethod: printMethod(i.paper, i.isDuplex, i.colour, i.isLargePrint),
    totalMailpieces: i.mailpieces,
    totalPages: i.pages,
    department: i.department.replace(/\b[a-z]/g, (c) => c.toUpperCase()),
    envelope: `${i.envelopeCode} : ${i.envelopeDescription}`,
    inserts: i.inserts.map((x) => `${x.code} : ${x.description}${x.quantity > 1 ? ` (x${x.quantity})` : ''}`),
    postalProvider: i.postalProvider,
    postalService: postalServiceText(i.postalServiceName, i.serviceCode),
    isInternational: /international/i.test(i.postalServiceName),
    postalFormat: i.postalFormat,
    weightBands: weightBandLines(i.weightBandsG),
    returnAddress: i.returnAddress ? i.returnAddress.replace(/[\r\n\u000b¶]+/g, ', ') : null,
  };
}

const DEPARTMENT: Record<EnclosingMethod, string> = { MACHINE: 'Machine enclosing', HAND: 'Hand enclosing', RECEPTION: 'Reception' };

/** Builds run sheets straight from an ingest result (no database), with temporary batch codes starting at `firstCode`. */
export function runSheetsFromIngest(r: IngestResult, ref: ReferenceData, opts: { firstCode: number; jobNumber?: string; customerName?: string; submitted?: Date; }): RunSheetData[] {
  const byId = new Map<number, Mailpiece>(r.mailpieces.map((m) => [m.id, m]));
  return r.batches.map((b: Batch, idx: number) => {
    const mps = b.mailpieceIds.map((id) => byId.get(id)!);
    const first = mps[0]!;
    const opt = first.option;
    const options = first.packs[0]!.parsed.options;
    const stock = ref.stock.get(b.envelopeCode);
    return buildRunSheet({
      batchCode: opts.firstCode + idx, brand: b.brand, batchNumber: idx + 1, batchTotal: r.batches.length,
      jobNumber: opts.jobNumber ?? b.accountCode,
      customerName: opts.customerName ?? b.accountCode,
      submitted: opts.submitted ?? new Date(),
      paper: options.paper,
      isDuplex: options.duplex,
      colour: options.colour,
      mailpieces: mps.length,
      pages: mps.reduce((n, m) => n + m.packs.reduce((p, k) => p + k.parsed.pageCount, 0), 0),
      department: DEPARTMENT[b.enclosing],
      envelopeCode: b.envelopeCode,
      envelopeDescription: stock?.description ?? b.envelopeSize,
      inserts: b.inserts.map((x) => ({ code: x.code, description: ref.stock.get(x.code)?.description ?? '', quantity: x.quantity })),
      postalProvider: opt?.postalProvider ?? '',
      postalServiceName: opt?.postalServiceName ?? b.postalService,
      serviceCode: opt?.serviceCode ?? null,
      postalFormat: b.postalFormat,
      weightBandsG: mps.map((m) => m.option?.maxWeightG ?? null),
      returnAddress: null,
    });
  });
}
