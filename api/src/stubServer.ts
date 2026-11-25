import { MemoryActivityStore, MemoryInboxReader } from './activity/memoryStore.js';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { authFromEnv } from './auth/config.js';
import { MemoryJobComposer, MemoryJobStore } from './jobs/memoryStore.js';
import { MemoryReportStore } from './reports/memoryStore.js';
import { MemoryRecipientStore } from './recipients/memoryStore.js';
import { MemoryBatchStore, type MemoryBatch } from './batches/memoryStore.js';
import { MemoryAuditStore } from './audit/memoryStore.js';
import { MemoryCostingStore } from './costing/memoryStore.js';
import { MemoryRepriceStore } from './reprice/memoryStore.js';
import { MemoryPostalStore } from './postal/memoryStore.js';
import { MemoryReferenceStore } from './reference/memoryStore.js';
import { MemoryCustomerStore } from './customers/memoryStore.js';
import { MemorySettingsStore } from './settings/store.js';
import { HpodSessions } from './hpod/service.js';
import { fakeHpodFetch } from './stubHpod.js';

/** The API with in-memory data and no database, for working on the web app. */
const store = new MemorySettingsStore();
store.rows = [
  { id: 2, changedAt: '2026-11-20T16:42:00.000Z', changedBy: 'system', setting: 'Alert if the PDF has not arrived after', oldValue: '30', newValue: '45' },
  { id: 1, changedAt: '2026-11-19T09:10:00.000Z', changedBy: 'system', setting: 'Machine enclosing: maximum sheets per letter', oldValue: '16', newValue: '12' },
];
await store.update(Object.entries({ hpodEndpoint: 'https://api-uk.h-pod.co.uk', hpodInstance: 'uk', hpodAccountCode: 'latcham', hpodUsername: 'demo@latcham.example', hpodPassword: 'demo' }).map(([key, newValue]) => ({ key, oldValue: '', newValue })), 'system');
const customers = new MemoryCustomerStore();
const acme = customers.seed({ code: 'ACME', name: 'Acme Energy Ltd', misJobNumber: '24518', pendingJobNumber: '24601', pendingFrom: '2026-12-01', returnAddress: 'PO Box 12, Leeds LS1 1AA', batchingKey: 'Department', packSequenceKey: 'Doc Type',
  flags: { isAddressMatching: true, isArchiveMailpieces: false, isCreateOutputFiles: true, isSso: false, isSameDayService: false, isUseMrdf: false, isTesting: false, isDeleted: false },
  emails: ['print@acme.example'], matchRules: [{ isInclude: true, key: 'Department', value: null }, { isInclude: false, key: 'Doc Type', value: 'Final Demand' }], sequenceRules: [{ value: 'Bill', number: 1 }, { value: 'Arrears', number: 2 }] });
await customers.addAccount(acme, { code: 'ACME-SC', name: 'Acme Energy – Scotland' }, 'system');
const brand = await customers.addBrand(acme, 'Acme Home', 'system');
await customers.addEnvelope(acme, { brandId: brand, deliveryBand: '2nd Class', postalRateId: 1, stockItemId: 10, reference: null, externalName: null, isOversticker: false }, 'system');
customers.seed({ code: 'NWB', name: 'Northwest Bank plc', misJobNumber: '24102' });
const odevo = customers.seed({ code: 'ODEVO', name: 'Odevo', misJobNumber: '23990' });
const highline = customers.seed({ code: 'ODEVO_HIGHLINE', name: 'Highline Solicitors', parentId: odevo });
customers.seed({ code: 'ODEVO_R_AND_R', name: 'Rendall & Rittner' });
const costing = new MemoryCostingStore();
costing.today = () => '2026-11-21';
costing.customers.set(acme, { id: acme, code: 'ACME', name: 'Acme Energy Ltd', mode: 'OWN', inheritsAll: false, parentId: null });
costing.customers.set(odevo, { id: odevo, code: 'ODEVO', name: 'Odevo', mode: 'OWN', inheritsAll: false, parentId: null });
costing.customers.set(highline, { id: highline, code: 'ODEVO_HIGHLINE', name: 'Highline Solicitors', mode: 'INHERIT', inheritsAll: false, parentId: odevo });
costing.envelopeStock = [{ id: 10, code: 'ENV-C5-W', description: 'C5 white window envelope', size: 'C5' }, { id: 11, code: 'ENV-C4-W', description: 'C4 white window envelope', size: 'C4' }, { id: 12, code: 'ENV-DL-W', description: 'DL white window envelope', size: 'DL' }];
costing.postalRates = [
  { id: 1, label: 'Royal Mail – 2nd Class (Letter), up to 100g', format: 'Letter', cost: 0.61, sell: 0.66 },
  { id: 2, label: 'Royal Mail – 1st Class (Letter), up to 100g', format: 'Letter', cost: 0.85, sell: 0.9 },
  { id: 3, label: 'Royal Mail – 2nd Class (Large Letter), up to 250g', format: 'Large Letter', cost: 0.95, sell: 1.02 },
];
const charges = (over: Record<string, [number, number, number]>) => Object.entries(over).map(([code, [cost, sellPrice, adjustment]]) => ({ code: code as never, cost, sellPrice, adjustment }));
await costing.create(acme, { name: '2025 prices', validFrom: '2025-01-01', validTo: '2025-12-31', isActive: true, copyFromId: null }, 'system');
const acme2026 = await costing.create(acme, { name: '2026 prices', validFrom: '2026-01-01', validTo: null, isActive: true, copyFromId: null }, 'system');
await costing.update(acme2026, {
  name: '2026 prices', validFrom: '2026-01-01', validTo: null, isActive: true, comments: 'Agreed with Acme in January 2026.',
  charges: charges({ HPOD: [0.04, 0.09, 0], PROCESSING: [0.02, 0.05, 0], PAPER_SHEET: [0.008, 0.015, 0], MONO_PAGE: [0.012, 0.03, 0.002], COLOUR_PAGE: [0.045, 0.085, 0], MACHINE_ENCLOSING_SETUP: [0.02, 0.05, 0], HAND_ENCLOSING_SETUP: [0.07, 0.14, 0], HAND_SMALL_BATCH_ADJUSTMENT: [0, 0.2, 0] }),
  envelopes: [{ stockItemId: 10, cost: 0.018, sellPrice: 0.035, adjustment: 0 }], postage: [{ postalRateId: 1, adjustment: -0.02 }],
}, 'system');
const recipients = new MemoryRecipientStore();
recipients.scopeList = [
  { id: 101, label: 'Acme Energy Ltd', isCustomer: true }, { id: 105, label: 'Northwest Bank plc', isCustomer: true },
  { id: 106, label: 'Odevo', isCustomer: true }, { id: 107, label: 'Odevo > Highline Solicitors', isCustomer: false }, { id: 108, label: 'Rendall & Rittner', isCustomer: true },
];
const pk = (packId: number, position: number, sequence: number | null, startPage: number, pageCount: number, releaseDate: string, references: Record<string, string>) => ({ packId, packGuid: `7a1c0000-0000-4000-8000-${String(packId).padStart(12, '0')}`, jobGuid: '2ce8e2ed-b620-4ce3-9ef7-f52f7b449789', position, sequence, startPage, pageCount, releaseDate, references });
const rec = (mailpieceId: number, ancestors: number[], over: Record<string, unknown>) => recipients.recipients.push({
  mailpieceId, batchCode: 7000 + Math.floor(mailpieceId / 2), batchStatus: 'Printed', job: `job-${mailpieceId}`, releaseDate: '2026-11-18T09:30:00', isCancelled: false,
  addressLines: [], postcode: '', accountCode: '', accountName: '', accountPath: '', invoicingCode: null, invoicingName: null, brand: null, priceSell: null, packs: [], ancestors, ...over,
} as never);
rec(501, [101], { addressLines: ['Mrs A Patel', '12 Mill Lane', 'Leeds'], postcode: 'LS1 4AB', accountCode: 'ACME', accountName: 'Acme Energy Ltd', accountPath: 'Acme Energy Ltd', invoicingCode: 'ACME', invoicingName: 'Acme Energy Ltd', brand: 'Acme Home',
  packs: [pk(1, 1, 1, 1, 2, '2026-11-18T09:30:00', { 'Tenant Reference': 'T-1001', 'Document Type': 'Bill' }), pk(2, 2, 2, 3, 2, '2026-11-18T09:30:00', { 'Tenant Reference': 'T-1001', 'Document Type': 'Arrears' }), pk(3, 3, null, 5, 1, '2026-11-18T09:30:00', { 'Tenant Reference': 'T-1001', 'Document Type': 'Leaflet' })] });
rec(502, [101], { releaseDate: '2026-11-19T10:00:00', addressLines: ['Mr J Patel', '3 High Street', 'York'], postcode: 'YO1 7HH', accountCode: 'ACME', accountName: 'Acme Energy Ltd', accountPath: 'Acme Energy Ltd', invoicingCode: 'ACME', invoicingName: 'Acme Energy Ltd', brand: 'Acme Home',
  packs: [pk(4, 1, 1, 6, 2, '2026-11-19T10:00:00', { 'Tenant Reference': 'T-2040', 'Document Type': 'Bill' })] });
rec(503, [106, 107], { releaseDate: '2026-11-20T08:15:00', batchStatus: 'Created', addressLines: ['Ms R Okafor', 'Flat 4, Quay House', 'London'], postcode: 'E14 5AB', accountCode: 'ODEVO_HIGHLINE', accountName: 'Highline Solicitors', accountPath: 'Odevo > Highline Solicitors', invoicingCode: 'ODEVO', invoicingName: 'Odevo',
  packs: [pk(5, 1, null, 1, 2, '2026-11-20T08:15:00', { 'Property Reference': 'P-77-A', 'Document Type': 'Notice' })] });
rec(504, [106, 108], { addressLines: ['Mr T Brown', '9 Park Road', 'Bristol'], postcode: 'BS1 2CD', accountCode: 'ODEVO_R_AND_R', accountName: 'Rendall & Rittner', accountPath: 'Rendall & Rittner', invoicingCode: 'ODEVO', invoicingName: 'Odevo',
  packs: [pk(6, 1, null, 3, 2, '2026-11-18T09:30:00', { 'Property Reference': 'P-90-B' })] });
const line = (code: string, label: string, quantity: number, unitCost: number, unitSell: number) => ({ code, label, quantity, unitCost, unitSell, cost: Math.round(unitCost * quantity * 1e4) / 1e4, sell: Math.round(unitSell * quantity * 1e4) / 1e4 });
recipients.prices.set(501, {
  mailpieceId: 501, batchCode: 7000, priced: true, reason: null, pricedAt: '2026-11-18T09:31:00', model: { id: 2, name: '2026 prices' }, packs: 1, colourPages: 1, monoPages: 3, blankPages: 0,
  lines: [line('HPOD', 'H-POD processing', 1, 0.04, 0.09), line('PROCESSING', 'Processing', 1, 0.02, 0.05), line('PAPER_SHEET', 'Paper (per sheet)', 2, 0.008, 0.015), line('COLOUR_PAGE', 'Colour page', 1, 0.045, 0.085),
    line('MONO_PAGE', 'Mono page', 3, 0.012, 0.032), line('ENVELOPE', 'Outer envelope', 1, 0.018, 0.035), line('MACHINE_ENCLOSING_SETUP', 'Machine enclosing: setup', 1, 0.02, 0.05), line('MACHINE_ENCLOSING_SHEET', 'Machine enclosing: each extra sheet', 1, 0, 0)],
  productionCost: 0.2, productionSell: 0.41, postageCost: 0.61, postageSell: 0.64, totalCost: 0.81, totalSell: 1.05, warnings: null,
});
recipients.prices.set(502, { ...recipients.prices.get(501)!, mailpieceId: 502, batchCode: 7001, warnings: 'No price for the outer envelope in this costing model.' });
recipients.prices.set(503, { mailpieceId: 503, batchCode: 7001, priced: false, reason: 'No costing model was in force for this customer on 2026-11-20.', pricedAt: null, model: null, packs: 1, colourPages: 0, monoPages: 2, blankPages: 0, lines: [],
  productionCost: 0, productionSell: 0, postageCost: 0, postageSell: 0, totalCost: 0, totalSell: 0, warnings: null });
for (const r of recipients.recipients) { const p = recipients.prices.get(r.mailpieceId ?? 0); if (p?.priced) r.priceSell = p.totalSell; }
// Batches: 7251 holds two mailpieces, from two different sub-accounts of Odevo and Acme.
const batches = new MemoryBatchStore();
batches.scopeList = recipients.scopeList;
let seq = 0;
for (const r of recipients.recipients) { r.batchId = r.batchCode ?? undefined; r.sequenceNumber = r.batchCode === 7251 ? ++seq : 1; }
const batch = (batchCode: number, over: Partial<MemoryBatch>): MemoryBatch => {
  const mine = recipients.recipients.filter((r) => r.batchCode === batchCode);
  return { batchId: batchCode, batchCode, status: 'Printed', job: mine[0]?.job ?? '', createdAt: '2026-11-18T09:31:00', department: 'Machine enclosing', service: 'Royal Mail 2nd Class (Letter)', envelope: 'C5 window envelope',
    brand: mine[0]?.brand ?? null, invoicingCode: mine[0]?.invoicingCode ?? '', invoicingName: mine[0]?.invoicingName ?? '', mailpieces: mine.length, mailpiecesInBatch: mine.length, cancelled: 0,
    packs: mine.reduce((a, r) => a + r.packs.length, 0), pages: mine.reduce((a, r) => a + r.packs.reduce((b, k) => b + k.pageCount, 0), 0), sheets: mine.length,
    priceSell: Math.round(mine.reduce((a, r) => a + (r.priceSell ?? 0), 0) * 1e4) / 1e4, unpriced: mine.filter((r) => r.priceSell === null).length,
    ancestors: [...new Set(mine.flatMap((r) => r.ancestors))], ...over };
};
// Audit report details for the same mailpieces (no page images: the stub has no customer PDFs)
const audit = new MemoryAuditStore();
audit.scopeList = recipients.scopeList;
audit.rows = recipients.recipients.map((r) => ({
  mailpieceId: r.mailpieceId, ancestors: r.ancestors, addressLines: r.addressLines, postcode: r.postcode, isCancelled: r.isCancelled, producedAt: `${r.releaseDate.slice(0, 10)}T09:40:00Z`,
  job: { jobId: 1, name: r.job, xmlFile: `${r.job}.xml`, pdfFile: `${r.job}.pdf`, receivedAt: `${r.releaseDate.slice(0, 10)}T09:30:00Z`, pdfReceivedAt: `${r.releaseDate.slice(0, 10)}T09:31:00Z` },
  batch: r.batchCode === null ? null : { batchCode: r.batchCode, status: 'Despatched', createdAt: `${r.releaseDate.slice(0, 10)}T09:45:00Z`, department: 'Machine enclosing', sequenceNumber: r.sequenceNumber, files: [{ segment: 1, fileName: `${r.batchCode}.pdf`, createdAt: `${r.releaseDate.slice(0, 10)}T09:46:00Z` }],
    events: ['Created', 'Printed', 'Enclosed', 'Despatched'].map((type, i) => ({ type, at: `${r.releaseDate.slice(0, 10)}T${String(9 + i * 2).padStart(2, '0')}:45:00Z`, by: i ? 'production' : null, note: null })) },
  service: { provider: 'Royal Mail', name: '2nd Class', format: 'Letter', tracked: false }, envelope: 'C5', weightG: 22, pageCount: r.packs.reduce((n, k) => n + k.pageCount, 0), sheetCount: 2,
  submittedBy: { path: r.accountPath, code: r.accountCode }, brand: r.brand,
  packs: r.packs.map((k) => ({ ...k, receivedAt: `${r.releaseDate.slice(0, 10)}T09:30:00Z`, ownerAccount: r.accountCode, ownerUser: 'uploader@example.com' })),
}));
batches.batches = [batch(7250, {}), batch(7251, { createdAt: '2026-11-19T10:02:00', status: 'Created', department: 'Hand enclosing' }), batch(7252, { createdAt: '2026-11-20T08:20:00', status: 'Despatched' })];
const reports = new MemoryReportStore();
reports.accounts = [{ id: 101, code: 'ACME', name: 'Acme Energy Ltd' }, { id: 106, code: 'ODEVO', name: 'Odevo' }];
const usageDays = Array.from({ length: 21 }, (_, i) => new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10)).filter((d) => ![6, 7, 13, 14, 20, 21].includes(Number(d.slice(8))));
reports.lines.set(106, usageDays.flatMap((day, i) => [
  { day, brand: 'Highline Solicitors', format: 'Letter', service: '2nd Class', mailpieces: 40 + ((i * 7) % 25), packs: 55 + i, sheets: 120 + i * 3, priced: 40 + ((i * 7) % 25), productionSell: (40 + ((i * 7) % 25)) * 0.31, postageSell: (40 + ((i * 7) % 25)) * 0.85 },
  { day, brand: 'Rendall & Rittner', format: 'Letter', service: '1st Class', mailpieces: 18 + ((i * 5) % 14), packs: 22 + i, sheets: 60 + i * 2, priced: 18 + ((i * 5) % 14), productionSell: (18 + ((i * 5) % 14)) * 0.28, postageSell: (18 + ((i * 5) % 14)) * 1.1 },
  { day, brand: 'Odevo', format: 'Large Letter', service: '2nd Class', mailpieces: 6 + (i % 5), packs: 6 + (i % 5), sheets: 30 + i, priced: 5 + (i % 5), productionSell: (5 + (i % 5)) * 0.4, postageSell: (5 + (i % 5)) * 1.6 },
]));
reports.marginLines_.set(106, reports.lines.get(106)!.map((l) => ({ day: l.day, brand: l.brand, format: l.format, service: l.service, mailpieces: l.mailpieces, priced: l.priced,
  productionSell: l.productionSell, postageSell: l.postageSell, productionCost: l.productionSell * 0.55, postageCost: l.postageSell * 0.92 })));
const postal = new MemoryPostalStore();
postal.today = () => '2026-11-21';
const rm = await postal.createProvider('Royal Mail', 'system'); const dpd = await postal.createProvider('DPD', 'system');
const second = await postal.createService(rm, { formatId: 1, name: '2nd Class', serviceCode: 'STL2', isSignedFor: false, isTracked: false, isRecorded: false }, 'system');
const first = await postal.createService(rm, { formatId: 1, name: '1st Class', serviceCode: 'STL1', isSignedFor: false, isTracked: false, isRecorded: false }, 'system');
await postal.createService(dpd, { formatId: 3, name: 'Next Day', serviceCode: null, isSignedFor: true, isTracked: true, isRecorded: false }, 'system');
for (const [svc, bands, cost, sell] of [[second, [[0, 100], [101, 250]], 0.61, 0.66], [first, [[0, 100]], 0.85, 0.9]] as const) {
  for (const [mn, mx] of bands) { const id = await postal.createRate(svc, { minWeightG: mn, maxWeightG: mx, validFrom: '2025-04-01', validTo: '2026-03-31', cost: cost - 0.05, sellPrice: sell - 0.05 }, 'system'); postal.rates.get(id)!.usedBy = 4; }
  for (const [mn, mx] of bands) { const id = await postal.createRate(svc, { minWeightG: mn, maxWeightG: mx, validFrom: '2026-04-01', validTo: null, cost, sellPrice: sell }, 'system'); postal.rates.get(id)!.usedBy = 12; }
}
const reprice = new MemoryRepriceStore();
for (const id of [acme, odevo, highline]) reprice.customers.add(id);
reprice.counts = { inScope: 412, alreadyPriced: 380, wouldPrice: 31, noModel: 1, unknownColours: 0 };
const jobs = new MemoryJobStore();
const job = (id: number, status: 'Received' | 'Awaiting PDF' | 'PDF Rejected', composed: number, over: object = {}) => ({
  id, customerCode: 'ACME', customerName: 'Acme Energy Ltd', baseName: `ACME_statements_${id}`, pdfFileName: `ACME_statements_${id}.pdf`, receivedAt: `2026-11-2${id % 3}T09:30:00.000Z`,
  status, packCount: 400, pageCount: 1200, pdfError: null, batchCount: 2, composedBatchCount: composed, runSheetsEmailedAt: composed > 0 ? '2026-11-21T10:05:00.000Z' : null,
  batches: [1, 2].map((n) => ({ id: id * 10 + n, batchCode: 7000 + id * 10 + n, status: 'Created', mailpieceCount: 200,
    files: n <= composed ? [{ fileName: `${7000 + id * 10 + n}_1.pdf`, segment: 1, mailpieces: 200, pages: 602 }] : [] })), ...over });
jobs.jobs.push(job(3, 'Received', 0), job(2, 'Received', 2), job(1, 'PDF Rejected', 0, { pdfError: 'Pack 12 ends on page 900 but the PDF has 880 pages' }));
const activityStore = new MemoryActivityStore();
const ago = (s: number): string => new Date(Date.now() - s * 1000).toISOString();
activityStore.rows = [
  { id: 3, kind: 'Print files', label: 'Job 3: ACME_statements_3.pdf', jobId: 3, state: 'Running', detail: 'Processing batch 1 of 2. Built file 4 of 13', done: 2400, total: 9500, startedAt: ago(40), updatedAt: ago(2), finishedAt: null, stalled: false, bytes: null, withPdf: false },
  { id: 2, kind: 'Import', label: 'bad-export.xml', jobId: null, state: 'Failed', detail: 'The XML is not valid', done: null, total: null, startedAt: ago(300), updatedAt: ago(290), finishedAt: ago(290), stalled: false, bytes: null, withPdf: false },
];
const inbox = new MemoryInboxReader();
inbox.items = [
  { stem: 'ODEVO_small', xmlName: 'ODEVO_small.xml', xmlBytes: 14_000, pdfName: 'ODEVO_small.pdf', pdfBytes: 12_000_000, modifiedAt: ago(20) },
  { stem: 'HIGHLINE_big', xmlName: 'HIGHLINE_big.xml', xmlBytes: 9_400_000, pdfName: null, pdfBytes: null, modifiedAt: ago(45) },
];
const composer = new MemoryJobComposer();
composer.result = [{ batchCode: 7031, files: ['7031_1.pdf'], mrdfFile: null, skipped: null }, { batchCode: 7032, files: ['7032_1.pdf'], mrdfFile: null, skipped: null }];
const app = await buildApp({ auth: authFromEnv({ AUTH_MODE: 'off' }), settings: store, hpod: new HpodSessions(store, { fetch: fakeHpodFetch() }), customers, costing, postal, reference: new MemoryReferenceStore(), reprice, recipients, batches, audit, reports, jobs: { store: jobs, composer }, activity: { store: activityStore, inbox }, webDir: fileURLToPath(new URL('../../web/dist', import.meta.url)) });
await app.listen({ port: Number(process.env['API_PORT'] ?? 3001), host: '127.0.0.1' });
console.log('Stub API (no database) on http://127.0.0.1:3001');
