import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { ingest } from './ingest.js';
import { CliPdfInspector } from './pdf.js';
import { InMemoryRepository } from './repository.js';
import { fixtureReference } from './fixtureReference.js';

const [xmlPath, pdfPath, ...flags] = process.argv.slice(2);
if (!xmlPath || !pdfPath) { console.error('usage: tsx src/cli.ts <file.xml> <file.pdf> [--check-postcodes]'); process.exit(2); }

const xml = await readFile(xmlPath, 'utf8');
const r = await ingest(xml, basename(xmlPath), pdfPath, { ref: fixtureReference(), pdf: new CliPdfInspector(), repo: new InMemoryRepository() },
  { checkPostcodes: flags.includes('--check-postcodes') });

const multi = r.mailpieces.filter((m) => m.packs.length > 1);
console.log(`${r.xmlName}: ${r.packs.length} packs, ${r.pdfPages} PDF pages -> ${r.mailpieces.length} mailpieces (${multi.length} merged) in ${r.batches.length} batches; persisted=${r.persisted}`);
for (const b of r.batches) {
  console.log(`  ${b.key.slice(0, 8)} ${b.accountCode} brand=${b.brand} env=${b.envelopeCode}/${b.envelopeSize} ${b.postalService} ${b.postalFormat} inserts=[${b.insertCodes}] route=${b.route} -> ${b.enclosing}  n=${b.mailpieceIds.length}`);
}
const excl = r.packs.filter((p) => p.matchExclusion);
const byReason: Record<string, number> = {};
for (const p of excl) byReason[p.matchExclusion!] = (byReason[p.matchExclusion!] ?? 0) + 1;
console.log('match exclusions:', JSON.stringify(byReason));
console.log('merged mailpieces:', multi.map((m) => `${m.packs.length}x ${m.packs[0]!.address.lines[0]}`).join('; ') || 'none');
for (const i of r.issues) console.log(`${i.severity.toUpperCase()} ${i.packGuid ?? ''} ${i.message}`);
