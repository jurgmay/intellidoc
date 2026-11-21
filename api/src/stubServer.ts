import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { MemoryReportStore } from './reports/memoryStore.js';
import { MemoryRecipientStore } from './recipients/memoryStore.js';
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
customers.seed({ code: 'ODEVO_HIGHLINE', name: 'Highline Solicitors', parentId: odevo });
customers.seed({ code: 'ODEVO_R_AND_R', name: 'Rendall & Rittner' });
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
const app = await buildApp({ settings: store, customers, recipients, reports, webDir: fileURLToPath(new URL('../../web/dist', import.meta.url)) });
await app.listen({ port: Number(process.env['API_PORT'] ?? 3001), host: '127.0.0.1' });
console.log('Stub API (no database) on http://127.0.0.1:3001');
