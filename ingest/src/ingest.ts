import type { Progress } from './activity.js';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { parseHpodV6 } from './parser.js';
import { normaliseAddress } from './address.js';
import { comparePacks } from './packOrder.js';
import { exclusionFor, groupPacks, matchKey } from './matching.js';
import { parseEnvelopeText } from './envelopeText.js';
import { choosePhysical, PhysicalError } from './physical.js';
import { batchKey, buildBatches, routeFor } from './batching.js';
import type { PdfInspector } from './pdf.js';
import { inkPerRange, type PageInk } from './pdfInk.js';
import type { Repository } from './repository.js';
import type { ReferenceData, AccountConfig } from './reference.js';
import type { IngestIssue, IngestPack, IngestResult, Mailpiece, ParsedPack } from './types.js';

export interface IngestOptions { checkPostcodes?: boolean; progress?: Progress }

/** Brand: the passthrough "Brand" (taken from the letter template, always right), else the brand in brackets in the envelope text,
 *  else the account's envelope config for the stock code, else a brand name found in the text. */
function deriveBrand(p: ParsedPack, acct: AccountConfig, textBrand: string | null, ref: string): string | null {
  const pt = p.passthrough['Brand'];
  if (pt) return pt;
  if (textBrand) return acct.brands.find((b) => b.toLowerCase() === textBrand.toLowerCase()) ?? textBrand;
  const byCode = acct.envelopes.find((e) => e.stockCode === p.options.envelopeCode && e.brand);
  if (byCode) return byCode.brand;
  const t = p.options.envelopeValue.toUpperCase();
  return acct.brands.find((b) => t.includes(b.toUpperCase())) ?? (ref || null);
}

export function validatePageRanges(packs: Pick<ParsedPack, 'guid' | 'pageCount' | 'startPage' | 'endPage'>[], pdfPages: number): IngestIssue[] {
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
  xml: string, xmlName: string, pdfPath: string | null,
  deps: { ref: ReferenceData; pdf: PdfInspector; repo: Repository },
  opts: IngestOptions = {},
): Promise<IngestResult> {
  const { ref, pdf, repo } = deps;
  const issues: IngestIssue[] = [];
  const parsed = parseHpodV6(xml);
  // XML-first: with no PDF yet the job is saved from the XML alone. The ranges are still checked for gaps and overlaps against
  // themselves; they are checked against the real PDF when it arrives (attachPdf).
  if (pdfPath !== null) opts.progress?.(0, null, 'Counting the pages');
  const pdfPages = pdfPath === null ? parsed.reduce((m, p) => Math.max(m, p.endPage), 0) : await pdf.pageCount(pdfPath);
  issues.push(...validatePageRanges(parsed, pdfPages));
  // What each page carries (colour, mono, blank), for pricing. A PDF that cannot be read this way does not stop the job: its packs just have no counts yet.
  let inkPages: PageInk[] | null = null;
  if (pdfPath !== null) {
    try {
      inkPages = await pdf.pageInk(pdfPath, opts.progress);
      if (inkPages.length !== pdfPages) inkPages = null;
    } catch (e) {
      issues.push({ severity: 'warning', message: `The colour of the pages could not be read: ${(e as Error).message}` });
    }
  }

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
    const text = parseEnvelopeText(p.options.envelopeValue, acct.envelopes.map((e) => e.reference), acct.brands);
    const reference = text.reference;
    const brand = deriveBrand(p, acct, text.brand, reference);
    const seqKey = acct.packSequence ? p.passthrough[acct.packSequence.key] : undefined;
    const ip: IngestPack = {
      parsed: p, address, accountCode: acct.code, customerCode: acct.customerCode, invoicingCode: acct.invoicingCode, brand, brandReference: reference,
      sheets: p.options.duplex ? Math.ceil(p.pageCount / 2) : p.pageCount,
      matchExclusion: exclusionFor(p, address, acct, ref),
      batchingValue: acct.batchingKey ? (p.passthrough[acct.batchingKey] ?? '') : '',
      documentSequence: (seqKey !== undefined ? acct.packSequence?.rules.get(seqKey) : undefined) ?? 99,
      matchKey: '',
    };
    if (inkPages) ip.ink = inkPerRange(inkPages, [{ startPage: p.startPage, endPage: p.endPage }])[0];
    ip.matchKey = createHash('sha256').update(matchKey(ip, acct), 'utf8').digest('hex');
    packs.push(ip);
    if (opts.checkPostcodes && pdfPath !== null) {
      const text = (await pdf.pageText(pdfPath, p.startPage)).replace(/\s+/g, '').toUpperCase();
      if (!text.includes(address.postcode.replace(/\s+/g, ''))) {
        issues.push({ severity: 'warning', packGuid: p.guid, message: `Postcode ${address.postcode} not found on start page ${p.startPage}` });
      }
    }
  }

  const mailpieces: Mailpiece[] = [];
  if (!issues.some((i) => i.severity === 'error')) {
    let id = 1;
    // Packs go into mailpieces in owner account, owner user, release date order, so mailpieces are created (and numbered) in that order
    const key = (p: IngestPack) => ({ ownerAccount: p.parsed.source.ownerAccount, ownerUser: p.parsed.source.ownerUser, releaseDate: new Date(p.parsed.releaseDate ?? 0), startPage: p.parsed.startPage });
    packs.sort((a, b) => comparePacks(key(a), key(b)));
    for (const g of groupPacks(packs, ref)) {
      g.sort((a, b) => a.documentSequence - b.documentSequence || a.parsed.startPage - b.parsed.startPage);
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
        const phys = choosePhysical(g, insertCodes, acct, first.brand, first.brandReference, { code: first.parsed.options.envelopeCode, value: first.parsed.options.envelopeValue }, first.parsed.options.deliveryMethod, ref);
        if (phys.fallback) for (const p of g) issues.push({ severity: 'warning', packGuid: p.parsed.guid, message: `No configured envelope fits; used the selected envelope ${phys.envelope.stockCode} (${phys.postalFormat}, ${phys.weightG}g)` });
        const base = {
          addressHash: first.address.hash, packs: g, accountCode: first.customerCode, invoicingCode: first.invoicingCode, brand: first.brand,
          sheets: phys.sheets, insertCodes, weightG: phys.weightG, thicknessMm: phys.thicknessMm,
          postalFormat: phys.postalFormat, envelopeCode: phys.envelope.stockCode, envelopeSize: phys.envelope.size,
          postalService: first.parsed.options.deliveryMethod,
          paper: ref.paperBatchNames.get(first.parsed.options.paper) ?? first.parsed.options.paper,
          batchingValue: first.batchingValue,
          route: routeFor(phys.sheets, phys.envelope.size, ref),
          accountEnvelopeId: phys.envelope.accountEnvelopeId, postalRateId: phys.envelope.postalRateId, postalServiceId: phys.envelope.postalServiceId, option: phys.envelope,
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
  const result: IngestResult = { xmlName, pdfName: pdfPath === null ? `${basename(xmlName).replace(/\.xml$/i, '')}.pdf` : basename(pdfPath), pdfPages, pdfReceived: pdfPath !== null, packs, mailpieces, batches, duplicates, issues, persisted: false };
  if (!failed && packs.length > 0) { await repo.saveJob(result); result.persisted = true; }
  return result;
}
