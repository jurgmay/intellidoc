import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { ingest } from '../ingest.js';
import { CliPdfInspector } from '../pdf.js';
import { InMemoryRepository } from '../repository.js';
import { planFromDir } from './dryRun.js';
import { referenceFromPlan } from './planReference.js';

/** Trial run of one XML/PDF pair against the REAL configuration in the FileMaker exports (no database).
 *   npx tsx src/import/trial.ts <export folder> <file.xml> <file.pdf> */
const [dir, xmlPath, pdfPath] = process.argv.slice(2);
if (!dir || !xmlPath || !pdfPath) { console.error('usage: tsx src/import/trial.ts <export folder> <file.xml> <file.pdf>'); process.exit(2); }
const ref = referenceFromPlan(planFromDir(dir));
const r = await ingest(await readFile(xmlPath, 'utf8'), basename(xmlPath), pdfPath, { ref, pdf: new CliPdfInspector(), repo: new InMemoryRepository() });
console.log(`${r.xmlName}: ${r.packs.length} packs, ${r.pdfPages} PDF pages -> ${r.mailpieces.length} mailpieces (${r.mailpieces.filter((m) => m.packs.length > 1).length} merged) in ${r.batches.length} batches; persisted=${r.persisted}`);
for (const b of r.batches) console.log(`  ${b.accountCode} brand=${b.brand} env=${b.envelopeCode}/${b.envelopeSize} ${b.postalService} ${b.postalFormat} inserts=[${b.insertCodes}] route=${b.route} -> ${b.enclosing} n=${b.mailpieceIds.length}`);
const counts = new Map<string, number>();
for (const i of r.issues) { const k = `${i.severity}: ${i.message.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '<guid>')}`; counts.set(k, (counts.get(k) ?? 0) + 1); }
for (const [k, n] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`${n} x ${k}`);
// cross-check against the delivery band the customer system wrote in the XML
const xmlBand = new Map(r.packs.map((p) => [p.parsed.guid, p.parsed.options.deliveryBand]));
const tab = new Map<string, number>();
for (const m of r.mailpieces) { const k = `XML says "${xmlBand.get(m.packs[0]!.parsed.guid)}"  ->  we chose ${m.postalFormat} ${m.envelopeSize} (${m.weightG}g)`; tab.set(k, (tab.get(k) ?? 0) + 1); }
console.log('\nXML band vs our choice (n, weight is for the first of each group shown below):');
const rows = new Map<string, { n: number; min: number; max: number }>();
for (const m of r.mailpieces) { const k = `XML "${xmlBand.get(m.packs[0]!.parsed.guid)}" -> ${m.postalFormat} ${m.envelopeSize}`; const v = rows.get(k) ?? { n: 0, min: 1e9, max: 0 }; v.n++; v.min = Math.min(v.min, m.weightG); v.max = Math.max(v.max, m.weightG); rows.set(k, v); }
for (const [k, v] of [...rows].sort()) console.log(`${String(v.n).padStart(4)}  ${k}  weight ${v.min}-${v.max}g`);
