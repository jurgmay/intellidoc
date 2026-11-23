import { MemoryReportStore } from '../src/reports/memoryStore.js';
import { MemoryReferenceStore } from '../src/reference/memoryStore.js';
import { MemoryRecipientStore } from '../src/recipients/memoryStore.js';
import { MemoryCustomerStore } from '../src/customers/memoryStore.js';
import { MemoryRepriceStore } from '../src/reprice/memoryStore.js';
import { MemoryPostalStore } from '../src/postal/memoryStore.js';
import { MemoryCostingStore } from '../src/costing/memoryStore.js';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { MemorySettingsStore } from '../src/settings/store.js';
import { SETTINGS, validate, BY_KEY, nameOf } from '../src/settings/catalogue.js';
import type { MarksPreviewer } from '../src/settings/preview.js';
import type { Connectivity, TestResult } from '../src/settings/connectivity.js';
import type { SmtpSettings } from '../../ingest/src/mail.js';
import type { HpodConfig } from '../../ingest/src/hpod/client.js';

let store: MemorySettingsStore; let app: FastifyInstance;
beforeEach(async () => { store = new MemorySettingsStore(); app = await buildApp({ settings: store, customers: new MemoryCustomerStore(), costing: new MemoryCostingStore(), postal: new MemoryPostalStore(), reprice: new MemoryRepriceStore(), recipients: new MemoryRecipientStore(), reports: new MemoryReportStore(), reference: new MemoryReferenceStore() }); });

const put = (values: Record<string, unknown>) => app.inject({ method: 'PUT', url: '/api/settings', payload: { values } });

describe('GET /api/settings', () => {
  it('returns every setting with its explanation, value and groups', async () => {
    const r = await app.inject({ url: '/api/settings' });
    const body = r.json();
    expect(r.statusCode).toBe(200);
    expect(body.settings).toHaveLength(SETTINGS.length);
    const w = body.settings.find((s: { key: string }) => s.key === 'machineEnclosingMaxSheets');
    expect(w).toMatchObject({ value: 12, group: 'Enclosing' });
    expect(w.usedBy).toMatch(/machine/i);
    expect(body.settings.find((s: { key: string }) => s.key === 'machineEnclosingEnvelopeSize').options).toEqual(['C5', 'C4']);
    expect(body.groups).toEqual(['Weights and sizes', 'Enclosing', 'PDF and alerts', 'Print production settings', 'Page size', 'Envelope window', 'Sequence number', 'Data Matrix', 'Pack start dot', 'MRDF page codes', 'Network access', 'Workflow server', 'IntelliDoc folders', 'Bluecrest File-Based folders', 'Postal docketing', 'Email settings', 'H-POD API settings']);
    expect(body.batchCode).toEqual({ highestUsed: 1041, next: 1042 });
  });
  it('every setting names a column, a group that exists and a description', () => {
    for (const s of SETTINGS) { expect(s.column).toMatch(/^[a-z0-9_]+$/); expect(['Weights and sizes', 'Enclosing', 'PDF and alerts', 'Print production settings', 'Page size', 'Envelope window', 'Sequence number', 'Data Matrix', 'Pack start dot', 'MRDF page codes', 'Network access', 'Workflow server', 'IntelliDoc folders', 'Bluecrest File-Based folders', 'Postal docketing', 'Email settings', 'H-POD API settings']).toContain(s.group); expect(s.description.length).toBeGreaterThan(10); expect(s.usedBy.length).toBeGreaterThan(10); }
  });
});

describe('PUT /api/settings', () => {
  it('saves changes, and writes one audit row per changed value only', async () => {
    const r = await put({ pdfWaitMinutes: 45, pdfReminderMinutes: 30, xmlFirstEnabled: false });
    expect(r.statusCode).toBe(200);
    expect(r.json().changed).toBe(2);
    expect(store.values['pdfWaitMinutes']).toBe(45);
    const audit = (await app.inject({ url: '/api/settings/audit' })).json().rows;
    expect(audit).toHaveLength(2);
    expect(audit.map((a: { setting: string; oldValue: string; newValue: string }) => `${a.setting}: ${a.oldValue} -> ${a.newValue}`).sort()).toEqual([
      'Alert if the PDF has not arrived after: 30 -> 45', 'Import an XML without waiting for its PDF: on -> off']);
    expect(audit[0].changedBy).toBe('system');
  });
  it('names the mark settings in full in the change log and in error messages, though their labels leave out the heading', async () => {
    expect(BY_KEY.get('markSeqLeftMm')).toMatchObject({ group: 'Sequence number', label: 'Left' });
    expect(BY_KEY.get('markDotDiameterMm')).toMatchObject({ group: 'Pack start dot', label: 'Diameter' });
    expect((await put({ markSeqLeftMm: 22, markDmWidthMm: 9 })).statusCode).toBe(200);
    const audit = (await app.inject({ url: '/api/settings/audit' })).json().rows.map((a: { setting: string }) => a.setting).sort();
    expect(audit).toEqual(['Data Matrix: width', 'Sequence number: left']);
    const bad = await put({ markDotDiameterMm: 0 });
    expect(bad.json().errors.markDotDiameterMm).toBe('Pack start dot: diameter must be at least 0.1');
  });
  it('rejects bad values with a message per setting and saves nothing', async () => {
    const r = await put({ pdfWaitMinutes: 0, a4SheetWeightG: 'heavy', machineEnclosingEnvelopeSize: 'A9', alertRecipients: 'not-an-email', nonsense: 1, machineEnclosingMaxSheets: 8 });
    expect(r.statusCode).toBe(422);
    const e = r.json().errors;
    expect(Object.keys(e).sort()).toEqual(['a4SheetWeightG', 'alertRecipients', 'machineEnclosingEnvelopeSize', 'nonsense', 'pdfWaitMinutes']);
    expect(e.pdfWaitMinutes).toMatch(/at least 1/);
    expect(store.values['machineEnclosingMaxSheets']).toBe(12);
    expect(store.rows).toHaveLength(0);
  });
  it('tidies a list of e-mail addresses', async () => {
    await put({ alertRecipients: ' a@x.com;b@x.com ,  c@x.com ' });
    expect(store.values['alertRecipients']).toBe('a@x.com, b@x.com, c@x.com');
  });
  it('a request that changes nothing writes no audit rows', async () => {
    expect((await put({ pdfWaitMinutes: 30 })).json().changed).toBe(0);
    expect(store.rows).toHaveLength(0);
  });
  it('needs a body', async () => {
    expect((await app.inject({ method: 'PUT', url: '/api/settings', payload: {} })).statusCode).toBe(400);
  });
});

describe('batch code', () => {
  it('can be moved up, not back onto a number already used', async () => {
    const bad = await app.inject({ method: 'PUT', url: '/api/settings/batch-code', payload: { next: 1041 } });
    expect(bad.statusCode).toBe(422); expect(bad.json().errors.next).toMatch(/already been used/);
    const ok = await app.inject({ method: 'PUT', url: '/api/settings/batch-code', payload: { next: 90000 } });
    expect(ok.json().next).toBe(90000);
    expect(store.rows[0]).toMatchObject({ setting: 'Next batch code', oldValue: '1042', newValue: '90000' });
  });
  it('must be a whole number', async () => {
    expect((await app.inject({ method: 'PUT', url: '/api/settings/batch-code', payload: { next: 1.5 } })).statusCode).toBe(422);
    expect((await app.inject({ method: 'PUT', url: '/api/settings/batch-code', payload: { next: '5' } })).statusCode).toBe(422);
  });
});

describe('validate', () => {
  it('whole numbers only for integer settings', () => {
    expect(validate(BY_KEY.get('pdfWaitMinutes')!, 1.5)).toHaveProperty('error');
    expect(validate(BY_KEY.get('a4SheetWeightG')!, 5.625)).toEqual({ value: 5.625 });
  });
});

describe('page size settings', () => {
  it('are Width and Height of the Page size group, defaulting to A4, and named in full in the change log', async () => {
    const page = SETTINGS.filter((s) => s.group === 'Page size');
    expect(page.map((s) => [s.key, s.label])).toEqual([['pageWidthMm', 'Width'], ['pageHeightMm', 'Height']]);
    expect(store.values['pageWidthMm']).toBe(210); expect(store.values['pageHeightMm']).toBe(297);
    expect((await put({ pageHeightMm: 420 })).statusCode).toBe(200);
    expect(store.rows[0]).toMatchObject({ setting: 'Page size: height', oldValue: '297', newValue: '420' });
    expect((await put({ pageWidthMm: 0 })).statusCode).toBe(422);
  });
});

describe('envelope window settings', () => {
  it('are four settings in their own group, named in full in the change log', async () => {
    const win = SETTINGS.filter((s) => s.group === 'Envelope window');
    expect(win.map((s) => [s.key, s.label])).toEqual([['windowLeftMm', 'Left'], ['windowTopMm', 'Top'], ['windowWidthMm', 'Width'], ['windowHeightMm', 'Height']]);
    expect(win.map(nameOf)).toEqual(['Envelope window: left', 'Envelope window: top', 'Envelope window: width', 'Envelope window: height']);
    expect((await put({ windowWidthMm: 100 })).statusCode).toBe(200);
    expect(store.rows[0]).toMatchObject({ setting: 'Envelope window: width', oldValue: '90', newValue: '100' });
    const bad = await put({ windowHeightMm: 0 });
    expect(bad.statusCode).toBe(422); expect(bad.json().errors.windowHeightMm).toMatch(/Envelope window: height must be at least 0.1/);
  });
});

describe('POST /api/settings/marks-preview', () => {
  const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  let seen: Parameters<MarksPreviewer>[];
  const withPreview = async (fn: MarksPreviewer = async () => PNG) => {
    seen = [];
    return buildApp({ settings: store, customers: new MemoryCustomerStore(), costing: new MemoryCostingStore(), postal: new MemoryPostalStore(), reprice: new MemoryRepriceStore(), recipients: new MemoryRecipientStore(), reports: new MemoryReportStore(), reference: new MemoryReferenceStore(),
      marksPreview: async (...a) => { seen.push(a); return fn(...a); } });
  };
  it('draws the saved positions and returns a PNG', async () => {
    const a = await withPreview();
    const r = await a.inject({ method: 'POST', url: '/api/settings/marks-preview', payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect(new Uint8Array(r.rawPayload)).toEqual(PNG);
    expect(seen[0]![0]).toBe('window');
    expect(seen[0]![1]).toMatchObject({ seq: { leftMm: 20, topMm: 40, widthMm: 45, heightMm: 4, fontPt: 8 }, dm: { leftMm: 20, topMm: 30 }, dot: { xMm: 205.5, yMm: 269, diameterMm: 2 }, mrdf: { dm: { leftMm: 10 }, ocr: { fontPt: 8.2 } } });
    expect(seen[0]![2]).toEqual({ leftMm: 15, topMm: 25, widthMm: 90, heightMm: 35 });
    expect(seen[0]![3]).toEqual({ widthMm: 210, heightMm: 297 });
  });
  it('uses the values on screen over the saved ones, without saving them', async () => {
    const a = await withPreview();
    const r = await a.inject({ method: 'POST', url: '/api/settings/marks-preview', payload: { page: 'mrdf', values: { markSeqLeftMm: 33, windowTopMm: 12, pageWidthMm: 297 } } });
    expect(r.statusCode).toBe(200);
    expect(seen[0]![0]).toBe('mrdf');
    expect(seen[0]![1].seq.leftMm).toBe(33); expect(seen[0]![2].topMm).toBe(12); expect(seen[0]![3]).toEqual({ widthMm: 297, heightMm: 297 });
    expect(store.values['markSeqLeftMm']).toBe(20); expect(store.rows).toHaveLength(0);
  });
  it('refuses values that could not be saved, and unknown pages', async () => {
    const a = await withPreview();
    const bad = await a.inject({ method: 'POST', url: '/api/settings/marks-preview', payload: { values: { windowWidthMm: -1, nope: 1 } } });
    expect(bad.statusCode).toBe(422); expect(Object.keys(bad.json().errors).sort()).toEqual(['nope', 'windowWidthMm']);
    expect((await a.inject({ method: 'POST', url: '/api/settings/marks-preview', payload: { page: 'back' } })).statusCode).toBe(422);
    expect(seen).toHaveLength(0);
  });
  it('says so when the picture cannot be drawn (Ghostscript missing)', async () => {
    const a = await withPreview(async () => { throw new Error('Ghostscript was not found (gs).'); });
    const r = await a.inject({ method: 'POST', url: '/api/settings/marks-preview', payload: {} });
    expect(r.statusCode).toBe(503); expect(r.json().error).toMatch(/Ghostscript was not found/);
  });
});

describe('MRDF OCR code rotation', () => {
  it('is 0, 90, 180 or 270 and nothing else', async () => {
    const def = BY_KEY.get('mrdfOcrRotationDeg')!;
    expect(def.group).toBe('MRDF page codes');
    expect(store.values['mrdfOcrRotationDeg']).toBe(0);
    expect((await put({ mrdfOcrRotationDeg: 270 })).statusCode).toBe(200);
    expect(store.values['mrdfOcrRotationDeg']).toBe(270);
    const bad = await put({ mrdfOcrRotationDeg: 45 });
    expect(bad.statusCode).toBe(422); expect(bad.json().errors.mrdfOcrRotationDeg).toMatch(/must be one of: 0, 90, 180, 270/);
    expect((await put({ mrdfOcrRotationDeg: 90.5 })).statusCode).toBe(422);
  });
  it('reaches the preview', async () => {
    let seen: unknown;
    const a = await buildApp({ settings: store, customers: new MemoryCustomerStore(), costing: new MemoryCostingStore(), postal: new MemoryPostalStore(), reprice: new MemoryRepriceStore(), recipients: new MemoryRecipientStore(), reports: new MemoryReportStore(), reference: new MemoryReferenceStore(),
      marksPreview: async (_p, marks) => { seen = marks.mrdf?.ocr; return new Uint8Array([1]); } });
    await a.inject({ method: 'POST', url: '/api/settings/marks-preview', payload: { page: 'mrdf', values: { mrdfOcrRotationDeg: 180 } } });
    expect(seen).toMatchObject({ rotationDeg: 180 });
  });
});

describe('network settings', () => {
  const NET = ['networkUsername', 'networkPassword', 'workflowNetworkPath', 'workflowSharedFolder', 'folderIn', 'folderOut', 'folderHold', 'folderPrintFiles', 'folderProcessed',
    'bluecrestNetworkPath', 'bluecrestInputFolder', 'bluecrestOutputFolder', 'bluecrestLockFolder', 'bluecrestSelectFolder', 'bluecrestArchiveName', 'docketsFolder', 'docketsSignedForFolder'];
  const get = async () => (await app.inject({ url: '/api/settings' })).json();
  const setting = async (key: string) => (await get()).settings.find((s: { key: string }) => s.key === key);

  it('are the requested fields, in the requested groups and order, all empty to start with', async () => {
    const net = SETTINGS.filter((s) => NET.includes(s.key));
    expect(net.map((s) => s.key)).toEqual(NET);
    expect(net.map((s) => [s.group, s.label])).toEqual([
      ['Network access', 'Username'], ['Network access', 'Password'],
      ['Workflow server', 'Network path'], ['Workflow server', 'Shared folder'],
      ['IntelliDoc folders', "'In' folder"], ['IntelliDoc folders', "'Out' folder"], ['IntelliDoc folders', "'Hold' folder"], ['IntelliDoc folders', 'Print files folder'], ['IntelliDoc folders', 'Processed files folder'],
      ['Bluecrest File-Based folders', 'Network path'], ['Bluecrest File-Based folders', "'Input' folder"], ['Bluecrest File-Based folders', "'Output' folder"], ['Bluecrest File-Based folders', "'Lock' folder"], ['Bluecrest File-Based folders', "'Select' folder"], ['Bluecrest File-Based folders', 'Archive name'],
      ['Postal docketing', 'Postal dockets folder'], ['Postal docketing', "'Signed for' data folder"],
    ]);
    expect(net.filter((s) => s.type !== 'secret').every((s) => s.type === 'text')).toBe(true);
    for (const k of NET) expect(store.values[k]).toBe('');
  });
  it('saves a path trimmed, and names the two Network path fields apart in the change log', async () => {
    expect((await put({ workflowNetworkPath: '  \\\\wf01  ', bluecrestNetworkPath: '\\\\bc01' })).statusCode).toBe(200);
    expect(store.values['workflowNetworkPath']).toBe('\\\\wf01');
    expect(store.rows.map((r) => [r.setting, r.newValue]).sort()).toEqual([['Bluecrest File-Based folders: network path', '\\\\bc01'], ['Workflow server: network path', '\\\\wf01']]);
  });
  it('refuses a path that is too long or has a line break', async () => {
    const long = await put({ folderIn: 'x'.repeat(501) });
    expect(long.statusCode).toBe(422); expect(long.json().errors.folderIn).toMatch(/at most 500/);
    expect((await put({ folderOut: 'C:\\a\nC:\\b' })).statusCode).toBe(422);
    expect((await put({ folderHold: 5 })).statusCode).toBe(422);
  });
  it('saves the password encrypted, never returns it, and keeps it out of the change log', async () => {
    expect((await setting('networkPassword'))).toMatchObject({ value: '', isSet: false });
    const r = await put({ networkPassword: 'Tr0ub4dor&3' });
    expect(r.statusCode).toBe(200);
    expect(JSON.stringify(r.json())).not.toContain('Tr0ub4dor');
    expect(await setting('networkPassword')).toMatchObject({ value: '', isSet: true });
    expect(JSON.stringify(await get())).not.toContain('Tr0ub4dor');
    expect(String(store.values['networkPassword'])).toMatch(/^v1:/); expect(String(store.values['networkPassword'])).not.toContain('Tr0ub4dor');
    expect(await store.secret('networkPassword')).toBe('Tr0ub4dor&3');
    expect(store.rows[0]).toEqual(expect.objectContaining({ setting: 'Network access: password', oldValue: '(not set)', newValue: '(set)' }));
    expect(JSON.stringify(store.rows)).not.toContain('Tr0ub4dor');
    // saving a different password is a change even though it can never be compared
    await put({ networkPassword: 'another one' });
    expect(await store.secret('networkPassword')).toBe('another one');
    expect(store.rows[0]).toMatchObject({ oldValue: '(set)', newValue: '(set)' });
  });
  it('removes a saved password with DELETE, and refuses an empty one in PUT', async () => {
    await put({ networkPassword: 'secret!' });
    expect((await put({ networkPassword: '' })).statusCode).toBe(422);
    expect(await store.secret('networkPassword')).toBe('secret!');
    const r = await app.inject({ method: 'DELETE', url: '/api/settings/networkPassword/secret' });
    expect(r.statusCode).toBe(200);
    expect(r.json().settings.find((s: { key: string }) => s.key === 'networkPassword')).toMatchObject({ isSet: false });
    expect(await store.secret('networkPassword')).toBeNull();
    expect(store.rows[0]).toMatchObject({ setting: 'Network access: password', oldValue: '(set)', newValue: '(not set)' });
    expect((await app.inject({ method: 'DELETE', url: '/api/settings/folderIn/secret' })).statusCode).toBe(404);
  });
  it('says what to do when INTELLIDOC_SECRET_KEY is not set, and saves nothing else with it', async () => {
    const noKey = new MemorySettingsStore(null);
    const a = await buildApp({ settings: noKey, customers: new MemoryCustomerStore(), costing: new MemoryCostingStore(), postal: new MemoryPostalStore(), reprice: new MemoryRepriceStore(), recipients: new MemoryRecipientStore(), reports: new MemoryReportStore(), reference: new MemoryReferenceStore() });
    const r = await a.inject({ method: 'PUT', url: '/api/settings', payload: { values: { networkPassword: 'x', folderIn: 'C:\\in' } } });
    expect(r.statusCode).toBe(422); expect(r.json().errors.networkPassword).toMatch(/INTELLIDOC_SECRET_KEY/);
    expect(noKey.values['networkPassword']).toBe(''); expect(noKey.values['folderIn']).toBe(''); expect(noKey.rows).toHaveLength(0);
    expect((await a.inject({ method: 'PUT', url: '/api/settings', payload: { values: { folderIn: 'C:\\in' } } })).statusCode).toBe(200);
  });
});

describe('connectivity settings', () => {
  const EMAIL_KEYS = ['emailEnabled', 'smtpFromName', 'smtpFromAddress', 'smtpReplyTo', 'smtpServer', 'smtpPort', 'smtpUsername', 'smtpPassword'];
  const HPOD_KEYS = ['hpodEndpoint', 'hpodInstance', 'hpodAccountCode', 'hpodUsername', 'hpodPassword'];

  it('are the requested fields in the requested groups and order', () => {
    expect(SETTINGS.filter((s) => s.group === 'Email settings').map((s) => [s.key, s.label, s.type])).toEqual([
      ['emailEnabled', 'Send e-mail', 'boolean'], ['smtpFromName', "SMTP 'from' name", 'text'], ['smtpFromAddress', "SMTP 'from' address", 'email'], ['smtpReplyTo', "SMTP 'reply to'", 'email'],
      ['smtpServer', 'SMTP server', 'text'], ['smtpPort', 'SMTP port', 'integer'], ['smtpUsername', 'SMTP username', 'text'], ['smtpPassword', 'SMTP password', 'secret']]);
    expect(SETTINGS.filter((s) => s.group === 'H-POD API settings').map((s) => [s.key, s.label, s.type])).toEqual([
      ['hpodEndpoint', 'Endpoint', 'url'], ['hpodInstance', 'Instance', 'text'], ['hpodAccountCode', 'Account code', 'text'], ['hpodUsername', 'Username', 'text'], ['hpodPassword', 'Password', 'secret']]);
    expect(store.values['emailEnabled']).toBe(false); expect(store.values['smtpPort']).toBe(587);
    for (const k of [...EMAIL_KEYS, ...HPOD_KEYS]) expect(BY_KEY.has(k)).toBe(true);
  });
  it('check an e-mail address, a port and a web address, and name the H-POD fields apart from the network ones in the change log', async () => {
    expect((await put({ smtpFromAddress: 'not an address' })).statusCode).toBe(422);
    expect((await put({ smtpReplyTo: 'a@b.co, c@d.co' })).statusCode).toBe(422); // one address only
    expect((await put({ smtpPort: 0 })).statusCode).toBe(422); expect((await put({ smtpPort: 70000 })).statusCode).toBe(422); expect((await put({ smtpPort: 25.5 })).statusCode).toBe(422);
    expect((await put({ hpodEndpoint: 'ftp://x' })).statusCode).toBe(422); expect((await put({ hpodEndpoint: 'hpod.example.com' })).statusCode).toBe(422);
    expect((await put({ smtpFromAddress: ' idoc@latcham.co.uk ', smtpReplyTo: '', smtpPort: 465, hpodEndpoint: 'https://hpod.example.com/api', hpodUsername: 'svc' })).statusCode).toBe(200);
    expect(store.values).toMatchObject({ smtpFromAddress: 'idoc@latcham.co.uk', smtpPort: 465, hpodEndpoint: 'https://hpod.example.com/api' });
    expect(store.rows.map((r) => r.setting)).toContain('H-POD API settings: username');
  });
  it('keep both passwords encrypted and out of every response', async () => {
    await put({ smtpPassword: 'smtp-pass-1', hpodPassword: 'hpod-pass-1' });
    const body = JSON.stringify((await app.inject({ url: '/api/settings' })).json());
    expect(body).not.toContain('smtp-pass-1'); expect(body).not.toContain('hpod-pass-1');
    expect(await store.secret('smtpPassword')).toBe('smtp-pass-1'); expect(await store.secret('hpodPassword')).toBe('hpod-pass-1');
  });

  describe('test buttons', () => {
    let sent: { smtp: SmtpSettings; to: string[] }[]; let hpodTried: { config: HpodConfig; missing: string[] }[];
    let result: TestResult;
    const make = async () => {
      sent = []; hpodTried = []; result = { ok: true, message: 'fine' };
      const fake: Connectivity = { sendTestEmail: async (smtp, to) => { sent.push({ smtp, to }); return result; }, testHpod: async (config, missing) => { hpodTried.push({ config, missing }); return result; } };
      return buildApp({ settings: store, customers: new MemoryCustomerStore(), costing: new MemoryCostingStore(), postal: new MemoryPostalStore(), reprice: new MemoryRepriceStore(), recipients: new MemoryRecipientStore(), reports: new MemoryReportStore(), reference: new MemoryReferenceStore(), connectivity: fake });
    };
    const post = (a: FastifyInstance, url: string, values?: Record<string, unknown>) => a.inject({ method: 'POST', url, payload: { values } });
    const mail = { smtpServer: 'smtp.example.com', smtpPort: 587, smtpFromName: 'IntelliDoc', smtpFromAddress: 'idoc@latcham.co.uk', smtpReplyTo: 'help@latcham.co.uk', smtpUsername: 'svc', alertRecipients: 'admin@latcham.co.uk, ops@latcham.co.uk' };

    it('send the test e-mail to the alert recipients with the settings on screen, saved or not, and the typed password', async () => {
      const a = await make();
      const r = await post(a, '/api/settings/test-email', { ...mail, smtpPassword: 'typed-pass' });
      expect(r.json()).toEqual({ ok: true, message: 'fine' });
      expect(sent).toEqual([{ to: ['admin@latcham.co.uk', 'ops@latcham.co.uk'], smtp: { host: 'smtp.example.com', port: 587, secure: false, user: 'svc', pass: 'typed-pass', from: '"IntelliDoc" <idoc@latcham.co.uk>', replyTo: 'help@latcham.co.uk' } }]);
      expect(store.values['smtpServer']).toBe(''); expect(store.rows).toHaveLength(0); // nothing was saved
      expect(JSON.stringify(r.json())).not.toContain('typed-pass');
    });
    it('use the saved password when none is typed, and TLS from the start on port 465', async () => {
      await put({ smtpPassword: 'saved-pass' });
      const a = await make();
      await post(a, '/api/settings/test-email', { ...mail, smtpPort: 465 });
      expect(sent[0]!.smtp).toMatchObject({ pass: 'saved-pass', secure: true, port: 465 });
    });
    it('say what is missing instead of sending', async () => {
      const a = await make();
      expect((await post(a, '/api/settings/test-email', { ...mail, alertRecipients: '' })).json().message).toMatch(/Alert e-mail recipients/);
      expect((await post(a, '/api/settings/test-email', { ...mail, smtpServer: '' })).json().message).toBe('Enter the SMTP server first.');
      expect((await post(a, '/api/settings/test-email', { ...mail, smtpFromAddress: '' })).json().message).toMatch(/'from' address/);
      expect((await post(a, '/api/settings/test-email', { ...mail })).json().message).toMatch(/no password/); // a username but no password anywhere
      const open = (await post(a, '/api/settings/test-email', { ...mail, smtpUsername: '' })).json();
      expect(open.ok).toBe(true); expect(sent.at(-1)!.smtp).toMatchObject({ user: undefined, pass: undefined });
      expect(sent).toHaveLength(1);
    });
    it('pass the failure of the mail server on, and refuse values that could not be saved', async () => {
      const a = await make();
      result = { ok: false, message: 'Invalid login' };
      expect((await post(a, '/api/settings/test-email', { ...mail, smtpPassword: 'x' })).json()).toEqual({ ok: false, message: 'Invalid login' });
      const bad = await post(a, '/api/settings/test-email', { ...mail, smtpPort: 0 });
      expect(bad.statusCode).toBe(422); expect(bad.json().errors.smtpPort).toBeTruthy();
    });
    it('say when a saved password cannot be read because the key is not set', async () => {
      await put({ smtpPassword: 'saved-pass' });
      store = Object.assign(new MemorySettingsStore(null), { values: { ...store.values } });
      const a = await make();
      const r = await post(a, '/api/settings/test-email', mail);
      expect(r.json().ok).toBe(false); expect(r.json().message).toMatch(/INTELLIDOC_SECRET_KEY/);
    });
    it('sign in to H-POD with the details on screen, and the typed password, saving nothing', async () => {
      const a = await make();
      const r = await post(a, '/api/settings/test-hpod', { hpodEndpoint: 'https://hpod.example.com/api', hpodInstance: 'uk', hpodAccountCode: 'latcham', hpodUsername: 'jo@latcham.example', hpodPassword: 'typed-pass' });
      expect(r.json()).toEqual({ ok: true, message: 'fine' });
      expect(hpodTried).toEqual([{ missing: [], config: { endpoint: 'https://hpod.example.com/api', instance: 'uk', accountLogin: 'latcham', emailAddress: 'jo@latcham.example', password: 'typed-pass' } }]);
      expect(store.values['hpodEndpoint']).toBe(''); expect(store.rows).toHaveLength(0);
      expect(JSON.stringify(r.json())).not.toContain('typed-pass');
    });
    it('use the saved password when none is typed, and list what is missing', async () => {
      await put({ hpodPassword: 'saved-pass' });
      const a = await make();
      await post(a, '/api/settings/test-hpod', { hpodEndpoint: 'https://hpod.example.com/api', hpodUsername: 'jo@latcham.example' });
      expect(hpodTried[0]).toEqual({ missing: ['Instance', 'Account code'], config: { endpoint: 'https://hpod.example.com/api', instance: '', accountLogin: '', emailAddress: 'jo@latcham.example', password: 'saved-pass' } });
      expect((await post(a, '/api/settings/test-hpod', { hpodEndpoint: 'nope' })).statusCode).toBe(422);
    });
    it('say when a saved H-POD password cannot be read because the key is not set', async () => {
      await put({ hpodPassword: 'saved-pass' });
      store = Object.assign(new MemorySettingsStore(null), { values: { ...store.values } });
      const a = await make();
      const r = await post(a, '/api/settings/test-hpod', {});
      expect(r.json().ok).toBe(false); expect(r.json().message).toMatch(/INTELLIDOC_SECRET_KEY/);
      expect(hpodTried).toHaveLength(0);
    });
  });
});
