import type { IngestResult } from './types.js';

/** Compact, human-readable record of what an ingest did (written next to the processed files). */
export function summarise(r: IngestResult): Record<string, unknown> {
  const merged = r.mailpieces.filter((m) => m.packs.length > 1).length;
  const exclusions: Record<string, number> = {};
  for (const p of r.packs) if (p.matchExclusion) exclusions[p.matchExclusion] = (exclusions[p.matchExclusion] ?? 0) + 1;
  return {
    xml: r.xmlName, pdf: r.pdfName, pdfPages: r.pdfPages, persisted: r.persisted,
    packs: r.packs.length, duplicatePacksSkipped: r.duplicates.length, mailpieces: r.mailpieces.length, mergedMailpieces: merged,
    matchExclusions: exclusions,
    batches: r.batches.map((b) => ({
      key: b.key.slice(0, 8), customer: b.accountCode, brand: b.brand, envelope: `${b.envelopeCode}/${b.envelopeSize}`, service: b.postalService,
      format: b.postalFormat, paper: b.paper, inserts: b.inserts.map((i) => `${i.code}x${i.quantity}`), batchingValue: b.batchingValue || undefined,
      route: b.route, enclosing: b.enclosing, mailpieces: b.mailpieceIds.length, sheets: b.sheetTotal,
    })),
    issues: r.issues,
  };
}
