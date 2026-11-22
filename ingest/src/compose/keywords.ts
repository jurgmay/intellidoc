/**
 * The PDF keywords written for a batch. Comma separated, as the archive and imposition software expect.
 *  - Archiving customers get archiving_customer / archiving_provider / archiving_directory (only the tags that are set).
 *    FileMaker also skipped batches already archived; there is no archiving process here yet, so every batch counts as not archived.
 *  - Edge-to-edge paper is imposed on SRA4: imposition:SRA4. (FileMaker overwrote the archive keywords with this one; both are written here.)
 */
export interface KeywordSource {
  archive: { customerTag: string | null; providerTag: string | null; directoryTag: string | null } | null;
  edgeToEdge: boolean;
}

/** One string, comma separated with no spaces (pdf-lib would join a list with spaces), or undefined when there is nothing to write. */
export function batchKeywords(s: KeywordSource): string | undefined {
  const k: string[] = [];
  if (s.archive) {
    if (s.archive.customerTag) k.push(`archiving_customer:${s.archive.customerTag}`);
    if (s.archive.providerTag) k.push(`archiving_provider:${s.archive.providerTag}`);
    if (s.archive.directoryTag) k.push(`archiving_directory:${s.archive.directoryTag}`);
  }
  if (s.edgeToEdge) k.push('imposition:SRA4');
  return k.length > 0 ? k.join(',') : undefined;
}
