import { createHash } from 'node:crypto';
import sql from 'mssql';
import type { AwaitingJob, OverdueJob, PdfTracker, Repository } from '../repository.js';
import type { Batch, IngestPack, IngestResult, Mailpiece } from '../types.js';

export class DuplicatePackError extends Error {}
export class JobAlreadyExistsError extends Error {}
export class ReferenceError_ extends Error {}

type Input = [name: string, type: sql.ISqlType | (() => sql.ISqlType), value: unknown];

class Db {
  constructor(private readonly tx: sql.Transaction) {}
  async rows<T>(text: string, inputs: Input[] = []): Promise<T[]> {
    const r = new sql.Request(this.tx);
    for (const [n, t, v] of inputs) r.input(n, t, v);
    return (await r.query(text)).recordset as T[];
  }
  async one<T>(text: string, inputs: Input[] = []): Promise<T | undefined> { return (await this.rows<T>(text, inputs))[0]; }
  async exec(text: string, inputs: Input[] = []): Promise<void> { await this.rows(text, inputs); }
}

const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');
const DEPT = { MACHINE: 'Machine enclosing', HAND: 'Hand enclosing', RECEPTION: 'Reception' } as const;

/** Cache of get-or-create lookups so each distinct dictionary value costs one round trip per job. */
class Dict {
  private m = new Map<string, number | bigint>();
  async get<T extends number | bigint>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.m.get(key);
    if (hit !== undefined) return hit as T;
    const v = await load();
    this.m.set(key, v);
    return v;
  }
}

/**
 * Persists an IngestResult into the idoc.* schema in ONE transaction (all rows or none).
 * The one-recipient-per-envelope rule is enforced again by the database (fk_pack_mailpiece_same_recipient).
 */
export class MssqlRepository implements Repository, PdfTracker {
  constructor(private readonly pool: sql.ConnectionPool) {}

  async packExists(guid: string): Promise<boolean> {
    const r = await this.pool.request().input('g', sql.UniqueIdentifier, guid).query('SELECT 1 AS x FROM idoc.pack WHERE pack_guid = @g');
    return r.recordset.length > 0;
  }

  // ---- PDF tracking (XML-first import)
  async findAwaitingPdf(baseName: string): Promise<AwaitingJob | null> {
    const rows = (await this.pool.request().input('b', sql.NVarChar(260), baseName).query<{ job_id: number; xml_file_name: string; customer: string; pdf_alert_count: number }>(`
      SELECT TOP 1 j.job_id, j.xml_file_name, c.name AS customer, j.pdf_alert_count
      FROM idoc.job AS j INNER JOIN idoc.account AS c ON c.account_id = j.account_id
      WHERE j.status = N'Awaiting PDF' AND LOWER(j.base_name) = LOWER(@b) ORDER BY j.job_id DESC`)).recordset;
    const j = rows[0];
    if (!j) return null;
    const packs = (await this.pool.request().input('j', sql.BigInt, j.job_id).query<{ pack_guid: string; start_page: number; end_page: number; page_count: number }>(
      'SELECT CAST(pack_guid AS NVARCHAR(36)) AS pack_guid, start_page, end_page, page_count FROM idoc.pack WHERE job_id = @j')).recordset;
    return { jobId: j.job_id, xmlName: j.xml_file_name, customerName: j.customer, alertCount: j.pdf_alert_count,
      packs: packs.map((p) => ({ guid: p.pack_guid, startPage: p.start_page, endPage: p.end_page, pageCount: p.page_count })) };
  }

  async markPdfReceived(jobId: number, pdfPages: number): Promise<{ alertCount: number }> {
    const r = await this.pool.request().input('j', sql.BigInt, jobId).input('pg', sql.Int, pdfPages).query<{ pdf_alert_count: number }>(`
      UPDATE idoc.job SET status = N'Received', pdf_received_at = SYSUTCDATETIME(), page_count = @pg, pdf_error = NULL
      OUTPUT INSERTED.pdf_alert_count WHERE job_id = @j AND status = N'Awaiting PDF'`);
    return { alertCount: r.recordset[0]?.pdf_alert_count ?? 0 };
  }

  async markPdfRejected(jobId: number, message: string): Promise<void> {
    await this.pool.request().input('j', sql.BigInt, jobId).input('m', sql.NVarChar(2000), message.slice(0, 2000))
      .query(`UPDATE idoc.job SET status = N'PDF Rejected', pdf_error = @m WHERE job_id = @j AND status = N'Awaiting PDF'`);
  }

  async listOverdue(waitMinutes: number, reminderMinutes: number): Promise<OverdueJob[]> {
    const rows = (await this.pool.request().input('w', sql.Int, waitMinutes).input('r', sql.Int, reminderMinutes).query<{
      job_id: number; base_name: string; xml_file_name: string; customer: string; pack_count: number; page_count: number; export_date: Date; waiting: number; pdf_alert_count: number;
    }>(`
      SELECT j.job_id, j.base_name, j.xml_file_name, c.name AS customer, j.pack_count, j.page_count, j.export_date,
             DATEDIFF(MINUTE, j.export_date, SYSUTCDATETIME()) AS waiting, j.pdf_alert_count
      FROM idoc.job AS j INNER JOIN idoc.account AS c ON c.account_id = j.account_id
      WHERE j.status = N'Awaiting PDF'
        AND j.export_date <= DATEADD(MINUTE, -@w, SYSUTCDATETIME())
        AND (j.pdf_last_alert_at IS NULL OR j.pdf_last_alert_at <= DATEADD(MINUTE, -@r, SYSUTCDATETIME()))
      ORDER BY j.export_date`)).recordset;
    return rows.map((j) => ({ jobId: j.job_id, baseName: j.base_name, xmlName: j.xml_file_name, customerName: j.customer, packCount: j.pack_count ?? 0,
      expectedPages: j.page_count ?? 0, receivedAt: j.export_date, minutesWaiting: j.waiting, alertCount: j.pdf_alert_count }));
  }

  async markAlerted(jobId: number): Promise<void> {
    await this.pool.request().input('j', sql.BigInt, jobId)
      .query('UPDATE idoc.job SET pdf_last_alert_at = SYSUTCDATETIME(), pdf_alert_count = pdf_alert_count + 1 WHERE job_id = @j');
  }

  async saveJob(result: IngestResult): Promise<void> {
    if (result.packs.length === 0) throw new Error('Nothing to save');
    const tx = new sql.Transaction(this.pool);
    await tx.begin();
    try {
      await this.save(new Db(tx), result);
      await tx.commit();
    } catch (e) {
      try { await tx.rollback(); } catch { /* already rolled back by the server */ }
      const msg = e instanceof Error ? e.message : String(e);
      if (/uq_pack_guid/i.test(msg)) throw new DuplicatePackError(msg);
      if (/uq_job_base/i.test(msg)) throw new JobAlreadyExistsError(msg);
      throw e;
    }
  }

  private async save(db: Db, r: IngestResult): Promise<void> {
    const d = { acct: new Dict(), key: new Dict(), val: new Dict(), idt: new Dict(), stock: new Dict(), src: new Dict(),
      addr: new Dict(), opt: new Dict(), paper: new Dict(), brand: new Dict(), fmt: new Dict(), svc: new Dict() };

    // ---- accounts (customer = the account that holds the settings; submitting account kept on the pack)
    const accountId = (code: string): Promise<number> => d.acct.get(code, async () => {
      const a = await db.one<{ account_id: number }>('SELECT account_id FROM idoc.account WHERE account_code = @c AND is_deleted = 0', [['c', sql.NVarChar(100), code]]);
      if (!a) throw new ReferenceError_(`Unknown account ${code}`);
      return a.account_id;
    });
    const customerCodes = new Set(r.packs.map((p) => p.customerCode));
    if (customerCodes.size !== 1) throw new ReferenceError_(`A job must belong to one customer; found ${[...customerCodes].join(', ')}`);
    const customerCode = r.packs[0]!.customerCode;
    const customerId = await accountId(customerCode);

    // ---- job
    const baseName = r.xmlName.replace(/\.xml$/i, '');
    const job = (await db.one<{ job_id: number }>(`
      INSERT INTO idoc.job (account_id, base_name, xml_file_name, pdf_file_name, export_date, status, pack_count, page_count)
      OUTPUT INSERTED.job_id
      VALUES (@a, @b, @x, @p, SYSUTCDATETIME(), @status, @pc, @pg)`, [
      ['a', sql.Int, customerId], ['b', sql.NVarChar(260), baseName], ['x', sql.NVarChar(260), r.xmlName],
      ['p', sql.NVarChar(260), r.pdfName], ['pc', sql.Int, r.packs.length], ['pg', sql.Int, r.pdfPages], ['status', sql.NVarChar(30), r.pdfReceived ? 'Received' : 'Awaiting PDF']]))!;
    const jobId = job.job_id;

    // ---- dictionaries
    const stockId = (code: string): Promise<number> => d.stock.get(code, async () => {
      const s = await db.one<{ stock_item_id: number }>('SELECT stock_item_id FROM idoc.stock_item WHERE stock_code = @c', [['c', sql.NVarChar(50), code]]);
      if (!s) throw new ReferenceError_(`Unknown stock code ${code}`);
      return s.stock_item_id;
    });
    const keyId = (n: string): Promise<number> => d.key.get(n, async () => (await db.one<{ id: number }>(`
      DECLARE @id INT;
      SELECT @id = passthrough_key_id FROM idoc.passthrough_key WITH (UPDLOCK, HOLDLOCK) WHERE name = @n;
      IF @id IS NULL BEGIN INSERT INTO idoc.passthrough_key (name) VALUES (@n); SET @id = SCOPE_IDENTITY(); END
      SELECT @id AS id;`, [['n', sql.NVarChar(100), n]]))!.id);
    const valueId = (v: string): Promise<bigint | number> => d.val.get(v, async () => (await db.one<{ id: number }>(`
      DECLARE @id BIGINT;
      SELECT @id = passthrough_value_id FROM idoc.passthrough_value WITH (UPDLOCK, HOLDLOCK) WHERE value = @v;
      IF @id IS NULL BEGIN INSERT INTO idoc.passthrough_value (value) VALUES (@v); SET @id = SCOPE_IDENTITY(); END
      SELECT @id AS id;`, [['v', sql.NVarChar(400), v]]))!.id);
    const identTypeId = (n: string): Promise<number> => d.idt.get(n, async () => (await db.one<{ id: number }>(`
      DECLARE @id INT;
      SELECT @id = identifier_type_id FROM idoc.identifier_type WITH (UPDLOCK, HOLDLOCK) WHERE name = @n;
      IF @id IS NULL BEGIN INSERT INTO idoc.identifier_type (name) VALUES (@n); SET @id = SCOPE_IDENTITY(); END
      SELECT @id AS id;`, [['n', sql.NVarChar(200), n]]))!.id);
    // Paper and brand arrive in the XML, so unknown values are created (paper batch_name defaults to the upper-cased name).
    const paperId = (name: string): Promise<number> => d.paper.get(name, async () => (await db.one<{ id: number }>(`
      DECLARE @id INT;
      SELECT @id = paper_id FROM idoc.paper WITH (UPDLOCK, HOLDLOCK) WHERE name = @n;
      IF @id IS NULL BEGIN INSERT INTO idoc.paper (name, batch_name) VALUES (@n, UPPER(@n)); SET @id = SCOPE_IDENTITY(); END
      SELECT @id AS id;`, [['n', sql.NVarChar(100), name]]))!.id);
    const brandId = (name: string | null): Promise<number | null> => name === null ? Promise.resolve(null) : d.brand.get(name, async () => (await db.one<{ id: number }>(`
      DECLARE @id INT;
      SELECT @id = brand_id FROM idoc.brand WITH (UPDLOCK, HOLDLOCK) WHERE account_id = @a AND name = @n;
      IF @id IS NULL BEGIN INSERT INTO idoc.brand (account_id, name) VALUES (@a, @n); SET @id = SCOPE_IDENTITY(); END
      SELECT @id AS id;`, [['a', sql.Int, customerId], ['n', sql.NVarChar(200), name]]))!.id) as Promise<number>;
    const formatId = (name: string): Promise<number> => d.fmt.get(name, async () => {
      const f = await db.one<{ postal_format_id: number }>('SELECT postal_format_id FROM idoc.postal_format WHERE name = @n', [['n', sql.NVarChar(50), name]]);
      if (!f) throw new ReferenceError_(`Unknown postal format ${name}`);
      return f.postal_format_id;
    });
    const serviceId = (name: string, format: string, known?: number): Promise<number> => known !== undefined ? Promise.resolve(known) : d.svc.get(`${format}|${name}`, async () => {
      const rows = await db.rows<{ postal_service_id: number }>(
        'SELECT postal_service_id FROM idoc.postal_service WHERE name = @n AND postal_format_id = (SELECT postal_format_id FROM idoc.postal_format WHERE name = @f)',
        [['n', sql.NVarChar(100), name], ['f', sql.NVarChar(50), format]]);
      if (rows.length !== 1) throw new ReferenceError_(`Postal service "${name}" for ${format}: ${rows.length === 0 ? 'not found' : 'ambiguous (several providers)'}`);
      return rows[0]!.postal_service_id;
    });

    // ---- source / address / option set
    const sourceId = (p: IngestPack): Promise<bigint | number> => d.src.get(p.parsed.source.guid, async () => (await db.one<{ id: number }>(`
      DECLARE @id BIGINT;
      SELECT @id = source_id FROM idoc.source WITH (UPDLOCK, HOLDLOCK) WHERE source_guid = @g;
      IF @id IS NULL BEGIN INSERT INTO idoc.source (source_guid, owner_account, owner_user) VALUES (@g, @oa, @ou); SET @id = SCOPE_IDENTITY(); END
      SELECT @id AS id;`, [['g', sql.UniqueIdentifier, p.parsed.source.guid], ['oa', sql.NVarChar(100), p.parsed.source.ownerAccount], ['ou', sql.NVarChar(300), p.parsed.source.ownerUser]]))!.id);
    const addressId = (p: IngestPack): Promise<bigint | number> => d.addr.get(p.address.hash, async () => {
      const a = (await db.one<{ id: number; created: boolean }>(`
        DECLARE @id BIGINT, @created BIT = 0;
        SELECT @id = address_id FROM idoc.address WITH (UPDLOCK, HOLDLOCK) WHERE address_hash = @h;
        IF @id IS NULL BEGIN
          INSERT INTO idoc.address (address_hash, postcode, country_code) VALUES (@h, @pc, @cc);
          SET @id = SCOPE_IDENTITY(); SET @created = 1;
        END ELSE UPDATE idoc.address SET last_used = SYSUTCDATETIME() WHERE address_id = @id;
        SELECT @id AS id, @created AS created;`, [
        ['h', sql.Char(64), p.address.hash], ['pc', sql.NVarChar(12), p.address.postcode], ['cc', sql.NChar(2), p.address.country.toUpperCase().slice(0, 2) || null]]))!;
      if (a.created) {
        for (const [i, text] of p.address.lines.entries()) {
          await db.exec('INSERT INTO idoc.address_line (address_id, line_no, text) VALUES (@a, @n, @t)', [['a', sql.BigInt, a.id], ['n', sql.TinyInt, i + 1], ['t', sql.NVarChar(200), text]]);
        }
      }
      return a.id;
    });
    const optionSetId = (p: IngestPack): Promise<number> => {
      const o = p.parsed.options;
      return d.opt.get(JSON.stringify(o), async () => {
        const pid = await paperId(o.paper);
        return (await db.one<{ id: number }>(`
          DECLARE @id INT;
          SELECT @id = option_set_id FROM idoc.option_set WITH (UPDLOCK, HOLDLOCK)
           WHERE colour = @c AND delivery_method = @dm AND delivery_band = @db AND envelope_value = @ev
             AND ((envelope_code = @ec) OR (envelope_code IS NULL AND @ec IS NULL)) AND is_duplex = @du AND paper_id = @p;
          IF @id IS NULL BEGIN
            INSERT INTO idoc.option_set (colour, delivery_method, delivery_band, envelope_value, envelope_code, is_duplex, paper_id)
            VALUES (@c, @dm, @db, @ev, @ec, @du, @p);
            SET @id = SCOPE_IDENTITY();
          END
          SELECT @id AS id;`, [
          ['c', sql.NVarChar(30), o.colour], ['dm', sql.NVarChar(50), o.deliveryMethod], ['db', sql.NVarChar(100), o.deliveryBand],
          ['ev', sql.NVarChar(200), o.envelopeValue], ['ec', sql.NVarChar(50), o.envelopeCode || null], ['du', sql.Bit, o.duplex], ['p', sql.Int, pid]]))!.id;
      });
    };

    // ---- batches
    const batchDbId = new Map<string, number>(); // batch key -> batch_id
    for (const b of r.batches) batchDbId.set(b.key, await this.insertBatch(db, jobId, customerId, b, { accountId, brandId, stockId, formatId, serviceId, paperId }));

    // ---- mailpieces (before packs: packs reference them through the same-recipient FK)
    const mpDbId = new Map<number, number>();
    for (const m of r.mailpieces) {
      const first = m.packs[0]!;
      const batch = r.batches.find((b) => b.key === m.batchKey)!;
      const row = (await db.one<{ id: number }>(`
        INSERT INTO idoc.mailpiece (job_id, account_id, invoicing_account_id, address_id, batch_id, brand_id, account_envelope_id, postal_format_id, postal_rate_id,
                                    delivery_band, pack_count, page_count, sheet_count, weight_g, thickness_mm, enclosing_route, match_key)
        OUTPUT INSERTED.mailpiece_id AS id
        VALUES (@job, @acct, @inv, @addr, @batch, @brand, @ae, @fmt, @rate, @band, @pc, @pg, @sh, @w, @t, @route, @mk)`, [
        ['job', sql.BigInt, jobId], ['acct', sql.Int, customerId], ['inv', sql.Int, await accountId(m.invoicingCode)], ['addr', sql.BigInt, await addressId(first)], ['batch', sql.BigInt, batchDbId.get(batch.key)],
        ['brand', sql.Int, await brandId(m.brand)], ['ae', sql.Int, m.accountEnvelopeId ?? null], ['fmt', sql.Int, await formatId(m.postalFormat)],
        ['rate', sql.Int, m.postalRateId ?? null], ['band', sql.NVarChar(50), m.postalService],
        ['pc', sql.Int, m.packs.length], ['pg', sql.Int, m.packs.reduce((n, p) => n + p.parsed.pageCount, 0)], ['sh', sql.Int, m.sheets],
        ['w', sql.Int, m.weightG], ['t', sql.Decimal(6, 2), m.thicknessMm], ['route', sql.NVarChar(20), m.route], ['mk', sql.Char(64), sha(m.packs.map((p) => p.matchKey).join('|'))]]))!;
      mpDbId.set(m.id, row.id);
    }

    // ---- packs and their children
    for (const m of r.mailpieces) {
      for (const p of m.packs) {
        const x = p.parsed;
        const row = (await db.one<{ id: number }>(`
          INSERT INTO idoc.pack (pack_guid, job_id, account_id, submitting_account_id, source_id, address_id, option_set_id, brand_id, mailpiece_id,
                                 recipient_first_name, recipient_surname, page_count, start_page, end_page, sheet_count, status,
                                 delivery_point_suffix, attachment_count, release_date, document_sequence, batching_reference,
                                 is_match_excluded, match_exclusion_reason, match_key)
          OUTPUT INSERTED.pack_id AS id
          VALUES (@g, @job, @acct, @sub, @src, @addr, @opt, @brand, @mp, @fn, @sn, @pg, @sp, @ep, @sh, @st, @dps, @att, COALESCE(@rd, SYSUTCDATETIME()), @seq, @bref, @ex, @exr, @mk)`, [
          ['g', sql.UniqueIdentifier, x.guid], ['job', sql.BigInt, jobId], ['acct', sql.Int, customerId], ['sub', sql.Int, await accountId(p.accountCode)],
          ['src', sql.BigInt, await sourceId(p)], ['addr', sql.BigInt, await addressId(p)], ['opt', sql.Int, await optionSetId(p)], ['brand', sql.Int, await brandId(p.brand)],
          ['mp', sql.BigInt, mpDbId.get(m.id)], ['fn', sql.NVarChar(100), x.address.firstName || null], ['sn', sql.NVarChar(100), x.address.surname || null],
          ['pg', sql.Int, x.pageCount], ['sp', sql.Int, x.startPage], ['ep', sql.Int, x.endPage], ['sh', sql.Int, p.sheets], ['st', sql.NVarChar(30), x.status],
          ['dps', sql.NVarChar(10), x.deliveryPointSuffix || null], ['att', sql.Int, x.attachmentCount], ['rd', sql.DateTime2(0), x.releaseDate ? new Date(x.releaseDate) : null],
          ['seq', sql.Int, p.documentSequence], ['bref', sql.NVarChar(400), p.batchingValue || null],
          ['ex', sql.Bit, p.matchExclusion !== null], ['exr', sql.NVarChar(50), p.matchExclusion], ['mk', sql.Char(64), p.matchKey]]))!;
        const packId = row.id;
        for (const [k, v] of Object.entries(x.passthrough)) {
          await db.exec('INSERT INTO idoc.pack_passthrough (pack_id, passthrough_key_id, passthrough_value_id) VALUES (@p, @k, @v)',
            [['p', sql.BigInt, packId], ['k', sql.Int, await keyId(k)], ['v', sql.BigInt, await valueId(v)]]);
        }
        const seen = new Set<string>();
        for (const i of x.identifiers) {
          const k = `${i.type}\u0000${i.value}`;
          if (seen.has(k)) continue;
          seen.add(k);
          await db.exec('INSERT INTO idoc.pack_identifier (pack_id, identifier_type_id, value) VALUES (@p, @t, @v)',
            [['p', sql.BigInt, packId], ['t', sql.Int, await identTypeId(i.type)], ['v', sql.NVarChar(200), i.value]]);
        }
        const ins = new Map<string, { qty: number; date: string }>();
        for (const i of x.inserts) { const e = ins.get(i.code); if (e) e.qty++; else ins.set(i.code, { qty: 1, date: i.publicationDate }); }
        for (const [code, v] of ins) {
          await db.exec('INSERT INTO idoc.pack_insert (pack_id, stock_item_id, quantity, publication_date) VALUES (@p, @s, @q, @d)',
            [['p', sql.BigInt, packId], ['s', sql.Int, await stockId(code)], ['q', sql.Int, v.qty], ['d', sql.NVarChar(30), v.date || null]]);
        }
      }
    }
  }

  private async insertBatch(db: Db, jobId: number, customerId: number, b: Batch, h: {
    accountId: (code: string) => Promise<number>; brandId: (n: string | null) => Promise<number | null>; stockId: (c: string) => Promise<number>;
    formatId: (n: string) => Promise<number>; serviceId: (n: string, f: string, known?: number) => Promise<number>; paperId: (n: string) => Promise<number>;
  }): Promise<number> {
    const insertIds = await Promise.all(b.inserts.map(async (i) => ({ id: await h.stockId(i.code), quantity: i.quantity })));
    const insertSetHash = sha(insertIds.length ? insertIds.map((i) => `${i.id}x${i.quantity}`).sort().join(',') : 'NO INSERTS');
    const row = (await db.one<{ id: number }>(`
      INSERT INTO idoc.batch (job_id, account_id, invoicing_account_id, brand_id, outer_stock_item_id, postal_service_id, postal_format_id, paper_id, batching_value,
                              enclosing_route, insert_set_hash, batch_key, fulfilment_department, mailpiece_count)
      OUTPUT INSERTED.batch_id AS id
      VALUES (@job, @acct, @inv, @brand, @env, @svc, @fmt, @paper, @bv, @route, @ish, @key, @dept, @n)`, [
      ['job', sql.BigInt, jobId], ['acct', sql.Int, customerId], ['inv', sql.Int, await h.accountId(b.invoicingCode)], ['brand', sql.Int, await h.brandId(b.brand)], ['env', sql.Int, await h.stockId(b.envelopeCode)],
      ['svc', sql.Int, await h.serviceId(b.postalService, b.postalFormat, b.postalServiceId)], ['fmt', sql.Int, await h.formatId(b.postalFormat)],
      ['paper', sql.Int, await h.paperId(b.paper)], ['bv', sql.NVarChar(400), b.batchingValue], ['route', sql.NVarChar(20), b.route],
      ['ish', sql.Char(64), insertSetHash], ['key', sql.Char(64), b.key], ['dept', sql.NVarChar(30), DEPT[b.enclosing]], ['n', sql.Int, b.mailpieceIds.length]]))!;
    for (const i of insertIds) {
      await db.exec('INSERT INTO idoc.batch_insert (batch_id, stock_item_id, quantity) VALUES (@b, @s, @q)', [['b', sql.BigInt, row.id], ['s', sql.Int, i.id], ['q', sql.Int, i.quantity]]);
    }
    return row.id;
  }
}
