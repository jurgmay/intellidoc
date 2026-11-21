import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { analysePageInk, type PageInk } from './pdfInk.js';
const run = promisify(execFile);

export interface PdfInspector {
  pageCount(path: string): Promise<number>;
  /** Text of a single page (1-based); used only for the optional postcode-on-start-page check. */
  pageText(path: string, page: number): Promise<string>;
  /** For every page: blank, mono (pure black only) or colour. Reads the whole file, so it is slower than the page count. */
  pageInk(path: string): Promise<PageInk[]>;
}

/** Uses qpdf / pdftotext with argument arrays (no shell). Streams from disk: safe for 70MB+ PDFs. */
/** Reads the page colours in-process, which needs no external tool. */
async function inkOf(path: string): Promise<PageInk[]> {
  const { readFile } = await import('node:fs/promises');
  return analysePageInk(await readFile(path));
}

export class CliPdfInspector implements PdfInspector {
  pageInk(path: string): Promise<PageInk[]> { return inkOf(path); }
  async pageCount(path: string): Promise<number> {
    const { stdout } = await run('qpdf', ['--show-npages', '--', path], { maxBuffer: 1 << 20 });
    const n = Number(stdout.trim());
    if (!Number.isInteger(n) || n < 1) throw new Error(`Cannot read page count of ${path}`);
    return n;
  }
  async pageText(path: string, page: number): Promise<string> {
    const { stdout } = await run('pdftotext', ['-f', String(page), '-l', String(page), '-layout', '--', path, '-'], { maxBuffer: 16 << 20 });
    return stdout;
  }
}

/** Pure-JS page counter (no external tools; works on Windows). Loads the whole PDF: ~140MB RAM for a 68MB file. */
export class PdfLibInspector implements PdfInspector {
  pageInk(path: string): Promise<PageInk[]> { return inkOf(path); }
  async pageCount(path: string): Promise<number> {
    const { readFile } = await import('node:fs/promises');
    const { PDFDocument } = await import('pdf-lib');
    const doc = await PDFDocument.load(await readFile(path), { updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: false });
    return doc.getPageCount();
  }
  async pageText(): Promise<string> {
    throw new Error('Postcode-on-start-page check needs qpdf + pdftotext (PDF_ENGINE=qpdf)');
  }
}
