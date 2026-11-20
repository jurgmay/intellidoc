import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

export interface PdfInspector {
  pageCount(path: string): Promise<number>;
  /** Text of a single page (1-based); used only for the optional postcode-on-start-page check. */
  pageText(path: string, page: number): Promise<string>;
}

/** Uses qpdf / pdftotext with argument arrays (no shell). Streams from disk: safe for 70MB+ PDFs. */
export class CliPdfInspector implements PdfInspector {
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
