import sql from 'mssql';
import { NotFoundError } from '../errors.js';
import { TREE } from '../recipients/mssqlStore.js';
import type { AuditEvent, AuditMailpiece, AuditPack, AuditStore } from './types.js';

const UNLISTED = 99;
const utc = (col: string): string => `CONVERT(NVARCHAR(19), ${col}, 126) + N'Z'`;

/** The SQL behind the audit report: everything recorded about each chosen mailpiece, limited to the account searched and below. */
export class MssqlAuditStore implements AuditStore {
  constructor(private readonly pool: sql.ConnectionPool) {}

  async logReport(by: string, accountId: number, summary: string): Promise<void> {
    await this.pool.request().input('by', sql.NVarChar(200), by.slice(0, 200)).input('a', sql.BigInt, accountId).input('s', sql.NVarChar(1000), summary.slice(0, 1000))
      .query(`INSERT INTO idoc.audit_log (changed_by, entity, entity_id, summary) VALUES (@by, N'audit report', @a, @s)`);
  }

  async details(accountId: number, ids: number[]) {
    const label = ((await this.pool.request().input('a', sql.Int, accountId).query(`
      WITH t (account_id, label) AS (
        SELECT account_id, CAST(name AS NVARCHAR(1000)) FROM idoc.account WHERE parent_account_id IS NULL AND is_deleted = 0
        UNION ALL SELECT a.account_id, CAST(t.label + N' > ' + a.name AS NVARCHAR(1000)) FROM idoc.account a JOIN t ON a.parent_account_id = t.account_id WHERE a.is_deleted = 0)
      SELECT label FROM t WHERE account_id = @a`)).recordset[0] as { label: string } | undefined)?.label;
    if (label === undefined) throw new NotFoundError('That account does not exist.');
    const inList = (r: sql.Request, prefix: string, values: number[]): string => values.map((v, i) => { r.input(`${prefix}${i}`, sql.BigInt, v); return `@${prefix}${i}`; }).join(',');
    const any = (r: unknown) => (r ?? []) as Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any

    const r1 = this.pool.request().input('scope', sql.Int, accountId);
    const mps = any((await r1.query(`${TREE}
      SELECT m.mailpiece_id, m.is_cancelled, ${utc('m.created_at')} AS produced_at, ad.postcode, m.pack_count, m.page_count, m.sheet_count, m.weight_g, m.sequence_number,
             m.submitting_account_path, m.submitting_account_code, COALESCE(m.brand_name, br.name) AS brand, m.outer_stock_code,
             j.job_id, j.base_name, j.xml_file_name, j.pdf_file_name, ${utc('j.export_date')} AS job_received, CASE WHEN j.pdf_received_at IS NULL THEN NULL ELSE ${utc('j.pdf_received_at')} END AS pdf_received,
             b.batch_id, b.batch_code, b.current_status, ${utc('b.created_at')} AS batch_created, b.fulfilment_department,
             pp.name AS provider, ps.name AS service, pf.name AS format, ps.is_tracked
      FROM idoc.mailpiece m
      JOIN tree ON tree.account_id = m.submitting_account_id
      JOIN idoc.job j ON j.job_id = m.job_id
      JOIN idoc.address ad ON ad.address_id = m.address_id
      LEFT JOIN idoc.brand br ON br.brand_id = m.brand_id
      LEFT JOIN idoc.batch b ON b.batch_id = m.batch_id
      LEFT JOIN idoc.postal_service ps ON ps.postal_service_id = b.postal_service_id
      LEFT JOIN idoc.postal_provider pp ON pp.postal_provider_id = ps.postal_provider_id
      LEFT JOIN idoc.postal_format pf ON pf.postal_format_id = b.postal_format_id
      WHERE m.mailpiece_id IN (${inList(r1, 'm', ids)})`)).recordset);
    if (!mps.length) return { scopeLabel: label, rows: [] };
    const mpIds = mps.map((m) => Number(m['mailpiece_id']));
    const batchIds = [...new Set(mps.filter((m) => m['batch_id'] != null).map((m) => Number(m['batch_id'])))];

    const r2 = this.pool.request();
    const lines = new Map<number, string[]>();
    for (const l of any((await r2.query(`SELECT m.mailpiece_id, l.text FROM idoc.mailpiece m JOIN idoc.address_line l ON l.address_id = m.address_id
                                         WHERE m.mailpiece_id IN (${inList(r2, 'm', mpIds)}) ORDER BY m.mailpiece_id, l.line_no`)).recordset)) {
      const id = Number(l['mailpiece_id']); (lines.get(id) ?? lines.set(id, []).get(id)!).push(l['text']);
    }
    const r3 = this.pool.request();
    const refs = new Map<number, Record<string, string>>();
    for (const x of any((await r3.query(`SELECT pp.pack_id, k.name AS [key], v.value FROM idoc.pack p
                                         JOIN idoc.pack_passthrough pp ON pp.pack_id = p.pack_id
                                         JOIN idoc.passthrough_key k ON k.passthrough_key_id = pp.passthrough_key_id
                                         JOIN idoc.passthrough_value v ON v.passthrough_value_id = pp.passthrough_value_id
                                         WHERE p.mailpiece_id IN (${inList(r3, 'm', mpIds)}) ORDER BY pp.pack_id, k.name`)).recordset)) {
      const id = Number(x['pack_id']); (refs.get(id) ?? refs.set(id, {}).get(id)!)[x['key']] = x['value'];
    }
    const r4 = this.pool.request();
    const packs = new Map<number, AuditPack[]>();
    for (const k of any((await r4.query(`SELECT p.mailpiece_id, p.pack_id, LOWER(CONVERT(CHAR(36), p.pack_guid)) AS pack_guid, LOWER(CONVERT(CHAR(36), sc.source_guid)) AS job_guid,
                                                p.document_sequence, p.start_page, p.page_count, ${utc('p.release_date')} AS release_date, ${utc('p.created_at')} AS received_at, sc.owner_account, sc.owner_user
                                         FROM idoc.pack p JOIN idoc.source sc ON sc.source_id = p.source_id
                                         WHERE p.mailpiece_id IN (${inList(r4, 'm', mpIds)}) ORDER BY p.mailpiece_id, p.document_sequence, p.start_page, p.pack_id`)).recordset)) {
      const id = Number(k['mailpiece_id']); const list = packs.get(id) ?? packs.set(id, []).get(id)!;
      list.push({ packId: Number(k['pack_id']), packGuid: k['pack_guid'], jobGuid: k['job_guid'], position: list.length + 1, sequence: Number(k['document_sequence']) >= UNLISTED ? null : Number(k['document_sequence']),
        startPage: Number(k['start_page']), pageCount: Number(k['page_count']), releaseDate: k['release_date'], receivedAt: k['received_at'], references: refs.get(Number(k['pack_id'])) ?? {}, ownerAccount: k['owner_account'], ownerUser: k['owner_user'] });
    }
    const events = new Map<number, AuditEvent[]>(); const files = new Map<number, { segment: number; fileName: string; createdAt: string }[]>();
    if (batchIds.length) {
      const r5 = this.pool.request();
      for (const e of any((await r5.query(`SELECT batch_id, event_type, ${utc('occurred_at')} AS at, recorded_by, note FROM idoc.batch_event WHERE batch_id IN (${inList(r5, 'b', batchIds)}) ORDER BY batch_id, occurred_at, batch_event_id`)).recordset)) {
        const id = Number(e['batch_id']); (events.get(id) ?? events.set(id, []).get(id)!).push({ type: e['event_type'], at: e['at'], by: e['recorded_by'] ?? null, note: e['note'] ?? null });
      }
      const r6 = this.pool.request();
      for (const f of any((await r6.query(`SELECT batch_id, segment_number, file_name, ${utc('created_at')} AS created_at FROM idoc.batch_file WHERE batch_id IN (${inList(r6, 'b', batchIds)}) ORDER BY batch_id, segment_number`)).recordset)) {
        const id = Number(f['batch_id']); (files.get(id) ?? files.set(id, []).get(id)!).push({ segment: Number(f['segment_number']), fileName: f['file_name'], createdAt: f['created_at'] });
      }
    }
    const byId = new Map(mps.map((m) => [Number(m['mailpiece_id']), m]));
    const rows: AuditMailpiece[] = ids.filter((id) => byId.has(id)).map((id) => {
      const m = byId.get(id)!; const bid = m['batch_id'] == null ? null : Number(m['batch_id']);
      return {
        mailpieceId: id, addressLines: lines.get(id) ?? [], postcode: m['postcode'], isCancelled: Boolean(m['is_cancelled']), producedAt: m['produced_at'],
        job: { jobId: Number(m['job_id']), name: m['base_name'], xmlFile: m['xml_file_name'], pdfFile: m['pdf_file_name'], receivedAt: m['job_received'], pdfReceivedAt: m['pdf_received'] ?? null },
        batch: bid === null ? null : { batchCode: Number(m['batch_code']), status: m['current_status'], createdAt: m['batch_created'], department: m['fulfilment_department'], sequenceNumber: m['sequence_number'] == null ? null : Number(m['sequence_number']), events: events.get(bid) ?? [], files: files.get(bid) ?? [] },
        service: m['service'] == null ? null : { provider: m['provider'], name: m['service'], format: m['format'], tracked: Boolean(m['is_tracked']) },
        envelope: m['outer_stock_code'] ?? null, weightG: m['weight_g'] == null ? null : Number(m['weight_g']), pageCount: Number(m['page_count']), sheetCount: Number(m['sheet_count']),
        submittedBy: { path: m['submitting_account_path'], code: m['submitting_account_code'] }, brand: m['brand'] ?? null, packs: packs.get(id) ?? [],
      };
    });
    return { scopeLabel: label, rows };
  }
}
