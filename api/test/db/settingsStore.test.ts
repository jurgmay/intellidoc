import { MemoryReportStore } from '../../src/reports/memoryStore.js';
import { MemoryReferenceStore } from '../../src/reference/memoryStore.js';
import { MemoryRecipientStore } from '../../src/recipients/memoryStore.js';
import { MemoryCustomerStore } from '../../src/customers/memoryStore.js';
import { MemoryRepriceStore } from '../../src/reprice/memoryStore.js';
import { MemoryPostalStore } from '../../src/postal/memoryStore.js';
import { MemoryCostingStore } from '../../src/costing/memoryStore.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sql from 'mssql';
import { assertScratchDatabase, resetAndSeed } from '../../../ingest/src/mssql/devDb.js';
import { MssqlSettingsStore } from '../../src/settings/store.js';
import { SecretBox, SecretKeyMissing } from '../../src/settings/secret.js';
import { buildApp } from '../../src/app.js';

/** Runs against the scratch database named in INTELLIDOC_TEST_DB. It DROPS and recreates the idoc schema. */
const cs = process.env['INTELLIDOC_TEST_DB'];
describe.skipIf(!cs)('MssqlSettingsStore', { timeout: 120_000 }, () => {
  let pool: sql.ConnectionPool; let store: MssqlSettingsStore;
  beforeAll(async () => {
    pool = new sql.ConnectionPool(cs!); await pool.connect();
    await assertScratchDatabase(pool, /test|scratch|tmp/i);
    await resetAndSeed(pool); store = new MssqlSettingsStore(pool);
  });
  afterAll(async () => { await pool?.close(); });

  it('reads every setting with the right type', async () => {
    const v = await store.read();
    expect(v).toMatchObject({ a4SheetWeightG: 5.625, machineEnclosingMaxSheets: 12, machineEnclosingEnvelopeSize: 'C5', xmlFirstEnabled: true, pdfWaitMinutes: 30, alertRecipients: '',
      autoCompose: false, maxPagesPerPdf: 10000, activityKeepDays: 7, activityRowsShown: 30, markSeqFontPt: 8, markDotXMm: 205.5, markDotYMm: 269, markDotDiameterMm: 2,
      mrdfOcrRotationDeg: 0, pageWidthMm: 210, pageHeightMm: 297, windowLeftMm: 15, windowTopMm: 25, windowWidthMm: 90, windowHeightMm: 35 });
  });

  it('saves through the API, audits the change, and the database enforces sensible limits', async () => {
    const app = await buildApp({ settings: store, customers: new MemoryCustomerStore(), costing: new MemoryCostingStore(), postal: new MemoryPostalStore(), reprice: new MemoryRepriceStore(), recipients: new MemoryRecipientStore(), reports: new MemoryReportStore(), reference: new MemoryReferenceStore() });
    const r = await app.inject({ method: 'PUT', url: '/api/settings', payload: { values: { pdfWaitMinutes: 45, xmlFirstEnabled: false, alertRecipients: 'ops@latcham.co.uk' } } });
    expect(r.statusCode).toBe(200);
    expect(await store.read()).toMatchObject({ pdfWaitMinutes: 45, xmlFirstEnabled: false, alertRecipients: 'ops@latcham.co.uk' });
    const audit = await store.audit(10);
    expect(audit.map((a) => `${a.setting}: ${a.oldValue} -> ${a.newValue}`)).toEqual(expect.arrayContaining(['Alert if the PDF has not arrived after: 30 -> 45']));
    await expect(pool.request().query('UPDATE idoc.settings SET pdf_wait_minutes = 0')).rejects.toThrow(/ck_settings_positive/);
  });

  it('batch code: shows the next number and can be moved up but not onto a used number', async () => {
    const app = await buildApp({ settings: store, customers: new MemoryCustomerStore(), costing: new MemoryCostingStore(), postal: new MemoryPostalStore(), reprice: new MemoryRepriceStore(), recipients: new MemoryRecipientStore(), reports: new MemoryReportStore(), reference: new MemoryReferenceStore() });
    expect((await store.batchCode()).highestUsed).toBeNull();
    const ok = await app.inject({ method: 'PUT', url: '/api/settings/batch-code', payload: { next: 5000 } });
    expect(ok.json()).toEqual({ highestUsed: null, next: 5000 });
    const n = (await pool.request().query('SELECT NEXT VALUE FOR idoc.batch_code_seq AS n')).recordset[0].n;
    expect(Number(n)).toBe(5000);
  });

  it('network settings: paths are saved as text, the password is encrypted in the table and logged only as (set)', async () => {
    const keyed = new MssqlSettingsStore(pool, new SecretBox('a passphrase long enough'));
    await keyed.update([{ key: 'folderIn', oldValue: '', newValue: '\\\\wf01\\in' }, { key: 'networkPassword', oldValue: '', newValue: 'Tr0ub4dor&3' }], 'tester');
    const raw = (await pool.request().query('SELECT folder_in, network_password FROM idoc.settings')).recordset[0];
    expect(raw.folder_in).toBe('\\\\wf01\\in');
    expect(raw.network_password).toMatch(/^v1:/); expect(raw.network_password).not.toContain('Tr0ub4dor');
    expect(await keyed.secret('networkPassword')).toBe('Tr0ub4dor&3');
    const log = (await pool.request().query(`SELECT setting_name, new_value FROM idoc.settings_audit WHERE setting_name LIKE N'Network access%'`)).recordset;
    expect(log).toEqual([{ setting_name: 'Network access: password', new_value: '(set)' }]);
    await keyed.clearSecret('networkPassword', 'tester');
    expect(await keyed.secret('networkPassword')).toBeNull();
    await expect(store.update([{ key: 'networkPassword', oldValue: '', newValue: 'x' }], 'tester')).rejects.toBeInstanceOf(SecretKeyMissing);
  });
});
