import { readFile } from 'node:fs/promises';
import { basename, parse } from 'node:path';
import { ingest } from '../ingest.js';
import { summarise } from '../summary.js';
import type { PdfInspector } from '../pdf.js';
import type { PdfTracker, Repository } from '../repository.js';
import { validatePageRanges } from '../ingest.js';
import type { Mailer } from '../mail.js';
import type { ReferenceData } from '../reference.js';
import type { Outcome } from './folderWatcher.js';

const TRANSIENT_CODES = new Set(['ECONNCLOSED', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEOUT', 'ESOCKET', 'ETIMEDOUT', 'ENOTOPEN', 'ELOGIN', 'ENETUNREACH', 'EHOSTUNREACH']);

/** Database connectivity problems are retried; everything else is a property of the file and is not. */
export function isTransient(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  if (err.code && TRANSIENT_CODES.has(err.code)) return true;
  return /connection (is )?closed|failed to connect|connection lost|socket hang up|timeout/i.test(err.message ?? '');
}

/** Decode an XML file honouring a UTF-8 or UTF-16 byte-order mark. */
export function decodeXml(buf: Buffer): string {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.toString('utf8', 3);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le', 2);
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) { const b = Buffer.from(buf.subarray(2)); b.swap16(); return b.toString('utf16le'); }
  return buf.toString('utf8');
}

export interface ProcessorDeps {
  loadReference: () => Promise<ReferenceData>;
  repo: Repository;
  pdf: PdfInspector;
  checkPostcodes?: boolean;
}

export function makeProcessor(d: ProcessorDeps): (xmlPath: string, pdfPath: string | null) => Promise<Outcome> {
  return async (xmlPath, pdfPath) => {
    try {
      const xml = decodeXml(await readFile(xmlPath));
      const ref = await d.loadReference(); // fresh each time so configuration changes apply to the next file
      const r = await ingest(xml, basename(xmlPath), pdfPath, { ref, pdf: d.pdf, repo: d.repo }, { checkPostcodes: d.checkPostcodes });
      const summary = summarise(r);
      const errors = r.issues.filter((i) => i.severity === 'error');
      if (errors.length > 0) {
        const lines = errors.slice(0, 20).map((i) => `- ${i.packGuid ? `[${i.packGuid}] ` : ''}${i.message}`);
        return { kind: 'failed', summary, message: `${errors.length} error(s), nothing was saved:\n${lines.join('\n')}${errors.length > 20 ? `\n... and ${errors.length - 20} more` : ''}` };
      }
      if (r.packs.length === 0 && r.duplicates.length > 0) return { kind: 'duplicate', summary };
      if (r.packs.length === 0) return { kind: 'failed', summary, message: 'The XML contains no packs' };
      return { kind: 'processed', summary };
    } catch (e) {
      if (isTransient(e)) return { kind: 'retry', message: `Database not available (${(e as Error).message})` };
      return { kind: 'failed', summary: {}, message: `${(e as Error).name}: ${(e as Error).message}` };
    }
  };
}

export interface AttachDeps {
  repo: PdfTracker;
  pdf: PdfInspector;
  /** Told when a PDF was rejected, or arrived after a "PDF is late" alert. */
  notify?: (to: 'ops', subject: string, text: string) => Promise<void>;
}

/** A PDF turned up for a job that was imported from its XML alone: check it against the pack page ranges and attach it. */
export function makeAttachProcessor(d: AttachDeps): (pdfPath: string) => Promise<Outcome | { kind: 'unmatched' }> {
  return async (pdfPath) => {
    const baseName = parse(pdfPath).name;
    try {
      const job = await d.repo.findAwaitingPdf(baseName);
      if (!job) return { kind: 'unmatched' };
      const pages = await d.pdf.pageCount(pdfPath);
      const errors = validatePageRanges(job.packs, pages).filter((i) => i.severity === 'error');
      if (errors.length > 0) {
        const message = `${basename(pdfPath)} does not match ${job.xmlName}:\n${errors.slice(0, 10).map((e) => `- ${e.message}`).join('\n')}`;
        await d.repo.markPdfRejected(job.jobId, message);
        await d.notify?.('ops', `IntelliDoc: PDF rejected for ${baseName}`, `${message}\n\nThe job stays blocked until a correct PDF is supplied.`);
        return { kind: 'failed', summary: { job: job.xmlName, pdfPages: pages }, message };
      }
      const { alertCount } = await d.repo.markPdfReceived(job.jobId, pages);
      if (alertCount > 0) await d.notify?.('ops', `IntelliDoc: PDF received for ${baseName}`, `The PDF for ${job.xmlName} has now arrived (${pages} pages) and matches the data.`);
      return { kind: 'processed', summary: { job: job.xmlName, pdfPages: pages, attached: true } };
    } catch (e) {
      if (isTransient(e)) return { kind: 'retry', message: `Database not available (${(e as Error).message})` };
      return { kind: 'failed', summary: {}, message: `${(e as Error).name}: ${(e as Error).message}` };
    }
  };
}
