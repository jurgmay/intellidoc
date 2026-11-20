import { parseHpodV6 } from './parser.js';
import { normaliseAddress } from './address.js';
import { exclusionFor, groupPacks } from './matching.js';
import { choosePhysical, PhysicalError } from './physical.js';
import { batchKey, buildBatches, routeFor } from './batching.js';
import type { PdfInspector } from './pdf.js';
import type { Repository } from './repository.js';
import type { ReferenceData, AccountConfig } from './reference.js';
import type { IngestIssue, IngestPack, IngestResult, Mailpiece, ParsedPack } from './types.js';

export interface IngestOptions { checkPostcodes?: boolean }

function refText(envelopeValue: string): string {
  const i = envelopeValue.indexOf('ref: ');
  return i < 0 ? '' : envelopeValue.slice(i + 5).trim();
}

/** Brand: passthrough Brand, else the account's envelope config for the stock code, else brand name in envelope text. */
function deriveBrand(p: ParsedPack, acct: AccountConfig, ref: string): string | null {
  const pt = p.passthrough['Brand'];
  if (pt) return pt;
  const byCode = acct.envelopes.find((e) => e.stockCode === p.options.envelopeCode && e.brand);
  if (byCode) return byCode.brand;
  const t = p.options.envelopeValue.toUpperCase();
  return acct.brands.find((b) => t.includes(b.toUpperCase())) ?? (ref || null);
}

export function validatePageRanges(packs: ParsedPack[], pdfPages: number): IngestIssue[] {
  const issues: IngestIssue[] = [];
  const err = (packGuid: string | undefined, message: string): void => { issues.push({ severity: 'error', packGuid, message }); };
  const sorted = [...packs].sort((a, b) => a.startPage - b.startPage);
  let expect = 1;
  const seen = new Set<string>();
  for (const p of sorted) {
    if (seen.has(p.guid)) err(p.guid, 'Duplicate pack GUID within file');
    seen.add(p.guid);
    if (p.endPage - p.startPage + 1 !== p.pageCount) err(p.guid, `PageCount ${p.pageCount} does not match range ${p.startPage}-${p.endPage}`);
    if (p.startPage !== expect) err(p.guid, `Page range starts at ${p.startPage}, expected ${expect} (gap or overlap)`);
    expect = p.endPage + 1;
  }
  if (packs.length && expect - 1 !== pdfPages) err(undefined, `Pack ranges cover ${expect - 1} pages but the PDF has ${pdfPages}`);
  return issues;
}

export async function ingest(
  xml: string, xmlName: string, pdfPath: string,
  deps: { ref: ReferenceData; pdf: PdfInspector; repo: Repository },
  opts: IngestOptions = {},
): Promise<IngestResult> {
  const { ref, pdf, repo } = deps;
  const issues: IngestIssue[] = [];
  const parsed = parseHpodV6(xml);
  const pdfPages = await pdf.pageCount(pdfPath);
  issues.push(...validatePageRanges(parsed, pdfPages));

  const duplicates: string[] = [];
  const packs: IngestPack[] = [];
  for (const p of parsed) {
    if (await repo.packExists(p.guid)) { duplicates.push(p.guid); continue; }
    const acct = ref.accounts.get(p.source.ownerAccount);
    if (!acct) { issues.push({ severity: 'error', packGuid: p.guid, message: `Unknown account "${p.source.ownerAccount}"` }); continue; }
    if (!p.address.surname && !p.address.firstName && p.address.lines.length === 0) {
      issues.push({ severity: 'error', packGuid: p.guid, message: 'Pack has no addressee' }); continue;
    }
    const address = normaliseAddress(p);
    const reference = refText(p.options.envelopeValue);
    const brand = deriveBrand(p, acct, reference);
    packs.push({
      parsed: p, address, accountCode: acct.code, brand, brandReference: reference,
      sheets: p.options.duplex ? Math.ceil(p.pageCount / 2) : p.pageCount,
      matchExclusion: exclusionFor(p, address, acct, ref),
      batchingValue: acct.batchingKey ? (p.passthrough[acct.batchingKey] ?? '') : '',
    });
    if (opts.checkPostcodes) {
      const text = (await pdf.pageText(pdfPath, p.startPage)).replace(/\s+/g, '').toUpperCase();
      if (!text.includes(address.postcode.replace(/\s+/g, ''))) {
        issues.push({ severity: 'warning', packGuid: p.guid, message: `Postcode ${address.postcode} not found on start page ${p.startPage}` });
      }
    }
  }

  const mailpieces: Mailpiece[] = [];
  if (!issues.some((i) => i.severity === 'error')) {
    let id = 1;
    for (const g of groupPacks(packs, ref)) {
      const first = g[0]!;
      const acct = ref.accounts.get(first.accountCode)!;
      // union of inserts, one per code per mailpiece (quantity = max over packs)
      const q = new Map<string, number>();
      for (const p of g) {
        const per = new Map<string, number>();
        for (const i of p.parsed.inserts) per.set(i.code, (per.get(i.code) ?? 0) + 1);
        for (const [c, n] of per) q.set(c, Math.max(q.get(c) ?? 0, n));
      }
      const insertCodes = [...q].map(([code, quantity]) => ({ code, quantity })).sort((a, b) => a.code.localeCompare(b.code));
      try {
        const phys = choosePhysical(g, insertCodes, acct, first.brand, first.brandReference, first.parsed.options.envelopeCode, ref);
        const base = {
          addressHash: first.address.hash, packs: g, accountCode: first.accountCode, brand: first.brand,
          sheets: phys.sheets, insertCodes, weightG: phys.weightG, thicknessMm: phys.thicknessMm,
          postalFormat: phys.postalFormat, envelopeCode: phys.envelope.stockCode, envelopeSize: phys.envelope.size,
          postalService: first.parsed.options.deliveryMethod,
          paper: ref.paperBatchNames.get(first.parsed.options.paper) ?? first.parsed.options.paper,
          batchingValue: first.batchingValue,
          route: routeFor(phys.sheets, phys.envelope.size, ref),
        };
        mailpieces.push({ ...base, id: id++, batchKey: batchKey(base) });
      } catch (e) {
        if (!(e instanceof PhysicalError)) throw e;
        for (const p of g) issues.push({ severity: 'error', packGuid: p.parsed.guid, message: e.message });
      }
    }
  }

  const batches = buildBatches(mailpieces, ref);
  const failed = issues.some((i) => i.severity === 'error');
  const result: IngestResult = { xmlName, pdfPages, packs, mailpieces, batches, duplicates, issues, persisted: false };
  if (!failed && packs.length > 0) { await repo.saveJob(result); result.persisted = true; }
  return result;
}
