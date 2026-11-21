import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type sql from 'mssql';
import { connect, hasDb, resetAndSeed } from './setup.js';
import { MssqlRepository, DuplicatePackError, ReferenceError_ } from '../../src/mssql/repository.js';
import { loadReferenceData } from '../../src/mssql/reference.js';
import { ingest } from '../../src/ingest.js';
import { loadAlertSettings, parseRecipients } from '../../src/mssql/alertSettings.js';
import { loadRunSheetInputs } from '../../src/runsheet/query.js';
import { buildXml, FakePdf, type PackSpec } from '../helpers.js';

/**
 * Integration tests against a REAL SQL Server scratch database (INTELLIDOC_TEST_DB).
 * They DROP and recreate the idoc schema - see setup.ts for the safety check.
 */
describe.skipIf(!hasDb)('MssqlRepository', { timeout: 120_000 }, () => {
  let pool: sql.ConnectionPool;
  let repo: MssqlRepository;
  beforeAll(async () => { pool = await connect(); await resetAndSeed(pool); repo = new MssqlRepository(pool); });
  afterAll(async () => { await pool?.close(); });

  const person = (first: string, surname: string, extra: Partial<PackSpec> = {}): PackSpec =>
    ({ first, surname, lines: [`${first} ${surname}`, '1 High Street', 'Town', 'AB1 2CD'], ...extra });
  async function load(specs: PackSpec[], name: string) {
    const ref = await loadReferenceData(pool);
    const { xml, pages } = buildXml(specs);
    return ingest(xml, name, `${name}.pdf`, { ref, pdf: new FakePdf(pages), repo });
  }
  const scalar = async (q: string): Promise<number> => (await pool.request().query(q)).recordset[0].n as number;

  it('loads reference data from the tables', async () => {
    const ref = await loadReferenceData(pool);
    expect(ref.settings.a4SheetWeightG).toBe(5.625);
    expect(ref.postalFormats.map((f) => f.name)).toEqual(['Letter', 'Large Letter', 'Small Parcel', 'Medium Parcel']);
    expect(ref.stock.get('INSERT-PARENT')?.linked).toEqual(['INSERT-CHILD']);
    const fexco = ref.accounts.get('FEXCO')!;
    expect(fexco.customerCode).toBe('FEXCO_CUSTOMER'); // the root of the tree
    expect(fexco.invoicingCode).toBe('FEXCO_CUSTOMER'); // default: the account that holds the settings
    expect(fexco.matchingEnabled).toBe(true); // read from the customer, not the submitting account
    expect(fexco.envelopes.length).toBeGreaterThan(0);
    expect(ref.anonymousAddressees.has('THEOCCUPIER')).toBe(true);
  });

  it('persists a job: customer on the pack, submitting account kept, physical values stored', async () => {
    const r = await load([person('Ann', 'Lee'), person('Ann', 'Lee'), person('Bob', 'Lee')], 'job-basic.xml');
    expect(r.issues).toEqual([]);
    expect(r.persisted).toBe(true);
    const jobId = await scalar(`SELECT job_id AS n FROM idoc.job WHERE base_name = N'job-basic'`);
    expect(await scalar(`SELECT COUNT(*) AS n FROM idoc.pack WHERE job_id = ${jobId}`)).toBe(3);
    expect(await scalar(`SELECT COUNT(*) AS n FROM idoc.mailpiece WHERE job_id = ${jobId}`)).toBe(2);
    expect(await scalar(`SELECT COUNT(*) AS n FROM idoc.pack p JOIN idoc.account c ON c.account_id = p.account_id JOIN idoc.account s ON s.account_id = p.submitting_account_id
                         WHERE p.job_id = ${jobId} AND c.account_code = N'FEXCO_CUSTOMER' AND s.account_code = N'FEXCO'`)).toBe(3);
    // Ann Lee x2 -> 2 sheets: ceil(2*5.625 + 3.5) = 15g, Letter, C5 envelope
    const mp = (await pool.request().query(`SELECT m.weight_g, f.name AS format, m.sheet_count, m.pack_count FROM idoc.mailpiece m JOIN idoc.postal_format f ON f.postal_format_id = m.postal_format_id
                                            WHERE m.job_id = ${jobId} AND m.pack_count = 2`)).recordset[0];
    expect(mp).toMatchObject({ weight_g: 15, format: 'Letter', sheet_count: 2 });
    // requested (XML) vs actual settings are both kept and can be compared
    expect(await scalar(`SELECT COUNT(*) AS n FROM idoc.v_pack_requested_vs_actual WHERE job_id = ${jobId} AND requested_format = N'Letter' AND actual_format = N'Letter' AND format_changed = 0`)).toBe(3);
    expect(await scalar('SELECT COUNT(*) AS n FROM idoc.v_rule_violations')).toBe(0);
  });

  it('envelope inheritance: INHERIT uses the parent list, EXTEND adds to it, and a nearer entry replaces one with the same key', async () => {
    const parent = (await loadReferenceData(pool)).accounts.get('FEXCO_CUSTOMER')!.envelopes.length;
    expect(parent).toBeGreaterThan(1);
    await pool.request().query(`INSERT INTO idoc.account (account_code, name, parent_account_id, envelopes_mode) SELECT N'ENV_CHILD', N'Env child', account_id, N'INHERIT' FROM idoc.account WHERE account_code = N'FEXCO_CUSTOMER'`);
    expect((await loadReferenceData(pool)).accounts.get('ENV_CHILD')!.envelopes).toHaveLength(parent);
    // its own envelope for its own brand, in addition to the parent's
    await pool.request().query(`
      UPDATE idoc.account SET envelopes_mode = N'EXTEND' WHERE account_code = N'ENV_CHILD';
      INSERT INTO idoc.account_envelope (account_id, brand_id, delivery_band, postal_rate_id, outer_stock_item_id, reference)
      SELECT c.account_id, NULL, e.delivery_band, e.postal_rate_id, e.outer_stock_item_id, N'child-only'
      FROM idoc.account c CROSS APPLY (SELECT TOP 1 * FROM idoc.account_envelope WHERE account_id = (SELECT account_id FROM idoc.account WHERE account_code = N'FEXCO_CUSTOMER')) e WHERE c.account_code = N'ENV_CHILD'`);
    expect((await loadReferenceData(pool)).accounts.get('ENV_CHILD')!.envelopes).toHaveLength(parent + 1);
    // an entry with the same brand name, band, rate and reference as one of the parent's replaces it instead of adding a second
    await pool.request().query(`
      INSERT INTO idoc.brand (account_id, name) SELECT account_id, N'Remus' FROM idoc.account WHERE account_code = N'ENV_CHILD';
      INSERT INTO idoc.account_envelope (account_id, brand_id, delivery_band, postal_rate_id, outer_stock_item_id, reference)
      SELECT c.account_id, (SELECT brand_id FROM idoc.brand WHERE account_id = c.account_id AND name = N'Remus'), e.delivery_band, e.postal_rate_id, e.outer_stock_item_id, e.reference
      FROM idoc.account c CROSS APPLY (SELECT TOP 1 ae.* FROM idoc.account_envelope ae JOIN idoc.brand b ON b.brand_id = ae.brand_id
        WHERE ae.account_id = (SELECT account_id FROM idoc.account WHERE account_code = N'FEXCO_CUSTOMER') AND b.name = N'Remus') e WHERE c.account_code = N'ENV_CHILD'`);
    expect((await loadReferenceData(pool)).accounts.get('ENV_CHILD')!.envelopes).toHaveLength(parent + 1);
    // OWN: only its own rows; the mode needs a parent
    await pool.request().query(`UPDATE idoc.account SET envelopes_mode = N'OWN' WHERE account_code = N'ENV_CHILD'`);
    expect((await loadReferenceData(pool)).accounts.get('ENV_CHILD')!.envelopes.length).toBeLessThan(parent);
    await expect(pool.request().query(`INSERT INTO idoc.account (account_code, name, envelopes_mode) VALUES (N'ENV_ORPHAN', N'Orphan', N'INHERIT')`)).rejects.toThrow(/ck_account_envmode/);
    await expect(pool.request().query(`UPDATE idoc.account SET envelopes_mode = N'SOMETIMES' WHERE account_code = N'ENV_CHILD'`)).rejects.toThrow(/ck_account_envmode/);
  });

  it('mailpiece snapshot: sub-account, path, invoicing account, brand and envelope are kept as at production, whatever changes later', async () => {
    const r = await load([person('Sam', 'Snap')], 'job-snapshot.xml');
    expect(r.persisted).toBe(true);
    const jobId = await scalar(`SELECT job_id AS n FROM idoc.job WHERE base_name = N'job-snapshot'`);
    const names = (await pool.request().query(`SELECT account_code, name FROM idoc.account WHERE account_code IN (N'FEXCO', N'FEXCO_CUSTOMER')`)).recordset as { account_code: string; name: string }[];
    const nameOf = (c: string) => names.find((n) => n.account_code === c)!.name;
    const read = async () => (await pool.request().query(`
      SELECT m.submitting_account_code, m.submitting_account_name, m.submitting_account_path, m.invoicing_account_code, m.invoicing_account_name, m.brand_name, m.outer_stock_code,
             s.account_code AS sub_code, b.outer_stock_item_id, si.stock_code AS batch_stock_code
      FROM idoc.mailpiece m JOIN idoc.account s ON s.account_id = m.submitting_account_id JOIN idoc.batch b ON b.batch_id = m.batch_id JOIN idoc.stock_item si ON si.stock_item_id = b.outer_stock_item_id
      WHERE m.job_id = ${jobId}`)).recordset[0] as Record<string, string>;
    const before = await read();
    expect(before).toMatchObject({
      sub_code: 'FEXCO', submitting_account_code: 'FEXCO', submitting_account_name: nameOf('FEXCO'), submitting_account_path: `${nameOf('FEXCO_CUSTOMER')} > ${nameOf('FEXCO')}`,
      invoicing_account_code: 'FEXCO_CUSTOMER', invoicing_account_name: nameOf('FEXCO_CUSTOMER'), brand_name: 'Remus',
    });
    expect(before.outer_stock_code).toBe(before.batch_stock_code);
    // rename the accounts, the brand and the envelope's stock code afterwards: the snapshot does not move
    try {
      await pool.request().query(`
        UPDATE idoc.account SET name = name + N' (renamed)' WHERE account_code IN (N'FEXCO', N'FEXCO_CUSTOMER');
        UPDATE idoc.brand SET name = name + N' (renamed)' WHERE name = N'Remus';
        UPDATE idoc.stock_item SET stock_code = stock_code + N'-X' WHERE stock_code = N'${before.batch_stock_code}'`);
      expect(await read()).toEqual(before);
    } finally {
      await pool.request().query(`
        UPDATE idoc.account SET name = REPLACE(name, N' (renamed)', N'') WHERE account_code IN (N'FEXCO', N'FEXCO_CUSTOMER');
        UPDATE idoc.brand SET name = REPLACE(name, N' (renamed)', N'') WHERE name LIKE N'%(renamed)';
        UPDATE idoc.stock_item SET stock_code = REPLACE(stock_code, N'-X', N'') WHERE stock_code = N'${before.batch_stock_code}-X'`);
    }
  });

  it('invoicing account: the batch and mailpieces record it, and the run sheet prints its job number', async () => {
    await pool.request().query(`UPDATE idoc.account SET mis_job_number = N'1111' WHERE account_code = N'FEXCO_CUSTOMER'; UPDATE idoc.account SET mis_job_number = N'2222' WHERE account_code = N'FEXCO'`);
    try {
      let r = await load([person('Ed', 'Fox')], 'job-inv-default.xml');
      expect(r.persisted).toBe(true);
      let jobId = await scalar(`SELECT job_id AS n FROM idoc.job WHERE base_name = N'job-inv-default'`);
      expect((await loadRunSheetInputs(pool, jobId))[0]!.jobNumber).toBe('1111');
      expect(await scalar(`SELECT COUNT(*) AS n FROM idoc.batch b JOIN idoc.account i ON i.account_id = b.invoicing_account_id WHERE b.job_id = ${jobId} AND i.account_code = N'FEXCO_CUSTOMER'`)).toBe(1);
      // the sub-account is now invoiced in its own right
      await pool.request().query(`UPDATE idoc.account SET invoicing_account_id = account_id WHERE account_code = N'FEXCO'`);
      r = await load([person('Gus', 'Fox')], 'job-inv-own.xml');
      expect(r.persisted).toBe(true);
      jobId = await scalar(`SELECT job_id AS n FROM idoc.job WHERE base_name = N'job-inv-own'`);
      expect((await loadRunSheetInputs(pool, jobId))[0]!.jobNumber).toBe('2222');
      expect(await scalar(`SELECT COUNT(*) AS n FROM idoc.mailpiece m JOIN idoc.account i ON i.account_id = m.invoicing_account_id WHERE m.job_id = ${jobId} AND i.account_code = N'FEXCO'`)).toBe(1);
    } finally {
      await pool.request().query(`UPDATE idoc.account SET mis_job_number = NULL, invoicing_account_id = NULL WHERE account_code IN (N'FEXCO_CUSTOMER', N'FEXCO')`);
    }
  });

  it('gives every batch its own global batch code and the run sheet loader finds the data', async () => {
    const r = await load([person('Cy', 'Day'), person('Di', 'Day')], 'job-runsheet.xml');
    expect(r.persisted).toBe(true);
    const jobId = await scalar(`SELECT job_id AS n FROM idoc.job WHERE base_name = N'job-runsheet'`);
    const inputs = await loadRunSheetInputs(pool, jobId);
    expect(inputs.length).toBe(r.batches.length);
    expect(inputs.reduce((n, i) => n + i.mailpieces, 0)).toBe(2);
    expect(new Set(inputs.map((i) => i.batchCode)).size).toBe(inputs.length);
    expect(inputs[0]!.envelopeCode).not.toBe('');
    expect(inputs[0]!.weightBandsG).toHaveLength(inputs[0]!.mailpieces);
    expect(await scalar('SELECT COUNT(*) - COUNT(DISTINCT batch_code) AS n FROM idoc.batch')).toBe(0);
  });

  it('XML-first: saves without a PDF, alerts when overdue, attaches the PDF later', async () => {
    const ref = await loadReferenceData(pool);
    const { xml } = buildXml([person('Pat', 'Late'), person('Quinn', 'Late')]);
    const r = await ingest(xml, 'job-nopdf.xml', null, { ref, pdf: new FakePdf(0), repo });
    expect(r.persisted).toBe(true);
    const jobId = await scalar(`SELECT job_id AS n FROM idoc.job WHERE base_name = N'job-nopdf'`);
    expect(await scalar(`SELECT COUNT(*) AS n FROM idoc.job WHERE job_id = ${jobId} AND status = N'Awaiting PDF'`)).toBe(1);
    expect((await repo.listOverdue(30, 30)).some((j) => j.jobId === jobId)).toBe(false);
    expect((await repo.listOverdue(-1, 30)).find((j) => j.jobId === jobId)).toMatchObject({ baseName: 'job-nopdf', packCount: 2 });
    await repo.markAlerted(jobId);
    expect((await repo.listOverdue(-1, 30)).some((j) => j.jobId === jobId)).toBe(false); // reminded too recently (-1 = ignore timestamp rounding)
    expect((await repo.listOverdue(-1, 0)).some((j) => j.jobId === jobId)).toBe(true);
    const found = await repo.findAwaitingPdf('JOB-NOPDF');
    expect(found).toMatchObject({ jobId, alertCount: 1 });
    expect(found!.packs).toHaveLength(2);
    expect(await repo.markPdfReceived(jobId, 4)).toEqual({ alertCount: 1 });
    expect(await scalar(`SELECT COUNT(*) AS n FROM idoc.job WHERE job_id = ${jobId} AND status = N'Received' AND pdf_received_at IS NOT NULL`)).toBe(1);
    expect(await repo.findAwaitingPdf('job-nopdf')).toBeNull();
  });

  it('reads the alert settings, with their defaults, from idoc.settings', async () => {
    expect(await loadAlertSettings(pool)).toEqual({ xmlFirst: true, pdfWaitMinutes: 30, pdfReminderMinutes: 30, alertTo: [] });
    await pool.request().query(`UPDATE idoc.settings SET pdf_wait_minutes = 5, alert_recipients = N'a@x.com, b@x.com' WHERE settings_id = 1`);
    expect(await loadAlertSettings(pool)).toMatchObject({ pdfWaitMinutes: 5, alertTo: ['a@x.com', 'b@x.com'] });
    await pool.request().query('UPDATE idoc.settings SET pdf_wait_minutes = 30, alert_recipients = N\'\' WHERE settings_id = 1');
    expect(parseRecipients('a@x.com; b@x.com  c@x.com')).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
  });

  it('stores address lines without the postcode line and keeps >6 lines', async () => {
    await load([{ first: 'Long', surname: 'Address', lines: ['Long Address', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'AB1 2CD'] }], 'job-lines.xml');
    expect(await scalar(`SELECT MAX(line_no) AS n FROM idoc.address_line al JOIN idoc.address a ON a.address_id = al.address_id WHERE a.address_id IN
                         (SELECT address_id FROM idoc.address_line WHERE text = N'l7')`)).toBe(7);
  });

  it('batches: 25 mailpieces -> Hand enclosing, 26 -> Machine enclosing', async () => {
    const many = (n: number, tag: string): PackSpec[] => Array.from({ length: n }, (_, i) => person('P', `${tag}${i}`));
    await load(many(25, 'H'), 'job-25.xml'); await load(many(26, 'M'), 'job-26.xml');
    const dept = async (base: string): Promise<string> => (await pool.request().query(
      `SELECT b.fulfilment_department AS d FROM idoc.batch b JOIN idoc.job j ON j.job_id = b.job_id WHERE j.base_name = N'${base}'`)).recordset[0].d as string;
    expect(await dept('job-25')).toBe('Hand enclosing');
    expect(await dept('job-26')).toBe('Machine enclosing');
    expect(await scalar('SELECT COUNT(*) AS n FROM idoc.v_rule_violations')).toBe(0);
  });

  it('heavy insert forces the C4 envelope and Large Letter, never machine enclosing', async () => {
    await load(Array.from({ length: 30 }, (_, i) => person('H', `W${i}`, { inserts: ['INSERT-HEAVY'] })), 'job-heavy.xml');
    const b = (await pool.request().query(`SELECT b.fulfilment_department AS d, s.stock_code AS env, f.name AS fmt FROM idoc.batch b JOIN idoc.job j ON j.job_id = b.job_id
        JOIN idoc.stock_item s ON s.stock_item_id = b.outer_stock_item_id JOIN idoc.postal_format f ON f.postal_format_id = b.postal_format_id WHERE j.base_name = N'job-heavy'`)).recordset[0];
    expect(b).toMatchObject({ d: 'Hand enclosing', env: 'C4-REMUS', fmt: 'Large Letter' });
  });

  it('DATABASE refuses to attach a pack to another person\'s mailpiece (GDPR)', async () => {
    await load([person('Cy', 'Kay'), person('Di', 'Kay')], 'job-gdpr.xml');
    const rows = (await pool.request().query(`SELECT p.pack_id, p.mailpiece_id FROM idoc.pack p JOIN idoc.job j ON j.job_id = p.job_id WHERE j.base_name = N'job-gdpr' ORDER BY p.pack_id`)).recordset;
    expect(rows).toHaveLength(2);
    await expect(pool.request().query(`UPDATE idoc.pack SET mailpiece_id = ${rows[1].mailpiece_id} WHERE pack_id = ${rows[0].pack_id}`))
      .rejects.toThrow(/fk_pack_mailpiece_same_recipient/i);
  });

  it('DATABASE refuses to put two match-excluded packs in one envelope', async () => {
    const o: PackSpec = { first: 'THE', surname: 'OCCUPIER', lines: ['THE OCCUPIER', '5 Road', 'AB1 2CD'] };
    await load([o, o], 'job-anon.xml');
    const rows = (await pool.request().query(`SELECT p.pack_id, p.mailpiece_id, p.match_exclusion_reason AS why FROM idoc.pack p JOIN idoc.job j ON j.job_id = p.job_id WHERE j.base_name = N'job-anon' ORDER BY p.pack_id`)).recordset;
    expect(rows.map((r) => r.why)).toEqual(['ANONYMOUS_ADDRESSEE', 'ANONYMOUS_ADDRESSEE']);
    expect(rows[0].mailpiece_id).not.toBe(rows[1].mailpiece_id);
    // same address row, so the recipient FK passes - the filtered unique index must stop it
    await expect(pool.request().query(`UPDATE idoc.pack SET mailpiece_id = ${rows[0].mailpiece_id} WHERE pack_id = ${rows[1].pack_id}`))
      .rejects.toThrow(/ux_pack_excluded_alone/i);
  });

  it('is all-or-nothing: a failure part-way through leaves no rows', async () => {
    const ref = await loadReferenceData(pool);
    const { xml, pages } = buildXml([person('Ed', 'Roll'), person('Fay', 'Roll')]);
    const mem = { async packExists() { return false; }, async saveJob() { /* capture only */ } };
    const result = await ingest(xml, 'job-rollback.xml', 'job-rollback.pdf', { ref, pdf: new FakePdf(pages), repo: mem });
    result.batches[0]!.envelopeCode = 'DOES-NOT-EXIST';
    await expect(repo.saveJob(result)).rejects.toThrow(ReferenceError_);
    expect(await scalar(`SELECT COUNT(*) AS n FROM idoc.job WHERE base_name = N'job-rollback'`)).toBe(0);
    expect(await scalar(`SELECT COUNT(*) AS n FROM idoc.pack WHERE recipient_surname = N'Roll'`)).toBe(0);
  });

  it('duplicate packs: re-ingest is skipped; a forced second save throws and rolls back', async () => {
    const guid = '99999999-9999-4999-8999-999999999999';
    const spec = [person('Gus', 'Dupe', { guid })];
    expect((await load(spec, 'job-dupe-1.xml')).persisted).toBe(true);
    const again = await load(spec, 'job-dupe-2.xml');
    expect(again.duplicates).toEqual([guid]); expect(again.persisted).toBe(false);
    const ref = await loadReferenceData(pool);
    const { xml, pages } = buildXml(spec);
    const mem = { async packExists() { return false; }, async saveJob() { /* capture only */ } };
    const forced = await ingest(xml, 'job-dupe-3.xml', 'job-dupe-3.pdf', { ref, pdf: new FakePdf(pages), repo: mem });
    await expect(repo.saveJob(forced)).rejects.toThrow(DuplicatePackError);
    expect(await scalar(`SELECT COUNT(*) AS n FROM idoc.job WHERE base_name = N'job-dupe-3'`)).toBe(0);
  });

  it('passthrough and identifiers are normalised into dictionaries', async () => {
    await load([person('Hal', 'Dict', { passthrough: { Property: 'P-1' } }), person('Ida', 'Dict', { passthrough: { Property: 'P-1' } })], 'job-dict.xml');
    expect(await scalar(`SELECT COUNT(*) AS n FROM idoc.passthrough_value WHERE value = N'P-1'`)).toBe(1);
    expect(await scalar(`SELECT COUNT(*) AS n FROM idoc.pack_passthrough pp JOIN idoc.passthrough_value v ON v.passthrough_value_id = pp.passthrough_value_id WHERE v.value = N'P-1'`)).toBe(2);
  });
});
