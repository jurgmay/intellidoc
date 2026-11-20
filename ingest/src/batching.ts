import { createHash } from 'node:crypto';
import type { Batch, EnclosingMethod, EnclosingRoute, Mailpiece } from './types.js';
import type { ReferenceData } from './reference.js';

export function routeFor(sheets: number, envelopeSize: string, ref: ReferenceData): EnclosingRoute {
  const s = ref.settings;
  if (sheets > s.handEnclosingMaxSheets) return 'RECEPTION';
  if (envelopeSize === s.machineEnclosingEnvelopeSize && sheets <= s.machineEnclosingMaxSheets) return 'MACHINE_CANDIDATE';
  return 'HAND';
}

export function batchKey(m: Omit<Mailpiece, 'batchKey' | 'id'>): string {
  const canonical = [
    m.accountCode, m.brand ?? '', m.envelopeCode, m.postalService, m.postalFormat, m.paper,
    m.insertCodes.map((i) => `${i.code}x${i.quantity}`).sort().join(','), m.batchingValue, m.route,
  ].join('|');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** Batches of MORE than N mailpieces whose route is MACHINE_CANDIDATE go to the machine; 25 or fewer go to hand. */
export function buildBatches(mps: Mailpiece[], ref: ReferenceData): Batch[] {
  const by = new Map<string, Mailpiece[]>();
  for (const m of mps) { const g = by.get(m.batchKey); if (g) g.push(m); else by.set(m.batchKey, [m]); }
  const out: Batch[] = [];
  for (const [key, g] of by) {
    const f = g[0]!;
    let enclosing: EnclosingMethod;
    if (f.route === 'RECEPTION') enclosing = 'RECEPTION';
    else if (f.route === 'MACHINE_CANDIDATE' && g.length > ref.settings.machineEnclosingMinMailpieces) enclosing = 'MACHINE';
    else enclosing = 'HAND';
    out.push({
      key, accountCode: f.accountCode, brand: f.brand, envelopeCode: f.envelopeCode, envelopeSize: f.envelopeSize,
      postalService: f.postalService, postalFormat: f.postalFormat, paper: f.paper,
      insertCodes: f.insertCodes.map((i) => i.code).sort(), inserts: f.insertCodes, batchingValue: f.batchingValue,
      postalServiceId: f.postalServiceId,
      route: f.route, enclosing, mailpieceIds: g.map((m) => m.id), sheetTotal: g.reduce((n, m) => n + m.sheets, 0),
    });
  }
  return out;
}
