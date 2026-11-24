import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sql from 'mssql';
import { assertScratchDatabase } from '../../../ingest/src/mssql/devDb.js';
import { connect as connectIngest, resetAndSeed } from '../../../ingest/test/db/setup.js';
import { ingest } from '../../../ingest/src/ingest.js';
import { loadReferenceData } from '../../../ingest/src/mssql/reference.js';
import { MssqlRepository } from '../../../ingest/src/mssql/repository.js';
import { buildXml, FakePdf } from '../../../ingest/test/helpers.js';
import { NotFoundError } from '../../src/errors.js';
import { MssqlAuditStore } from '../../src/audit/mssqlStore.js';

/** Runs against the scratch database named in INTELLIDOC_TEST_DB. It DROPS and recreates the idoc schema. */
const cs = process.env['INTELLIDOC_TEST_DB'];
describe.skipIf(!cs)('MssqlAuditStore', { timeout: 120_000 }, () => {
  let pool: sql.ConnectionPool; let ipool: Awaited<ReturnType<typeof connectIngest>>; let store: MssqlAuditStore;
  let customer: number; let child: number; let other: number; let ids: number[];
  const id = async (code: string): Promise<number> => (await pool.request().query(`SELECT account_id AS n FROM idoc.account WHERE account_code = N'${code}'`)).recordset[0].n;

  beforeAll(async () => {
    pool = new sql.ConnectionPool(cs!); await pool.connect();
    await assertScratchDatabase(pool, /test|scratch|tmp/i);
    ipool = await connectIngest(); await resetAndSeed(ipool); store = new MssqlAuditStore(pool);
    const { xml, pages } = buildXml([
      { first: 'Ann', surname: 'Patel', lines: ['Ann Patel', '1 High Street', 'Town', 'AB1 2CD'], passthrough: { 'Tenant Reference': 'T-1001' } },
      { first: 'Zed', surname: 'Quinn', lines: ['Zed Quinn', '3 High Street', 'Town', 'AB1 2CD'] },
    ]);
    await ingest(xml, 'job-audit.xml', 'job-audit.pdf', { ref: await loadReferenceData(ipool), pdf: new FakePdf(pages), repo: new MssqlRepository(ipool) });
    customer = await id('FEXCO_CUSTOMER'); const sub = await id('FEXCO');
    child = (await pool.request().query(`INSERT INTO idoc.account (account_code, name, parent_account_id, inherits_settings) OUTPUT INSERTED.account_id AS n VALUES (N'FEXCO_CHILD3', N'Child', ${sub}, 1)`)).recordset[0].n;
    other = (await pool.request().query(`INSERT INTO idoc.account (account_code, name) OUTPUT INSERTED.account_id AS n VALUES (N'AUDIT_OTHER', N'Other customer')`)).recordset[0].n;
    ids = (await pool.request().query('SELECT mailpiece_id AS n FROM idoc.mailpiece ORDER BY mailpiece_id')).recordset.map((r) => Number(r.n));
    await pool.request().query(`UPDATE m SET submitting_account_id = ${child} FROM idoc.mailpiece m JOIN idoc.pack p ON p.mailpiece_id = m.mailpiece_id JOIN idoc.address_line l ON l.address_id = p.address_id AND l.line_no = 1 WHERE l.text = N'Zed Quinn'`);
  });
  afterAll(async () => { await pool?.close(); await ipool?.close(); });

  it('returns everything recorded about each mailpiece, in the order asked for', async () => {
    const r = await store.details(customer, [...ids].reverse());
    expect(r.rows.map((m) => m.mailpieceId)).toEqual([...ids].reverse());
    const ann = r.rows.find((m) => m.addressLines[0] === 'Ann Patel')!;
    expect(ann).toMatchObject({ postcode: 'AB1 2CD', isCancelled: false, job: { name: 'job-audit', xmlFile: 'job-audit.xml', pdfFile: 'job-audit.pdf' } });
    expect(ann.producedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(ann.job.receivedAt).toMatch(/Z$/);
    expect(ann.packs).toHaveLength(1);
    expect(ann.packs[0]).toMatchObject({ position: 1, references: { 'Tenant Reference': 'T-1001' } });
    expect(ann.packs[0]!.packGuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(ann.packs[0]!.jobGuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(ann.packs[0]!.ownerUser).toBe('u');
    expect(ann.batch?.events[0]?.type).toBe('Created');
    expect(ann.batch?.events[0]?.at).toMatch(/Z$/);
    expect(ann.submittedBy.path.length).toBeGreaterThan(0);
  });

  it('leaves out mailpieces outside the account searched, and 404s for an unknown account', async () => {
    const inChild = await store.details(child, ids);
    expect(inChild.rows.map((m) => m.addressLines[0])).toEqual(['Zed Quinn']);
    expect((await store.details(other, ids)).rows).toEqual([]);
    await expect(store.details(999999, ids)).rejects.toBeInstanceOf(NotFoundError);
  });
});
