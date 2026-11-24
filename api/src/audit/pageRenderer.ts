import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { PageRenderer } from './types.js';

const run = promisify(execFile);

/** The newest file in `dir` named `name`, or `name` with the watcher's clash prefix (yyyymmddhhmmss, optionally -n, then an underscore). Null when there is none. */
export async function findSourcePdf(dir: string, name: string): Promise<string | null> {
  const lower = name.toLowerCase();
  let names: string[];
  try { names = await readdir(dir); } catch { return null; }
  const hits = names.filter((f) => { const l = f.toLowerCase(); return l === lower || (l.endsWith(`_${lower}`) && /^\d{14}(-\d+)?$/.test(l.slice(0, l.length - lower.length - 1))); });
  if (!hits.length) return null;
  const withTime = await Promise.all(hits.map(async (f) => ({ f, t: (await stat(join(dir, f))).mtimeMs })));
  return join(dir, withTime.sort((a, b) => b.t - a.t)[0]!.f);
}

export const ghostscriptPageArgs = (input: string, output: string, page: number, dpi: number): string[] =>
  ['-q', '-dBATCH', '-dNOPAUSE', '-dSAFER', '-sDEVICE=jpeg', '-dJPEGQ=70', `-r${dpi}`, `-dFirstPage=${page}`, `-dLastPage=${page}`, `-sOutputFile=${output}`, input];

/** Renders one page of the customer's PDF (kept in the watcher's processed folder for a limited time) as a small JPEG. */
export class GhostscriptPageRenderer implements PageRenderer {
  constructor(private readonly pdfDir: string, private readonly exe: string = process.env['GS_PATH'] || (process.platform === 'win32' ? 'gswin64c' : 'gs'), private readonly dpi = 70) {}

  async firstPage(pdfFileName: string, pageNumber: number): Promise<Uint8Array | null> {
    const file = await findSourcePdf(this.pdfDir, pdfFileName);
    if (!file) return null;
    const dir = await mkdtemp(join(tmpdir(), 'idoc-page-'));
    try {
      const out = join(dir, 'page.jpg');
      try { await run(this.exe, ghostscriptPageArgs(file, out, pageNumber, this.dpi), { maxBuffer: 16 * 1024 * 1024 }); }
      catch (e) {
        const err = e as NodeJS.ErrnoException & { stderr?: string };
        if (err.code === 'ENOENT') throw new Error(`Ghostscript was not found (${this.exe}). Install it, or set GS_PATH to its executable.`);
        return null;   // a damaged PDF or a page that is not there: the report says the image is not available
      }
      return new Uint8Array(await readFile(out));
    } catch (e) { if ((e as Error).message.startsWith('Ghostscript was not found')) throw e; return null; }
    finally { await rm(dir, { recursive: true, force: true }); }
  }
}
