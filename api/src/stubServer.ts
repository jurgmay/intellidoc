import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { MemoryReportStore } from './reports/memoryStore.js';
import { MemoryRecipientStore } from './recipients/memoryStore.js';
import { MemoryCostingStore } from './costing/memoryStore.js';
import { MemoryCustomerStore } from './customers/memoryStore.js';
import { MemorySettingsStore } from './settings/store.js';

/** The API with in-memory data and no database, for working on the web app. */
const store = new MemorySettingsStore();
store.rows = [
  { id: 2, changedAt: '2026-11-20T16:42:00.000Z', changedBy: 'system', setting: 'Alert if the PDF has not arrived after', oldValue: '30', newValue: '45' },
  { id: 1, changedAt: '2026-11-19T09:10:00.000Z', changedBy: 'system', setting: 'Machine enclosing: most sheets per letter', oldValue: '16', newValue: '12' },
];
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
const rec = (packId: number, ancestors: number[], over: Record<string, unknown>) => recipients.recipients.push({
  packId, mailpieceId: packId + 500, batchCode: 7000 + Math.floor(packId / 2), batchStatus: 'Printed', job: `job-${packId}`, releaseDate: '2026-11-18T09:30:00',
  addressLines: [], postcode: '', accountCode: '', accountName: '', accountPath: '', invoicingCode: null, invoicingName: null, brand: null, references: {}, ancestors, ...over,
} as never);
rec(1, [101], { addressLines: ['Mrs A Patel', '12 Mill Lane', 'Leeds'], postcode: 'LS1 4AB', accountCode: 'ACME', accountName: 'Acme Energy Ltd', accountPath: 'Acme Energy Ltd', invoicingCode: 'ACME', invoicingName: 'Acme Energy Ltd', brand: 'Acme Home', references: { 'Tenant Reference': 'T-1001', 'Document Type': 'Statement' } });
rec(2, [101], { releaseDate: '2026-11-19T10:00:00', addressLines: ['Mr J Patel', '3 High Street', 'York'], postcode: 'YO1 7HH', accountCode: 'ACME', accountName: 'Acme Energy Ltd', accountPath: 'Acme Energy Ltd', invoicingCode: 'ACME', invoicingName: 'Acme Energy Ltd', brand: 'Acme Home', references: { 'Tenant Reference': 'T-2040' } });
rec(3, [106, 107], { releaseDate: '2026-11-20T08:15:00', batchStatus: 'Created', addressLines: ['Ms R Okafor', 'Flat 4, Quay House', 'London'], postcode: 'E14 5AB', accountCode: 'ODEVO_HIGHLINE', accountName: 'Highline Solicitors', accountPath: 'Odevo > Highline Solicitors', invoicingCode: 'ODEVO', invoicingName: 'Odevo', references: { 'Property Reference': 'P-77-A', 'Document Type': 'Notice' } });
rec(4, [106, 108], { addressLines: ['Mr T Brown', '9 Park Road', 'Bristol'], postcode: 'BS1 2CD', accountCode: 'ODEVO_R_AND_R', accountName: 'Rendall & Rittner', accountPath: 'Rendall & Rittner', invoicingCode: 'ODEVO', invoicingName: 'Odevo', references: { 'Property Reference': 'P-90-B' } });
const reports = new MemoryReportStore();
reports.accounts = [{ id: 101, code: 'ACME', name: 'Acme Energy Ltd' }, { id: 106, code: 'ODEVO', name: 'Odevo' }];
const usageDays = Array.from({ length: 21 }, (_, i) => new Date(Date.UTC(2026, 10, 1 + i)).toISOString().slice(0, 10)).filter((d) => ![6, 7, 13, 14, 20, 21].includes(Number(d.slice(8))));
reports.lines.set(106, usageDays.flatMap((day, i) => [
  { day, brand: 'Highline Solicitors', format: 'Letter', service: '2nd Class', mailpieces: 40 + ((i * 7) % 25), packs: 55 + i, sheets: 120 + i * 3 },
  { day, brand: 'Rendall & Rittner', format: 'Letter', service: '1st Class', mailpieces: 18 + ((i * 5) % 14), packs: 22 + i, sheets: 60 + i * 2 },
  { day, brand: 'Odevo', format: 'Large Letter', service: '2nd Class', mailpieces: 6 + (i % 5), packs: 6 + (i % 5), sheets: 30 + i },
]));
const app = await buildApp({ settings: store, customers, costing, recipients, reports, webDir: fileURLToPath(new URL('../../web/dist', import.meta.url)) });
await app.listen({ port: Number(process.env['API_PORT'] ?? 3001), host: '127.0.0.1' });
console.log('Stub API (no database) on http://127.0.0.1:3001');
