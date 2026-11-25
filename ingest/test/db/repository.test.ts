import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type sql from 'mssql';
import { connect, hasDb, resetAndSeed } from './setup.js';
import { MssqlRepository, DuplicatePackError, ProductionGateError, ReferenceError_ } from '../../src/mssql/repository.js';
import { loadReferenceData } from '../../src/mssql/reference.js';
import { findCostingModel } from '../../src/mssql/costing.js';
import { priceJob } from '../../src/mssql/pricing.js';
import { Repricer } from '../../src/mssql/reprice.js';
import { ingest } from '../../src/ingest.js';
import { loadAlertSettings, parseRecipients } from '../../src/mssql/alertSettings.js';
import { loadRunSheetInputs } from '../../src/runsheet/query.js';
import { loadJobEmailSummary } from '../../src/runsheet/email.js';
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
      // the batch's stock code is a live join and does follow the rename; everything the mailpiece snapshotted does not
      const { batch_stock_code: liveBefore, ...snapshotBefore } = before; const { batch_stock_code: liveAfter, ...snapshotAfter } = await read();
      expect(liveAfter).toBe(`${liveBefore}-X`);
      expect(snapshotAfter).toEqual(snapshotBefore);
    } finally {
      await pool.request().query(`
        UPDATE idoc.account SET name = REPLACE(name, N' (renamed)', N'') WHERE account_code IN (N'FEXCO', N'FEXCO_CUSTOMER');
        UPDATE idoc.brand SET name = REPLACE(name, N' (renamed)', N'') WHERE name LIKE N'%(renamed)';
        UPDATE idoc.stock_item SET stock_code = REPLACE(stock_code, N'-X', N'') WHERE stock_code = N'${before.batch_stock_code}-X'`);
    }
  });

  it('settings inheritance: brands, matching, pack sequence read from the parent under INHERIT, add up under EXTEND, and stay own under OWN', async () => {
    await pool.request().query(`
      INSERT INTO idoc.passthrough_key (name) VALUES (N'SetDept'), (N'SetDoc'), (N'SetRef');
      INSERT INTO idoc.account (account_code, name, is_address_matching, batching_key_id, pack_sequence_key_id)
        SELECT N'SET_P', N'Settings parent', 1, (SELECT passthrough_key_id FROM idoc.passthrough_key WHERE name = N'SetDept'), (SELECT passthrough_key_id FROM idoc.passthrough_key WHERE name = N'SetDoc');
      INSERT INTO idoc.account (account_code, name, parent_account_id) SELECT N'SET_K', N'Settings kid', account_id FROM idoc.account WHERE account_code = N'SET_P';
      INSERT INTO idoc.brand (account_id, name) SELECT account_id, v.n FROM idoc.account CROSS JOIN (VALUES (N'Home'), (N'Business')) v(n) WHERE account_code = N'SET_P';
      INSERT INTO idoc.address_match_rule (account_id, sequence_no, is_include, passthrough_key_id, passthrough_value)
        SELECT a.account_id, 1, 1, k.passthrough_key_id, NULL FROM idoc.account a, idoc.passthrough_key k WHERE a.account_code = N'SET_P' AND k.name = N'SetRef';
      INSERT INTO idoc.pack_sequence_rule (account_id, passthrough_value, sequence_number) SELECT account_id, v.n, v.i FROM idoc.account CROSS JOIN (VALUES (N'Bill', 1), (N'Reminder', 2)) v(n, i) WHERE account_code = N'SET_P'`);
    const kid = async () => (await loadReferenceData(pool)).accounts.get('SET_K')!;
    const mode = (set: string) => pool.request().query(`UPDATE idoc.account SET ${set} WHERE account_code = N'SET_K'`);
    // OWN (the default): nothing from the parent
    let k = await kid();
    expect(k.brands).toEqual([]); expect(k.matchingEnabled).toBe(false); expect(k.batchingKey).toBeNull(); expect(k.matchIncludeKeys).toEqual([]); expect(k.packSequence).toBeUndefined();
    // INHERIT: the parent's list and the parent's single values
    await mode(`brands_mode = N'INHERIT', matching_mode = N'INHERIT', sequence_mode = N'INHERIT'`);
    k = await kid();
    expect(k.brands.slice().sort()).toEqual(['Business', 'Home']);
    expect(k.matchingEnabled).toBe(true); expect(k.batchingKey).toBe('SetDept'); expect(k.matchIncludeKeys).toEqual(['SetRef']);
    expect(k.packSequence).toMatchObject({ key: 'SetDoc' }); expect([...k.packSequence!.rules]).toEqual([['Bill', 1], ['Reminder', 2]]);
    // EXTEND: the parent's list plus its own; its own single values; a nearer number for the same value replaces the parent's
    await pool.request().query(`
      INSERT INTO idoc.brand (account_id, name) SELECT account_id, N'Extra' FROM idoc.account WHERE account_code = N'SET_K';
      INSERT INTO idoc.pack_sequence_rule (account_id, passthrough_value, sequence_number) SELECT account_id, v.n, v.i FROM idoc.account CROSS JOIN (VALUES (N'Reminder', 5), (N'Final', 3)) v(n, i) WHERE account_code = N'SET_K';
      UPDATE idoc.account SET pack_sequence_key_id = (SELECT passthrough_key_id FROM idoc.passthrough_key WHERE name = N'SetDoc') WHERE account_code = N'SET_K'`);
    await mode(`brands_mode = N'EXTEND', matching_mode = N'EXTEND', sequence_mode = N'EXTEND'`);
    k = await kid();
    expect(k.brands.slice().sort()).toEqual(['Business', 'Extra', 'Home']);
    expect(k.matchingEnabled).toBe(false); expect(k.batchingKey).toBeNull(); expect(k.matchIncludeKeys).toEqual(['SetRef']); // single values are its own; the rules add up
    expect(Object.fromEntries(k.packSequence!.rules)).toEqual({ Reminder: 5, Final: 3, Bill: 1 });
    // OWN again: only its own
    await mode(`brands_mode = N'OWN', matching_mode = N'OWN', sequence_mode = N'OWN'`);
    k = await kid();
    expect(k.brands).toEqual(['Extra']); expect(k.matchIncludeKeys).toEqual([]); expect(Object.fromEntries(k.packSequence!.rules)).toEqual({ Reminder: 5, Final: 3 });
    // a sub-account of the kid follows the kid's choice, whatever it is
    await pool.request().query(`INSERT INTO idoc.account (account_code, name, parent_account_id, inherits_settings) SELECT N'SET_SUB', N'Settings sub', account_id, 1 FROM idoc.account WHERE account_code = N'SET_K'`);
    expect((await loadReferenceData(pool)).accounts.get('SET_SUB')!.brands).toEqual(['Extra']);
    // the mode needs a parent and one of the three values
    await expect(pool.request().query(`INSERT INTO idoc.account (account_code, name, brands_mode) VALUES (N'SET_ORPHAN', N'Orphan', N'INHERIT')`)).rejects.toThrow(/ck_account_modes/);
    await expect(mode(`emails_mode = N'SOMETIMES'`)).rejects.toThrow(/ck_account_modes/);
  });

  it('batch event log: every batch starts with Created, later events move the status, cancelled is final', async () => {
    await load([person('Eve', 'Events')], 'job-events.xml');
    const batchId = await scalar(`SELECT TOP 1 b.batch_id AS n FROM idoc.batch b JOIN idoc.job j ON j.job_id = b.job_id WHERE j.base_name = N'job-events'`);
    expect((await repo.batchEvents(batchId)).map((e) => e.type)).toEqual(['Created']);
    expect(await scalar(`SELECT COUNT(*) AS n FROM idoc.batch b WHERE NOT EXISTS (SELECT 1 FROM idoc.batch_event e WHERE e.batch_id = b.batch_id AND e.event_type = N'Created')`)).toBe(0);

    await repo.recordBatchEvent(batchId, 'Printed', { by: 'press' });
    await repo.recordBatchEvent(batchId, 'Enclosed', { by: 'hand room', note: 'two trays' });
    const events = await repo.batchEvents(batchId);
    expect(events.map((e) => e.type)).toEqual(['Created', 'Printed', 'Enclosed']);
    expect(events[1]).toMatchObject({ by: 'press', note: null });
    expect(events[2]).toMatchObject({ by: 'hand room', note: 'two trays' });
    expect((await pool.request().query(`SELECT current_status AS s FROM idoc.batch WHERE batch_id = ${batchId}`)).recordset[0].s).toBe('Enclosed');

    await expect(repo.recordBatchEvent(batchId, 'Created')).rejects.toThrow(/Created/);
    await expect(repo.recordBatchEvent(999999999, 'Printed')).rejects.toThrow(/does not exist/);
    // an event type outside the list is refused by the database too
    await expect(pool.request().query(`INSERT INTO idoc.batch_event (batch_id, event_type) VALUES (${batchId}, N'Lost')`)).rejects.toThrow(/ck_batch_event_type/);
    await expect(pool.request().query(`UPDATE idoc.batch SET current_status = N'Lost' WHERE batch_id = ${batchId}`)).rejects.toThrow(/ck_batch_status/);

    await repo.recordBatchEvent(batchId, 'Cancelled', { note: 'customer withdrew' });
    await expect(repo.recordBatchEvent(batchId, 'Despatched')).rejects.toThrow(/cancelled/);
    expect((await repo.batchEvents(batchId)).map((e) => e.type)).toEqual(['Created', 'Printed', 'Enclosed', 'Cancelled']);
  });

  it('a job belongs to the account that holds the settings: itself, or the nearest ancestor that does not inherit', async () => {
    const add = async (code: string, parent: string | null, inherits: number): Promise<void> => {
      await pool.request().query(`INSERT INTO idoc.account (account_code, name, parent_account_id, inherits_settings)
        VALUES (N'${code}', N'${code}', ${parent ? `(SELECT account_id FROM idoc.account WHERE account_code = N'${parent}')` : 'NULL'}, ${inherits})`);
    };
    await add('HOLD_TOP', null, 0); await add('HOLD_MID', 'HOLD_TOP', 0); await add('HOLD_LEAF', 'HOLD_MID', 1); await add('HOLD_LEAF2', 'HOLD_LEAF', 1);
    const ref = await loadReferenceData(pool);
    expect(ref.accounts.get('HOLD_TOP')!.customerCode).toBe('HOLD_TOP');
    expect(ref.accounts.get('HOLD_MID')!.customerCode).toBe('HOLD_MID');     // its own settings: not the top of the tree
    expect(ref.accounts.get('HOLD_LEAF')!.customerCode).toBe('HOLD_MID');    // inherits: the nearest account above with its own settings
    expect(ref.accounts.get('HOLD_LEAF2')!.customerCode).toBe('HOLD_MID');   // through two levels of inheriting
  });

  it('costing models: the one in force on the day, inherited by sub-accounts, with its rates', async () => {
    const acct = async (code: string, parent: string | null, extra = ''): Promise<number> => scalar(`
      INSERT INTO idoc.account (account_code, name, parent_account_id${extra ? ', ' + extra.split('=')[0] : ''}) OUTPUT INSERTED.account_id AS n
      VALUES (N'${code}', N'${code}', ${parent ? `(SELECT account_id FROM idoc.account WHERE account_code = N'${parent}')` : 'NULL'}${extra ? ', ' + extra.split('=')[1] : ''})`);
    const root = await acct('COST_ROOT', null);
    const kid = await acct('COST_KID', 'COST_ROOT', `costing_mode=N'INHERIT'`); // holds its own settings but takes the price list from the parent
    const sub = await acct('COST_SUB', 'COST_ROOT', 'inherits_settings=1'); // takes everything from the parent
    const own = await acct('COST_OWN', 'COST_ROOT'); // OWN, with no model of its own
    const model = async (account: number, name: string, from: string, to: string | null, active = 1): Promise<number> => scalar(`
      INSERT INTO idoc.costing_model (account_id, name, valid_from, valid_to, is_active) OUTPUT INSERTED.costing_model_id AS n VALUES (${account}, N'${name}', '${from}', ${to ? `'${to}'` : 'NULL'}, ${active})`);
    const m1 = await model(root, 'First', '2026-01-01', '2026-06-30');
    const m2 = await model(root, 'Second', '2026-07-01', null);
    await model(root, 'Switched off', '2026-09-01', null, 0);
    const ownModel = await model(kid, 'Kid own', '2026-01-01', null);
    const id = async (m: Awaited<ReturnType<typeof findCostingModel>>) => m?.id ?? null;

    expect(await id(await findCostingModel(pool, root, '2026-03-01'))).toBe(m1);
    expect(await id(await findCostingModel(pool, root, '2026-06-30'))).toBe(m1); // the last day counts
    expect(await id(await findCostingModel(pool, root, new Date('2026-07-01T09:00:00Z')))).toBe(m2);
    expect(await id(await findCostingModel(pool, root, '2026-12-01'))).toBe(m2); // the later model is switched off
    expect(await findCostingModel(pool, root, '2025-12-31')).toBeNull();
    // INHERIT passes to the parent even though the kid has a model of its own; a sub-account takes the parent's; OWN does not look up
    expect(await id(await findCostingModel(pool, kid, '2026-03-01'))).toBe(m1);
    expect(await id(await findCostingModel(pool, sub, '2026-08-01'))).toBe(m2);
    expect(await findCostingModel(pool, own, '2026-08-01')).toBeNull();
    await pool.request().query(`UPDATE idoc.account SET costing_mode = N'OWN' WHERE account_id = ${kid}`);
    expect(await id(await findCostingModel(pool, kid, '2026-03-01'))).toBe(ownModel);

    const stock = await scalar(`SELECT TOP 1 stock_item_id AS n FROM idoc.stock_item WHERE is_envelope = 1`);
    const rate = await scalar(`SELECT TOP 1 postal_rate_id AS n FROM idoc.postal_rate`);
    await pool.request().query(`
      INSERT INTO idoc.costing_model_rate (costing_model_id, charge_code, cost, sell_price, adjustment) VALUES (${m2}, N'MONO_PAGE', 0.0212, 0.0431, 0.005), (${m2}, N'HPOD', 0.1, 0.2, 0);
      INSERT INTO idoc.costing_model_envelope (costing_model_id, stock_item_id, cost, sell_price, adjustment) VALUES (${m2}, ${stock}, 0.04, 0.08, 0.01);
      INSERT INTO idoc.costing_model_postage (costing_model_id, postal_rate_id, adjustment) VALUES (${m2}, ${rate}, 0.05);`);
    const loaded = (await findCostingModel(pool, sub, '2026-08-01'))!;
    expect(loaded).toMatchObject({ id: m2, name: 'Second' });
    expect(loaded.rates.get('MONO_PAGE')).toEqual({ cost: 0.0212, sellPrice: 0.0431, adjustment: 0.005 });
    expect(loaded.rates.size).toBe(2);
    expect(loaded.envelopes.get(stock)).toEqual({ cost: 0.04, sellPrice: 0.08, adjustment: 0.01 });
    expect(loaded.postageAdjustments.get(rate)).toBe(0.05);

    // the database refuses what makes no sense
    await expect(pool.request().query(`INSERT INTO idoc.account (account_code, name, costing_mode) VALUES (N'COST_BAD', N'x', N'INHERIT')`)).rejects.toThrow(/ck_account_costing/); // no parent to inherit from
    await expect(pool.request().query(`UPDATE idoc.account SET costing_mode = N'EXTEND' WHERE account_id = ${kid}`)).rejects.toThrow(/ck_account_costing/);
    await expect(pool.request().query(`INSERT INTO idoc.costing_model_rate (costing_model_id, charge_code) VALUES (${m2}, N'GEO')`)).rejects.toThrow(/ck_cmr_code/);
    await expect(model(root, 'Same start', '2026-07-01', null)).rejects.toThrow(/ux_costing_model_start/);
    await expect(model(root, 'Backwards', '2027-01-01', '2026-01-01')).rejects.toThrow(/ck_costing_model_dates/);
  });

  it('production gate: nothing is printed, enclosed or despatched until the job PDF has arrived', async () => {
    const ref = await loadReferenceData(pool);
    const { xml } = buildXml([person('Gail', 'Gate')]);
    await ingest(xml, 'job-gate.xml', null, { ref, pdf: new FakePdf(0), repo }); // saved from the XML alone: Awaiting PDF
    const jobId = await scalar(`SELECT job_id AS n FROM idoc.job WHERE base_name = N'job-gate'`);
    const batchId = await scalar(`SELECT TOP 1 batch_id AS n FROM idoc.batch WHERE job_id = ${jobId}`);
    const view = async () => (await pool.request().query(`SELECT job_status, current_status, hold_reason, can_print FROM idoc.v_batch_production WHERE batch_id = ${batchId}`)).recordset[0];
    expect(await view()).toMatchObject({ job_status: 'Awaiting PDF', current_status: 'Created', hold_reason: 'Waiting for the PDF', can_print: false });

    for (const t of ['Printed', 'Enclosed', 'Despatched'] as const) await expect(repo.recordBatchEvent(batchId, t)).rejects.toBeInstanceOf(ProductionGateError);
    await expect(repo.recordBatchEvent(batchId, 'Printed')).rejects.toThrow(/job "job-gate" has not arrived/);
    expect((await repo.batchEvents(batchId)).map((e) => e.type)).toEqual(['Created']);
    // other writers are stopped by the database itself
    await expect(pool.request().query(`INSERT INTO idoc.batch_event (batch_id, event_type) VALUES (${batchId}, N'Printed')`)).rejects.toThrow(/Production gate/);
    await expect(pool.request().query(`UPDATE idoc.batch SET current_status = N'Printed' WHERE batch_id = ${batchId}`)).rejects.toThrow(/Production gate/);
    expect(await view()).toMatchObject({ current_status: 'Created' });

    await repo.markPdfReceived(jobId, 2);
    expect(await view()).toMatchObject({ job_status: 'Received', hold_reason: null, can_print: true });
    await repo.recordBatchEvent(batchId, 'Printed');
    expect(await view()).toMatchObject({ current_status: 'Printed', can_print: false });
  });

  it('production gate: a rejected PDF holds the batch with the reason, and a held batch can still be cancelled', async () => {
    const ref = await loadReferenceData(pool);
    const { xml } = buildXml([person('Rex', 'Rejected')]);
    await ingest(xml, 'job-rejected.xml', null, { ref, pdf: new FakePdf(0), repo });
    const jobId = await scalar(`SELECT job_id AS n FROM idoc.job WHERE base_name = N'job-rejected'`);
    const batchId = await scalar(`SELECT TOP 1 batch_id AS n FROM idoc.batch WHERE job_id = ${jobId}`);
    await repo.markPdfRejected(jobId, 'Page count does not match');
    expect((await pool.request().query(`SELECT hold_reason, can_print FROM idoc.v_batch_production WHERE batch_id = ${batchId}`)).recordset[0]).toMatchObject({ hold_reason: 'PDF rejected: Page count does not match', can_print: false });
    await expect(repo.recordBatchEvent(batchId, 'Printed')).rejects.toThrow(/was rejected \(Page count does not match\)/);
    await repo.recordBatchEvent(batchId, 'Cancelled', { note: 'bad PDF' });
    expect((await repo.batchEvents(batchId)).map((e) => e.type)).toEqual(['Created', 'Cancelled']);
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
    expect((await repo.listOverdue(-1, -1)).some((j) => j.jobId === jobId)).toBe(true); // -1: the stored alert time is rounded to the second, which can be just ahead of now
    const found = await repo.findAwaitingPdf('JOB-NOPDF');
    expect(found).toMatchObject({ jobId, alertCount: 1 });
    expect(found!.packs).toHaveLength(2);
    expect(await repo.markPdfReceived(jobId, 4)).toEqual({ alertCount: 1 });
    expect(await scalar(`SELECT COUNT(*) AS n FROM idoc.job WHERE job_id = ${jobId} AND status = N'Received' AND pdf_received_at IS NOT NULL`)).toBe(1);
    expect(await repo.findAwaitingPdf('job-nopdf')).toBeNull();
  });

  it('price at production: priced on ingest, when the PDF arrives, and again on request', async () => {
    const ref = await loadReferenceData(pool);
    const model = async (jobId: number): Promise<number> => {
      const customer = await scalar(`SELECT account_id AS n FROM idoc.job WHERE job_id = ${jobId}`);
      const id = await scalar(`INSERT INTO idoc.costing_model (account_id, name, valid_from) OUTPUT INSERTED.costing_model_id AS n VALUES (${customer}, N'Test prices', '2000-01-01')`);
      await pool.request().query(`INSERT INTO idoc.costing_model_rate (costing_model_id, charge_code, cost, sell_price, adjustment) VALUES
        (${id}, N'HPOD', 0.1, 0.2, 0), (${id}, N'MONO_PAGE', 0.02, 0.04, 0.01), (${id}, N'COLOUR_PAGE', 0.08, 0.12, 0), (${id}, N'PAPER_SHEET', 0, 0, 0)`);
      return id;
    };
    const mps = async (jobId: number) => (await pool.request().query(
      `SELECT mailpiece_id, costing_model_id, production_cost, production_sell, postage_cost, priced_at, price_warnings,
              (SELECT SUM(sell) FROM idoc.mailpiece_price_line l WHERE l.mailpiece_id = m.mailpiece_id) AS line_sell,
              (SELECT SUM(cost) FROM idoc.mailpiece_price_line l WHERE l.mailpiece_id = m.mailpiece_id) AS line_cost,
              (SELECT SUM(quantity) FROM idoc.mailpiece_price_line l WHERE l.mailpiece_id = m.mailpiece_id AND l.charge_code = N'MONO_PAGE') AS mono_qty,
              (SELECT SUM(quantity) FROM idoc.mailpiece_price_line l WHERE l.mailpiece_id = m.mailpiece_id AND l.charge_code = N'PAPER_SHEET') AS paper_qty,
              m.sheet_count
       FROM idoc.mailpiece m WHERE job_id = ${jobId} ORDER BY mailpiece_id`)).recordset;

    // no costing model yet: the job is saved and its mailpieces stay unpriced
    const a = buildXml([person('Pat', 'Price'), person('Quinn', 'Price')]);
    await ingest(a.xml, 'job-price-a.xml', 'job-price-a.pdf', { ref, pdf: new FakePdf(a.pages, '', ['mono', 'mono', 'colour', 'mono']), repo });
    const jobA = await scalar(`SELECT job_id AS n FROM idoc.job WHERE base_name = N'job-price-a'`);
    expect((await mps(jobA)).every((m) => m.priced_at === null)).toBe(true);
    // a model appears: pricing the job again prices it, and the lines add up to the totals
    const m1 = await model(jobA);
    expect(await priceJob(pool, jobA)).toEqual({ priced: 2, noModel: 0, unknownColours: 0 });
    const priced = await mps(jobA);
    expect(priced).toHaveLength(2);
    for (const m of priced) {
      expect(m.costing_model_id).toBe(m1);
      expect(Number(m.production_sell)).toBeCloseTo(Number(m.line_sell), 4);
      expect(Number(m.production_cost)).toBeCloseTo(Number(m.line_cost), 4);
      expect(Number(m.paper_qty)).toBe(Number(m.sheet_count)); // paper is billed on the sheets the mailpiece was counted as, as the composer prints them
    }
    // pack 1 is two mono pages: 0.20 + 2 x (0.04 + 0.01); pack 2 is a colour and a mono page: 0.20 + 0.12 + 0.05
    expect(Number(priced[0]!.production_sell)).toBeCloseTo(0.3, 4);
    expect(Number(priced[1]!.production_sell)).toBeCloseTo(0.37, 4);
    expect(priced[0]!.price_warnings).toMatch(/envelope/i);
    // running it again does not double the lines
    await priceJob(pool, jobA);
    expect(Number((await mps(jobA))[0]!.mono_qty)).toBe(2);
    // colour mode: pricing bills the pages as composed (held by the account that owns the settings)
    const setMode = (mode: string) => pool.request().query(`UPDATE a SET colour_mode = N'${mode}' FROM idoc.account a WHERE a.account_id IN
      (SELECT o.owner_account_id FROM idoc.v_account_owner o JOIN idoc.mailpiece m ON m.submitting_account_id = o.account_id WHERE m.job_id = ${jobA})`);
    await setMode('ALL_MONO');          // pack 2 becomes two mono pages: 0.20 + 2 x 0.05
    await priceJob(pool, jobA);
    expect(Number((await mps(jobA))[1]!.production_sell)).toBeCloseTo(0.3, 4);
    await setMode('FIRST_PACK_PAGE');   // pack 1: first page colour, then mono: 0.20 + 0.12 + 0.05
    await priceJob(pool, jobA);
    expect(Number((await mps(jobA))[0]!.production_sell)).toBeCloseTo(0.37, 4);
    await setMode('ORIGINAL');
    await priceJob(pool, jobA);
    expect(Number((await mps(jobA))[0]!.production_sell)).toBeCloseTo(0.3, 4);
    // a pack whose own option is Mono is billed as mono even though its pages arrived in colour: 0.20 + 2 x 0.05
    const mono = buildXml([{ ...person('Sam', 'Price'), colour: 'Mono' }]);
    await ingest(mono.xml, 'job-price-mono.xml', 'job-price-mono.pdf', { ref, pdf: new FakePdf(mono.pages, '', ['colour', 'colour']), repo });
    const jobM = await scalar(`SELECT job_id AS n FROM idoc.job WHERE base_name = N'job-price-mono'`);
    await priceJob(pool, jobM);
    expect(Number((await mps(jobM))[0]!.production_sell)).toBeCloseTo(0.3, 4);

    // the run sheet e-mail counts the blank the composer adds after an odd pack: a 3 page pack is printed as 4 (3 mono + 1 blank)
    const odd = buildXml([{ ...person('Olly', 'Price'), pages: 3 }, person('Pia', 'Price')]);
    await ingest(odd.xml, 'job-price-odd.xml', 'job-price-odd.pdf', { ref, pdf: new FakePdf(odd.pages, '', ['mono', 'mono', 'mono', 'mono', 'mono']), repo });
    const jobO = await scalar(`SELECT job_id AS n FROM idoc.job WHERE base_name = N'job-price-odd'`);
    const summary = await loadJobEmailSummary(pool, jobO);
    expect(summary).toMatchObject({ monoPages: 5, blankPages: 1 });
    expect(summary.batches.reduce((t, x) => t + x.pages, 0)).toBe(6);
    // and the run sheet PDF shows the same total
    expect((await loadRunSheetInputs(pool, jobO)).reduce((t, i) => t + i.pages, 0)).toBe(6);

    // XML first: nothing is priced until the PDF arrives
    const b = buildXml([person('Rae', 'Price')]);
    await ingest(b.xml, 'job-price-b.xml', null, { ref, pdf: new FakePdf(0), repo });
    const jobB = await scalar(`SELECT job_id AS n FROM idoc.job WHERE base_name = N'job-price-b'`);
    expect((await mps(jobB)).every((m) => m.priced_at === null)).toBe(true);
    const found = await repo.findAwaitingPdf('job-price-b');
    await repo.markPdfReceived(jobB, b.pages, found!.packs.map((k) => ({ guid: k.guid, colour: 0, mono: 2, blank: 0 })));
    expect((await mps(jobB)).every((m) => m.priced_at !== null && Number(m.production_sell) > 0)).toBe(true);

    // a pack whose colours are unknown is not priced
    const c = buildXml([person('Sam', 'Price')]);
    await ingest(c.xml, 'job-price-c.xml', null, { ref, pdf: new FakePdf(0), repo });
    const jobC = await scalar(`SELECT job_id AS n FROM idoc.job WHERE base_name = N'job-price-c'`);
    expect(await priceJob(pool, jobC)).toEqual({ priced: 0, noModel: 0, unknownColours: 1 });

    // the small batch limit is a Setting: the adjustment is on a batch of fewer mailpieces than it, and 0 turns it off
    await pool.request().query(`INSERT INTO idoc.costing_model_rate (costing_model_id, charge_code, cost, sell_price, adjustment) VALUES (${m1}, N'HAND_SMALL_BATCH_ADJUSTMENT', 0, 0.5, 0)`);
    const smallLines = async (limit: number): Promise<number> => {
      await pool.request().query(`UPDATE idoc.settings SET small_batch_limit = ${limit} WHERE settings_id = 1`);
      await priceJob(pool, jobA);
      return scalar(`SELECT COUNT(*) AS n FROM idoc.mailpiece_price_line l JOIN idoc.mailpiece m ON m.mailpiece_id = l.mailpiece_id WHERE m.job_id = ${jobA} AND l.charge_code = N'HAND_SMALL_BATCH_ADJUSTMENT'`);
    };
    try {
      expect(await smallLines(0)).toBe(0);
      expect(await smallLines(1000)).toBe(2);
    } finally { await pool.request().query('UPDATE idoc.settings SET small_batch_limit = 20 WHERE settings_id = 1'); }
  });

  it('re-price: fills in unpriced mail for a customer and date range, and overwrites only when asked', async () => {
    const ref = await loadReferenceData(pool);
    const d = buildXml([person('Una', 'Reprice'), person('Vic', 'Reprice')]);
    await ingest(d.xml, 'job-reprice-d.xml', 'job-reprice-d.pdf', { ref, pdf: new FakePdf(d.pages, '', ['mono', 'mono', 'mono', 'mono']), repo });
    const jobD = await scalar(`SELECT job_id AS n FROM idoc.job WHERE base_name = N'job-reprice-d'`);
    const customer = await scalar(`SELECT account_id AS n FROM idoc.job WHERE job_id = ${jobD}`);
    const re = new Repricer(process.env['INTELLIDOC_TEST_DB']!);
    // earlier tests left mail of this customer unpriced: clear that first, so only job D is left to fill in
    await re.run({ accountId: customer, from: null, to: null, overwrite: false });
    // as if job D had been ingested before any model existed
    await pool.request().query(`DELETE FROM idoc.mailpiece_price_line WHERE mailpiece_id IN (SELECT mailpiece_id FROM idoc.mailpiece WHERE job_id = ${jobD});
      UPDATE idoc.mailpiece SET costing_model_id = NULL, production_cost = NULL, production_sell = NULL, postage_cost = NULL, postage_sell = NULL, priced_at = NULL WHERE job_id = ${jobD}`);
    try {
      const all = { accountId: customer, from: null, to: null, overwrite: false };
      const before = await re.preview(all);
      expect(before.wouldPrice).toBe(2);
      expect(before.inScope).toBeGreaterThanOrEqual(2);
      // a date range that excludes today finds nothing
      expect(await re.preview({ ...all, to: '2000-01-01' })).toMatchObject({ inScope: 0, wouldPrice: 0 });
      // a preview writes nothing
      expect(await scalar(`SELECT COUNT(*) AS n FROM idoc.mailpiece WHERE job_id = ${jobD} AND priced_at IS NOT NULL`)).toBe(0);
      expect(await re.run(all)).toMatchObject({ priced: before.wouldPrice });
      expect(await scalar(`SELECT COUNT(*) AS n FROM idoc.mailpiece WHERE job_id = ${jobD} AND priced_at IS NOT NULL`)).toBe(2);
      // nothing left to fill in, but the overwrite option covers the priced mail too
      expect((await re.preview(all)).wouldPrice).toBe(0);
      const over = await re.preview({ ...all, overwrite: true });
      expect(over.wouldPrice).toBe(over.alreadyPriced);
      // a corrected model changes the price only when overwriting
      await pool.request().query(`UPDATE r SET sell_price = 1 FROM idoc.costing_model_rate AS r WHERE r.charge_code = N'HPOD'`);
      await re.run(all);
      expect(await scalar(`SELECT COUNT(*) AS n FROM idoc.mailpiece WHERE job_id = ${jobD} AND production_sell > 1`)).toBe(0);
      await re.run({ ...all, overwrite: true });
      expect(await scalar(`SELECT COUNT(*) AS n FROM idoc.mailpiece WHERE job_id = ${jobD} AND production_sell > 1`)).toBe(2);
    } finally { await re.close(); }
  });

  it('a dated price change: envelope settings follow the row that prices their band today', async () => {
    const before = await loadReferenceData(pool);
    const option = [...before.accounts.values()].flatMap((a) => a.envelopes).find((e) => e.postalRateId !== undefined)!;
    const oldId = option.postalRateId!;
    await pool.request().query(`UPDATE idoc.postal_rate SET valid_to = DATEADD(DAY, -1, CAST(SYSUTCDATETIME() AS DATE)) WHERE postal_rate_id = ${oldId}`);
    const newId = await scalar(`
      INSERT INTO idoc.postal_rate (postal_service_id, min_weight_g, max_weight_g, valid_from, cost, sell_price) OUTPUT INSERTED.postal_rate_id AS n
      SELECT postal_service_id, min_weight_g, max_weight_g, CAST(SYSUTCDATETIME() AS DATE), 1.5, 2 FROM idoc.postal_rate WHERE postal_rate_id = ${oldId}`);
    try {
      const after = await loadReferenceData(pool);
      const same = [...after.accounts.values()].flatMap((a) => a.envelopes).find((e) => e.accountEnvelopeId === option.accountEnvelopeId)!;
      expect(same.postalRateId).toBe(newId); // the setting still points at the old row, but the new row is the one in force
      expect(same).toMatchObject({ minWeightG: option.minWeightG, maxWeightG: option.maxWeightG, postalServiceId: option.postalServiceId });
    } finally {
      await pool.request().query(`DELETE FROM idoc.postal_rate WHERE postal_rate_id = ${newId}; UPDATE idoc.postal_rate SET valid_to = NULL WHERE postal_rate_id = ${oldId}`);
    }
  });

  it('page colours: stored on the packs at ingest, and after the PDF arrives on the XML-first path', async () => {
    const ref = await loadReferenceData(pool);
    const rows = async (job: string) => (await pool.request().query(
      `SELECT p.start_page, p.colour_pages, p.mono_pages, p.blank_pages FROM idoc.pack p JOIN idoc.job j ON j.job_id = p.job_id WHERE j.base_name = N'${job}' ORDER BY p.start_page`)).recordset;
    // XML and PDF together
    const a = buildXml([person('Ivy', 'Ink'), person('Jon', 'Ink')]);
    await ingest(a.xml, 'job-ink-a.xml', 'job-ink-a.pdf', { ref, pdf: new FakePdf(a.pages, '', ['colour', 'mono', 'blank', 'blank']), repo });
    expect(await rows('job-ink-a')).toMatchObject([{ colour_pages: 1, mono_pages: 1, blank_pages: 0 }, { colour_pages: 0, mono_pages: 0, blank_pages: 2 }]);
    // XML first: no counts until the PDF is attached
    const b = buildXml([person('Kay', 'Ink'), person('Lee', 'Ink')]);
    await ingest(b.xml, 'job-ink-b.xml', null, { ref, pdf: new FakePdf(0), repo });
    expect(await rows('job-ink-b')).toMatchObject([{ colour_pages: null, mono_pages: null, blank_pages: null }, { colour_pages: null }]);
    const found = await repo.findAwaitingPdf('job-ink-b');
    const ink = found!.packs.map((k, i) => ({ guid: k.guid, colour: i === 0 ? 2 : 0, mono: i === 0 ? 0 : 1, blank: i === 0 ? 0 : 1 }));
    await repo.markPdfReceived(found!.jobId, b.pages, ink);
    expect(await rows('job-ink-b')).toMatchObject([{ colour_pages: 2, mono_pages: 0, blank_pages: 0 }, { colour_pages: 0, mono_pages: 1, blank_pages: 1 }]);
  });

  it('reads the alert settings, with their defaults, from idoc.settings', async () => {
    expect(await loadAlertSettings(pool)).toEqual({ xmlFirst: true, pdfWaitMinutes: 30, pdfReminderMinutes: 30, alertTo: [], activityKeepDays: 7 });
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

  it('run sheet inputs list the inserts linked to an insert used, at the parent\'s quantity', async () => {
    await load([person('Li', 'Nk', { inserts: ['INSERT-PARENT'] })], 'job-linked.xml');
    const jobId = await scalar(`SELECT job_id AS n FROM idoc.job WHERE base_name = N'job-linked'`);
    const inputs = await loadRunSheetInputs(pool, jobId);
    expect(inputs[0]!.inserts.map((i) => i.code)).toEqual(['INSERT-CHILD', 'INSERT-PARENT']);
    const qty = new Map(inputs[0]!.inserts.map((i) => [i.code, i.quantity]));
    expect(qty.get('INSERT-CHILD')).toBe(qty.get('INSERT-PARENT'));
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
