import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import type { FastifyInstance } from 'fastify';
import { PDFDocument } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { MemoryAuditStore, type MemoryAudit } from '../src/audit/memoryStore.js';
import { GhostscriptPageRenderer, findSourcePdf } from '../src/audit/pageRenderer.js';
import { ukStamp } from '../src/audit/pdf.js';
import type { PageRenderer } from '../src/audit/types.js';
import { MemoryReportStore } from '../src/reports/memoryStore.js';
import { MemoryReferenceStore } from '../src/reference/memoryStore.js';
import { MemoryCustomerStore } from '../src/customers/memoryStore.js';
import { MemoryRepriceStore } from '../src/reprice/memoryStore.js';
import { MemoryPostalStore } from '../src/postal/memoryStore.js';
import { MemoryCostingStore } from '../src/costing/memoryStore.js';
import { MemoryRecipientStore } from '../src/recipients/memoryStore.js';
import { MemorySettingsStore } from '../src/settings/store.js';

const hasGs = (() => { try { execFileSync(process.env['GS_PATH'] || 'gs', ['-v'], { stdio: 'ignore' }); return true; } catch { return false; } })();
let dir: string; let app: FastifyInstance; let store: MemoryAuditStore;

const mp = (mailpieceId: number, ancestors: number[], over: Partial<MemoryAudit> = {}): MemoryAudit => ({
  mailpieceId, ancestors, addressLines: ['Mrs Anne Patel', '12 Mill Lane', 'Leeds'], postcode: 'LS1 4AB', isCancelled: false, producedAt: `2026-0${mailpieceId}-10T09:15:30Z`,
  job: { jobId: 9, name: 'job-9', xmlFile: 'job-9.xml', pdfFile: 'job-9.pdf', receivedAt: '2026-01-10T09:00:00Z', pdfReceivedAt: '2026-01-10T09:01:00Z' },
  batch: { batchCode: 7001, status: 'Despatched', createdAt: '2026-01-10T09:20:00Z', department: 'Machine enclosing', sequenceNumber: 1, files: [{ segment: 1, fileName: '7001.pdf', createdAt: '2026-01-10T09:21:00Z' }],
    events: [{ type: 'Created', at: '2026-01-10T09:20:00Z', by: null, note: null }, { type: 'Printed', at: '2026-01-10T11:00:00Z', by: 'ops', note: null }, { type: 'Despatched', at: '2026-01-10T15:30:00Z', by: 'ops', note: 'RM collection' }] },
  service: { provider: 'Royal Mail', name: 'Tracked 48', format: 'Letter', tracked: true }, envelope: 'C5', weightG: 24, pageCount: 3, sheetCount: 2, submittedBy: { path: 'Parent > Child', code: 'CHILD' }, brand: 'Home',
  packs: [{ packId: 1, packGuid: 'aaaaaaaa-0000-4000-8000-000000000001', jobGuid: 'bbbbbbbb-0000-4000-8000-000000000001', position: 1, sequence: 1, startPage: 3, pageCount: 2, releaseDate: '2026-01-10T08:00:00Z', receivedAt: '2026-01-10T09:00:00Z', references: { 'Tenant Reference': 'T-1001' }, ownerAccount: 'CHILD', ownerUser: 'jo@child.example' }],
  ...over,
});
const post = (body: unknown) => app.inject({ method: 'POST', url: '/api/reports/audit.pdf', payload: body as object });
const pages = async (r: { rawPayload: Buffer }) => (await PDFDocument.load(r.rawPayload)).getPageCount();

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'idoc-audit-'));
  if (hasGs) {   // the customer's PDF as the watcher keeps it: with a time prefix
    const d = await PDFDocument.create(); d.addPage([595, 842]); d.addPage([595, 842]); const p3 = d.addPage([595, 842]); p3.drawText('Hello letter', { x: 50, y: 700, size: 30 });
    await writeFile(join(dir, '20260110090100_job-9.pdf'), await d.save());
  }
  store = new MemoryAuditStore();
  store.scopeList = [{ id: 1, label: 'Parent', isCustomer: true }, { id: 2, label: 'Parent > Child', isCustomer: false }, { id: 3, label: 'Other', isCustomer: true }];
  store.rows = [mp(1, [1, 2]), mp(2, [1], { batch: null, service: null, isCancelled: true }), mp(3, [3])];
  const renderer: PageRenderer = new GhostscriptPageRenderer(dir);
  app = await buildApp({ settings: new MemorySettingsStore(), customers: new MemoryCustomerStore(), costing: new MemoryCostingStore(), postal: new MemoryPostalStore(), reprice: new MemoryRepriceStore(), recipients: new MemoryRecipientStore(),
    reports: new MemoryReportStore(), reference: new MemoryReferenceStore(), audit: store, pageRenderer: renderer });
});
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

describe('mailpiece audit report', () => {
  it('makes a PDF with a summary page and a page for each mailpiece, oldest first', async () => {
    const r = await post({ accountId: 1, mailpieceIds: [2, 1], criteria: 'Name contains patel, 1 Jan to 31 Mar', thumbnails: false });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    expect(r.headers['content-disposition']).toMatch(/mailpiece-audit-\d{4}-\d{2}-\d{2}\.pdf/);
    expect(r.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(await pages(r)).toBe(3);
  });
  it('leaves out mailpieces that are not in the account searched, and refuses when none are', async () => {
    expect(await pages(await post({ accountId: 2, mailpieceIds: [1, 2, 3], thumbnails: false }))).toBe(2);   // only mailpiece 1 is in Child
    const none = await post({ accountId: 2, mailpieceIds: [3] });
    expect(none.statusCode).toBe(422);
    expect(none.json().errors.mailpieceIds).toMatch(/None of those/);
    expect((await post({ accountId: 99, mailpieceIds: [1] })).statusCode).toBe(404);
  });
  it('checks the request', async () => {
    expect((await post({ mailpieceIds: [1] })).json().errors.accountId).toBeDefined();
    expect((await post({ accountId: 1, mailpieceIds: [] })).json().errors.mailpieceIds).toMatch(/at least one/);
    expect((await post({ accountId: 1, mailpieceIds: [1, 'x'] })).json().errors.mailpieceIds).toMatch(/numbers/);
    expect((await post({ accountId: 1, mailpieceIds: Array.from({ length: 301 }, (_, i) => i + 1) })).json().errors.mailpieceIds).toMatch(/at most 300/);
  });
  it('runs to more pages for a mailpiece with a lot in it', async () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ ...mp(1, [1]).packs[0]!, packId: 100 + i, position: i + 1, references: { A: 'x'.repeat(60), B: 'y'.repeat(60), C: 'z'.repeat(60) } }));
    store.rows.push(mp(4, [1], { packs: many }));
    expect(await pages(await post({ accountId: 1, mailpieceIds: [4], thumbnails: false }))).toBeGreaterThan(2);
  });
  it.skipIf(!hasGs)('renders the first page of the letter from the customer\'s PDF, and says when the PDF is gone', async () => {
    const withImage = await post({ accountId: 1, mailpieceIds: [1] });
    expect(withImage.statusCode).toBe(200);
    expect(withImage.rawPayload.includes(Buffer.from('/DCTDecode'))).toBe(true);        // a JPEG was placed on the page
    store.rows.push(mp(5, [1], { job: { ...mp(1, [1]).job, pdfFile: 'gone.pdf' } }));
    const gone = await post({ accountId: 1, mailpieceIds: [5] });
    expect(gone.statusCode).toBe(200);
    expect(gone.rawPayload.includes(Buffer.from('/DCTDecode'))).toBe(false);
  });
  it('shows times in UK time', () => {
    expect(ukStamp('2026-01-10T15:30:00Z')).toBe('10/01/2026 15:30:00 GMT');
    expect(ukStamp('2026-07-10T15:30:00Z')).toBe('10/07/2026 16:30:00 BST');
  });
  it.skipIf(!hasGs)('finds a PDF by the end of its name, as the watcher renames it, and nothing for a missing folder or file', async () => {
    expect(await findSourcePdf(dir, 'job-9.pdf')).toMatch(/20260110090100_job-9\.pdf$/);
    expect(await findSourcePdf(dir, 'nope.pdf')).toBeNull();
    expect(await findSourcePdf(join(dir, 'missing'), 'job-9.pdf')).toBeNull();
  });
});
