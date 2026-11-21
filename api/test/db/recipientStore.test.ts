import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import sql from 'mssql';
import { assertScratchDatabase } from '../../../ingest/src/mssql/devDb.js';
import { connect as connectIngest, resetAndSeed } from '../../../ingest/test/db/setup.js';
import { ingest } from '../../../ingest/src/ingest.js';
import { loadReferenceData } from '../../../ingest/src/mssql/reference.js';
import { MssqlRepository } from '../../../ingest/src/mssql/repository.js';
import { buildXml, FakePdf, type PackSpec } from '../../../ingest/test/helpers.js';
import { NotFoundError } from '../../src/errors.js';
import { MssqlRecipientStore } from '../../src/recipients/mssqlStore.js';
import type { RecipientQuery } from '../../src/recipients/types.js';

/** Runs against the scratch database named in INTELLIDOC_TEST_DB. It DROPS and recreates the idoc schema. */
const cs = process.env['INTELLIDOC_TEST_DB'];
describe.skipIf(!cs)('MssqlRecipientStore', { timeout: 120_000 }, () => {
  // The ingest code has its own copy of the mssql package, so it gets its own connection (mixing the two breaks parameter types).
  let pool: sql.ConnectionPool; let ipool: Awaited<ReturnType<typeof connectIngest>>; let store: MssqlRecipientStore;
  let customer: number; let sub: number; let child: number; let other: number;
  const q = (over: Partial<RecipientQuery>): RecipientQuery => ({ accountId: customer, name: null, address: null, reference: null, referenceKey: null, from: null, to: null, limit: 100, ...over });
  const names = async (over: Partial<RecipientQuery>): Promise<string[]> => (await store.search(q(over))).rows.map((r) => r.addressLines[0]!).sort();
  const person = (first: string, surname: string, extra: Partial<PackSpec> = {}): PackSpec =>
    ({ first, surname, lines: [`${first} ${surname}`, '1 High Street', 'Town', 'AB1 2CD'], ...extra });
  const id = async (code: string): Promise<number> => (await pool.request().query(`SELECT account_id AS n FROM idoc.account WHERE account_code = N'${code}'`)).recordset[0].n;

  beforeAll(async () => {
    pool = new sql.ConnectionPool(cs!); await pool.connect();
    await assertScratchDatabase(pool, /test|scratch|tmp/i);
    ipool = await connectIngest(); await resetAndSeed(ipool); store = new MssqlRecipientStore(pool);
    const repo = new MssqlRepository(ipool);
    const ref = await loadReferenceData(ipool);
    const { xml, pages } = buildXml([
      person('Ann', 'Patel', { passthrough: { 'Tenant Reference': 'T-1001', 'Document Type': 'Statement' } }),
      person('Joe', 'Patel', { passthrough: { 'Tenant Reference': 'T-2040' }, lines: ['Joe Patel', '9 Mill_Lane', 'York', 'YO1 7HH'], postcode: 'YO1 7HH' }),
      person('Zed', 'Quinn', { passthrough: { 'Tenant Reference': 'T-1001' } }),
    ]);
    await ingest(xml, 'job-search.xml', 'job-search.pdf', { ref, pdf: new FakePdf(pages), repo });
    customer = await id('FEXCO_CUSTOMER'); sub = await id('FEXCO');
    // a sub-account below FEXCO, and a customer with nothing in it
    child = (await pool.request().query(`INSERT INTO idoc.account (account_code, name, parent_account_id, inherits_settings) OUTPUT INSERTED.account_id AS n VALUES (N'FEXCO_CHILD', N'Child', ${sub}, 1)`)).recordset[0].n;
    other = (await pool.request().query(`INSERT INTO idoc.account (account_code, name) OUTPUT INSERTED.account_id AS n VALUES (N'SEARCH_OTHER', N'Other customer')`)).recordset[0].n;
    // Zed Quinn's pack was submitted from the child account
    await pool.request().query(`UPDATE idoc.pack SET submitting_account_id = ${child} WHERE address_id IN (SELECT address_id FROM idoc.address_line WHERE line_no = 1 AND text = N'Zed Quinn')`);
  });
  afterAll(async () => { await pool?.close(); await ipool?.close(); });

  it('lists accounts with their path and whether they are customers', async () => {
    const s = await store.scopes();
    expect(s.find((x) => x.id === customer)).toMatchObject({ isCustomer: true });
    expect(s.find((x) => x.id === child)).toMatchObject({ isCustomer: false });
    expect(s.find((x) => x.id === child)!.label.split(' > ').length).toBe(s.find((x) => x.id === sub)!.label.split(' > ').length + 1);
  });

  it('covers the chosen account and everything below it, and nothing else', async () => {
    expect(await names({ accountId: customer, address: 'high' })).toEqual(['Ann Patel', 'Zed Quinn']);
    expect(await names({ accountId: sub, address: 'high' })).toEqual(['Ann Patel', 'Zed Quinn']);
    expect(await names({ accountId: child, address: 'high' })).toEqual(['Zed Quinn']); // only what was submitted at or below the child
    expect(await names({ accountId: other, address: 'high' })).toEqual([]);
    await expect(store.search(q({ accountId: 999999, name: 'ann' }))).rejects.toBeInstanceOf(NotFoundError);
  });

  it('matches names and addresses by "contains", ignoring case, and treats % _ [ literally', async () => {
    expect(await names({ name: 'ATEL' })).toEqual(['Ann Patel', 'Joe Patel']);
    expect(await names({ name: 'high' })).toEqual([]); // not the name line
    expect(await names({ address: 'mill_' })).toEqual(['Joe Patel']);
    expect(await names({ address: 'mill%' })).toEqual([]);
    expect(await names({ address: 'yo1 7' })).toEqual(['Joe Patel']); // postcode
    expect(await names({ address: 'patel' })).toEqual([]);
  });

  it('matches references exactly or by prefix, optionally for one key', async () => {
    expect(await names({ reference: 'T-1001' })).toEqual(['Ann Patel', 'Zed Quinn']);
    expect(await names({ reference: 'T-10' })).toEqual([]);
    expect(await names({ reference: 'T-*' })).toEqual(['Ann Patel', 'Joe Patel', 'Zed Quinn']);
    expect(await names({ reference: 'T-1001', referenceKey: 'Document Type' })).toEqual([]);
    expect(await names({ reference: 'Statement', referenceKey: 'Document Type' })).toEqual(['Ann Patel']);
  });

  it('returns the snapshot, batch and references for a hit', async () => {
    const r = (await store.search(q({ name: 'ann patel' }))).rows[0]!;
    expect(r).toMatchObject({ accountCode: 'FEXCO', postcode: 'AB1 2CD', brand: 'Remus', batchStatus: 'Created', job: 'job-search' });
    expect(r.addressLines).toEqual(['Ann Patel', '1 High Street', 'Town', 'AB1 2CD']);
    expect(r.references).toEqual({ 'Tenant Reference': 'T-1001', 'Document Type': 'Statement', Brand: 'Remus' });
    expect(r.batchCode).toBeGreaterThan(0);
    expect(r.invoicingCode).toBeTruthy();
    expect(r.accountPath).toContain('>');
  });

  it('filters by release date and limits the rows', async () => {
    const day = (await pool.request().query(`SELECT CONVERT(NVARCHAR(10), MIN(release_date), 23) AS d FROM idoc.pack`)).recordset[0].d as string;
    expect(await names({ name: 'patel', from: day, to: day })).toEqual(['Ann Patel', 'Joe Patel']);
    expect(await names({ name: 'patel', from: '2999-01-01' })).toEqual([]);
    const r = await store.search(q({ name: 'patel', limit: 1 }));
    expect(r.rows).toHaveLength(1);
    expect(r.truncated).toBe(true);
  });
});
