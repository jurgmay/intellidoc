import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { ingest } from '../ingest.js';
import { summarise } from '../summary.js';
import type { PdfInspector } from '../pdf.js';
import type { Repository } from '../repository.js';
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

export function makeProcessor(d: ProcessorDeps): (xmlPath: string, pdfPath: string) => Promise<Outcome> {
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
