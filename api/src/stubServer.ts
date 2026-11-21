import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
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
  flags: { isAddressMatching: true, isArchiveMailpieces: false, isCreateOutputFiles: true, isCreateSeparateBatches: false, isNhs: false, isSso: false, isSameDayService: false, isUseMrdf: false, isTesting: false, isDeleted: false },
  emails: ['print@acme.example'], matchRules: [{ isInclude: true, key: 'Department', value: null }, { isInclude: false, key: 'Doc Type', value: 'Final Demand' }], sequenceRules: [{ value: 'Bill', number: 1 }, { value: 'Arrears', number: 2 }] });
await customers.addAccount(acme, { code: 'ACME-SC', name: 'Acme Energy – Scotland' }, 'system');
const brand = await customers.addBrand(acme, 'Acme Home', 'system');
await customers.addEnvelope(acme, { brandId: brand, deliveryBand: '2nd Class', postalRateId: 1, stockItemId: 10, reference: null, externalName: null, isOversticker: false }, 'system');
customers.seed({ code: 'NWB', name: 'Northwest Bank plc', misJobNumber: '24102' });
const odevo = customers.seed({ code: 'ODEVO', name: 'Odevo', misJobNumber: '23990' });
customers.seed({ code: 'ODEVO_HIGHLINE', name: 'Highline Solicitors', parentId: odevo });
customers.seed({ code: 'ODEVO_R_AND_R', name: 'Rendall & Rittner' });
const app = await buildApp({ settings: store, customers, webDir: fileURLToPath(new URL('../../web/dist', import.meta.url)) });
await app.listen({ port: Number(process.env['API_PORT'] ?? 3001), host: '127.0.0.1' });
console.log('Stub API (no database) on http://127.0.0.1:3001');
