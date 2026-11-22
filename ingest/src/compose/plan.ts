/**
 * PDF composition, the pure part: which mailpiece goes where in the print file(s) of a batch. No PDF, no database.
 * The rules are the ones in FileMaker's "@Create PDFs" script (see docs/pdf-composition.md).
 */
import type { ColourMode } from '../costing/colour.js';

export interface PlanPack {
  packId: number;
  startPage: number; // pages of the source PDF, 1-based, inclusive
  endPage: number;
  submittingAccountId: number;
  releaseDate: Date;
  documentSequence: number;
  /** The pack's own option set says Mono: every page of it is printed mono, whatever the colour mode. */
  forceMono: boolean;
}

export interface PlanMailpiece {
  mailpieceId: number;
  /** Set when the batch has been composed before; kept so a re-compose never renumbers. */
  sequenceNumber: number | null;
  /** The weight band the mailpiece was priced in (postal_rate.max_weight_g); null when unknown (sorts last). */
  weightBandG: number | null;
  isCancelled: boolean;
  colourMode: ColourMode;
  isAddressMatching: boolean;
  packs: PlanPack[];
}

export interface PlanOptions {
  /** A file is closed after the mailpiece that takes it past this many pages (so it can run over by one mailpiece). */
  maxPagesPerPdf: number;
  /** Pages the batch's run sheet takes at the front of the first file, already rounded up to an even number. */
  runSheetPages: number;
}

export type PageKind = 'run-sheet' | 'source' | 'blank';
export interface PlannedPage {
  kind: PageKind;
  /** 1-based page of the source PDF (kind = source). */
  sourcePage?: number;
  /** Print this page in greyscale. */
  mono: boolean;
  /** Set on the first page of a mailpiece: the page that carries the control marks. */
  mailpieceStart?: { mailpieceId: number; sequenceNumber: number };
}
export interface PlannedSegment {
  segmentNumber: number;
  pages: PlannedPage[];
  mailpieces: { mailpieceId: number; sequenceNumber: number; outputPage: number }[];
  packs: { packId: number; outputStart: number; outputEnd: number }[];
}
export interface BatchPlan {
  /** Numbers given in this run: mailpieceId -> sequence number (only mailpieces that had none). */
  newSequences: Map<number, number>;
  segments: PlannedSegment[];
}

const firstPage = (m: PlanMailpiece): number => Math.min(...m.packs.map((p) => p.startPage));

/**
 * Sequence numbers: when no mailpiece has one yet they are given out 1..n by weight band, lightest first (then source order), the way
 * FileMaker did it so the enclosing line sees the light mail first. Mailpieces added later get the next numbers after the highest.
 */
export function assignSequences(mailpieces: PlanMailpiece[]): Map<number, number> {
  const live = mailpieces.filter((m) => !m.isCancelled && m.packs.length > 0);
  const out = new Map<number, number>();
  let next = Math.max(0, ...live.map((m) => m.sequenceNumber ?? 0)) + 1;
  const todo = live.filter((m) => m.sequenceNumber === null);
  todo.sort((a, b) => (a.weightBandG ?? Infinity) - (b.weightBandG ?? Infinity) || firstPage(a) - firstPage(b) || a.mailpieceId - b.mailpieceId);
  for (const m of todo) out.set(m.mailpieceId, next++);
  return out;
}

/** The order of the packs inside one mailpiece. */
export function orderPacks(m: PlanMailpiece): PlanPack[] {
  const byAddress = (a: PlanPack, b: PlanPack): number => a.documentSequence - b.documentSequence || a.startPage - b.startPage;
  const byOwner = (a: PlanPack, b: PlanPack): number =>
    a.submittingAccountId - b.submittingAccountId || a.releaseDate.getTime() - b.releaseDate.getTime() || a.startPage - b.startPage;
  return [...m.packs].sort(m.isAddressMatching ? byAddress : byOwner);
}

/** Whether page `n` (1-based) of a pack is printed mono, for the mailpiece's colour mode. `packIndex` is the pack's place in the mailpiece (0 = first). */
export function isMonoPage(mode: ColourMode, forceMono: boolean, packIndex: number, pageInPack: number): boolean {
  if (forceMono) return true;
  switch (mode) {
    case 'ALL_MONO': return true;
    case 'FIRST_PACK_PAGE': return pageInPack > 1;
    case 'FIRST_MAILPIECE_PAGE': return !(packIndex === 0 && pageInPack === 1);
    default: return false;
  }
}

export function planBatch(mailpieces: PlanMailpiece[], opts: PlanOptions): BatchPlan {
  if (!(opts.maxPagesPerPdf >= 2)) throw new Error('maxPagesPerPdf must be at least 2');
  const newSequences = assignSequences(mailpieces);
  const seqOf = (m: PlanMailpiece): number => m.sequenceNumber ?? newSequences.get(m.mailpieceId)!;
  const ordered = mailpieces.filter((m) => !m.isCancelled && m.packs.length > 0).sort((a, b) => seqOf(a) - seqOf(b));

  const segments: PlannedSegment[] = [];
  let seg: PlannedSegment | null = null;
  const open = (): PlannedSegment => {
    const s: PlannedSegment = { segmentNumber: segments.length + 1, pages: [], mailpieces: [], packs: [] };
    if (s.segmentNumber === 1) for (let i = 0; i < opts.runSheetPages; i++) s.pages.push({ kind: 'run-sheet', mono: false });
    segments.push(s);
    return s;
  };

  for (const m of ordered) {
    seg ??= open();
    const sequenceNumber = seqOf(m);
    seg.mailpieces.push({ mailpieceId: m.mailpieceId, sequenceNumber, outputPage: seg.pages.length + 1 });
    orderPacks(m).forEach((p, packIndex) => {
      const outputStart = seg!.pages.length + 1;
      const count = p.endPage - p.startPage + 1;
      for (let n = 1; n <= count; n++) {
        const page: PlannedPage = { kind: 'source', sourcePage: p.startPage + n - 1, mono: isMonoPage(m.colourMode, p.forceMono, packIndex, n) };
        if (packIndex === 0 && n === 1) page.mailpieceStart = { mailpieceId: m.mailpieceId, sequenceNumber };
        seg!.pages.push(page);
      }
      if (count % 2 === 1) seg!.pages.push({ kind: 'blank', mono: false }); // every pack starts on the front of a sheet
      seg!.packs.push({ packId: p.packId, outputStart, outputEnd: seg!.pages.length });
    });
    if (seg.pages.length > opts.maxPagesPerPdf) seg = null; // closed after the mailpiece that went over
  }
  return { newSequences, segments };
}

/** Source pages that have to be converted to greyscale, in ascending order, once. */
export function pagesToGrey(plan: BatchPlan): number[] {
  const set = new Set<number>();
  for (const s of plan.segments) for (const p of s.pages) if (p.kind === 'source' && p.mono) set.add(p.sourcePage!);
  return [...set].sort((a, b) => a - b);
}
