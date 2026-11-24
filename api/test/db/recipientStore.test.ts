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
  const q = (over: Partial<RecipientQuery>): RecipientQuery => ({ accountId: customer, name: null, address: null, reference: null, referenceKey: null, jobGuid: null, packGuid: null, from: null, to: null, batchId: null, limit: 100, offset: 0, ...over });
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
    // Zed Quinn's mailpiece was submitted from the child account (a search covers the mailpiece's submitting account, as it was at production)
    await pool.request().query(`UPDATE idoc.mailpiece SET submitting_account_id = ${child} WHERE address_id IN (SELECT address_id FROM idoc.address_line WHERE line_no = 1 AND text = N'Zed Quinn')`);
    await pool.request().query(`UPDATE idoc.pack SET submitting_account_id = ${child} WHERE address_id IN (SELECT address_id FROM idoc.address_line WHERE line_no = 1 AND text = N'Zed Quinn')`);
  });
  afterAll(async () => { await pool?.close(); await ipool?.close(); });

  it('lists accounts with their path and whether they are customers', async () => {
    const s = await store.scopes();
    expect(s.find((x) => x.id === customer)).toMatchObject({ isCustomer: true });
    expect(s.find((x) => x.id === child)).toMatchObject({ isCustomer: false });
    expect(s.find((x) => x.id === child)!.label.split(' > ').length).toBe(s.find((x) => x.id === sub)!.label.split(' > ').length + 1);
  });

  it('finds mailpieces by the GUID of a pack or of the job it came from', async () => {
    const all = (await store.search(q({ accountId: customer, address: 'high' }))).rows;
    const pack = all.flatMap((r) => r.packs).find((k) => k.packGuid)!;
    expect((await store.search(q({ packGuid: pack.packGuid.toUpperCase() }))).rows.flatMap((r) => r.packs.map((k) => k.packGuid))).toContain(pack.packGuid);
    expect((await store.search(q({ packGuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }))).rows).toEqual([]);
    expect((await store.search(q({ jobGuid: pack.jobGuid }))).rows.length).toBeGreaterThan(0);
    expect((await store.search(q({ accountId: other, jobGuid: pack.jobGuid }))).rows).toEqual([]);
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
    expect(r.addressLines).toEqual(['Ann Patel', '1 High Street', 'Town']); // the postcode is stored apart from the lines
    expect(r.packs).toHaveLength(1);
    expect(r.packs[0]).toMatchObject({ position: 1, sequence: null, startPage: 1, pageCount: 2, references: { 'Tenant Reference': 'T-1001', 'Document Type': 'Statement', Brand: 'Remus' } });
    expect(r.isCancelled).toBe(false);
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

  it('returns mailpieces: every pack in the envelope, in the customer\'s sequence, whichever pack matched', async () => {
    const repo = new MssqlRepository(ipool); const ref = await loadReferenceData(ipool);
    const two = buildXml([person('Mia', 'Merge', { passthrough: { 'Tenant Reference': 'M-1', 'Document Type': 'Leaflet' } }), person('Mia', 'Merge', { passthrough: { 'Tenant Reference': 'M-2', 'Document Type': 'Statement' } })]);
    await ingest(two.xml, 'job-merge.xml', 'job-merge.pdf', { ref, pdf: new FakePdf(two.pages), repo });
    // both letters in one envelope: the customer's matching rules do this at import. (If they did not, it is done directly here.) The second letter in the file goes in first.
    const [first, second] = (await pool.request().query(`SELECT m.mailpiece_id AS id FROM idoc.mailpiece m JOIN idoc.job j ON j.job_id = m.job_id WHERE j.base_name = N'job-merge' ORDER BY m.mailpiece_id`)).recordset.map((r) => Number(r.id)) as [number, number | undefined];
    if (second !== undefined) await pool.request().query(`
      UPDATE idoc.pack SET mailpiece_id = ${first} WHERE mailpiece_id = ${second};
      DELETE FROM idoc.mailpiece WHERE mailpiece_id = ${second};
      UPDATE idoc.mailpiece SET pack_count = 2 WHERE mailpiece_id = ${first}`);
    expect((await pool.request().query(`SELECT pack_count AS n FROM idoc.mailpiece WHERE mailpiece_id = ${first}`)).recordset[0].n).toBe(2);
    await pool.request().query(`
      UPDATE p SET document_sequence = 2 FROM idoc.pack p JOIN idoc.pack_passthrough pp ON pp.pack_id = p.pack_id JOIN idoc.passthrough_value v ON v.passthrough_value_id = pp.passthrough_value_id WHERE p.mailpiece_id = ${first} AND v.value = N'M-2'`);
    for (const search of [{ name: 'mia merge' }, { reference: 'M-1' }, { reference: 'M-2' }]) {
      const rows = (await store.search(q(search))).rows;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.mailpieceId).toBe(first);
      expect(rows[0]!.packs.map((k) => [k.position, k.sequence, k.references['Tenant Reference']])).toEqual([[1, 2, 'M-2'], [2, null, 'M-1']]);
      expect(rows[0]!.packs[0]!.references['Document Type']).toBe('Statement');
    }
  });

  it('the price of a mailpiece: its lines and totals once priced, and the reason when it has none', async () => {
    const mp = async (first: string): Promise<number> => (await pool.request().query(`
      SELECT p.mailpiece_id AS n FROM idoc.pack p JOIN idoc.address_line l ON l.address_id = p.address_id AND l.line_no = 1 WHERE l.text = N'${first}'`)).recordset[0].n;
    // before any costing model exists, the mailpiece from the first job has no price, and the reason says so
    const early = await mp('Ann Patel');
    expect(await store.price(early)).toMatchObject({ mailpieceId: early, priced: false, reason: expect.stringMatching(/No costing model was in force for this customer on \d{4}-\d{2}-\d{2}/), lines: [] });
    expect((await store.search(q({ name: 'ann' }))).rows[0]!.priceSell).toBeNull();

    const model = (await pool.request().query(`INSERT INTO idoc.costing_model (account_id, name, valid_from) OUTPUT INSERTED.costing_model_id AS n VALUES (${customer}, N'Search prices', '2000-01-01')`)).recordset[0].n as number;
    await pool.request().query(`INSERT INTO idoc.costing_model_rate (costing_model_id, charge_code, cost, sell_price, adjustment) VALUES (${model}, N'HPOD', 0.1, 0.2, 0), (${model}, N'MONO_PAGE', 0.02, 0.04, 0.01)`);
    expect((await store.price(early)).reason).toBe('It has not been priced yet.'); // a model exists now, but this mailpiece was not priced with it

    const repo = new MssqlRepository(ipool); const ref = await loadReferenceData(ipool);
    const priced = buildXml([person('Pia', 'Priced')]);
    await ingest(priced.xml, 'job-priced.xml', 'job-priced.pdf', { ref, pdf: new FakePdf(priced.pages), repo });
    const id1 = await mp('Pia Priced');
    const p = await store.price(id1);
    expect(p).toMatchObject({ mailpieceId: id1, priced: true, reason: null, model: { id: model, name: 'Search prices' }, packs: 1, colourPages: 0, monoPages: 2, blankPages: 0 });
    expect(p.lines.find((l) => l.code === 'HPOD')).toMatchObject({ quantity: 1, unitSell: 0.2, sell: 0.2 });
    expect(p.lines.find((l) => l.code === 'MONO_PAGE')).toMatchObject({ quantity: 2, unitSell: 0.05, sell: 0.1 });
    expect(p.lines.reduce((t, l) => t + l.sell, 0)).toBeCloseTo(p.productionSell, 4);
    expect(p.totalSell).toBeCloseTo(p.productionSell + p.postageSell, 4);
    expect(p.pricedAt).not.toBeNull();
    expect((await store.search(q({ name: 'pia' }))).rows[0]!.priceSell).toBeCloseTo(p.totalSell, 4);

    // XML first: the colours are not known until the PDF arrives
    const waiting = buildXml([person('Wes', 'Waiting')]);
    await ingest(waiting.xml, 'job-waiting.xml', null, { ref, pdf: new FakePdf(0), repo });
    expect(await store.price(await mp('Wes Waiting'))).toMatchObject({ priced: false, reason: expect.stringMatching(/colours of some of its pages are not known/) });
    await expect(store.price(999999)).rejects.toBeInstanceOf(NotFoundError);
  });
});
