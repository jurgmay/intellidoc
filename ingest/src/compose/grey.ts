import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { PDFDocument } from 'pdf-lib';

const run = promisify(execFile);

/** Turns every page of a PDF into greyscale. pdf-lib cannot convert colour, so Ghostscript does it. */
export interface GreyConverter { convert(pdf: Uint8Array): Promise<Uint8Array> }

/** The Ghostscript arguments: pdfwrite with every colour converted to DeviceGray. */
export function ghostscriptArgs(input: string, output: string): string[] {
  return ['-q', '-dBATCH', '-dNOPAUSE', '-dSAFER', '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.7', '-sColorConversionStrategy=Gray',
    '-dProcessColorModel=/DeviceGray', '-dAutoRotatePages=/None', '-dPreserveTrimBox=true', `-sOutputFile=${output}`, input];
}

export class GhostscriptGrey implements GreyConverter {
  /** `GS_PATH` names the executable (gswin64c on Windows, gs elsewhere). */
  constructor(private readonly exe: string = process.env['GS_PATH'] || (process.platform === 'win32' ? 'gswin64c' : 'gs')) {}

  async convert(pdf: Uint8Array): Promise<Uint8Array> {
    const dir = await mkdtemp(join(tmpdir(), 'idoc-grey-'));
    try {
      const input = join(dir, 'in.pdf'), output = join(dir, 'out.pdf');
      await writeFile(input, pdf);
      try { await run(this.exe, ghostscriptArgs(input, output), { maxBuffer: 16 * 1024 * 1024 }); }
      catch (e) {
        const err = e as NodeJS.ErrnoException & { stderr?: string };
        if (err.code === 'ENOENT') throw new Error(`Ghostscript was not found (${this.exe}). Install it, or set GS_PATH to its executable.`);
        throw new Error(`Ghostscript failed: ${(err.stderr || err.message).trim().slice(0, 500)}`);
      }
      const out = new Uint8Array(await readFile(output));
      const want = (await PDFDocument.load(pdf)).getPageCount(), got = (await PDFDocument.load(out)).getPageCount();
      if (want !== got) throw new Error(`Ghostscript returned ${got} pages for ${want}`);
      return out;
    } finally { await rm(dir, { recursive: true, force: true }); }
  }
}
