import sql from 'mssql';
import { COLOUR_MODES, type ColourMode } from '../costing/colour.js';
import type { MarkSettings } from './marks.js';
import type { BatchPlan, PlanMailpiece } from './plan.js';
import type { ComposedFile } from './compose.js';

export interface ComposeSettings { autoCompose: boolean; maxPagesPerPdf: number; marks: MarkSettings }

export async function loadComposeSettings(pool: sql.ConnectionPool): Promise<ComposeSettings> {
  const r = (await pool.request().query<Record<string, number>>(`SELECT CAST(auto_compose AS INT) AS auto_compose, max_pages_per_pdf, mark_seq_font_pt, mark_seq_left_mm, mark_seq_top_mm, mark_seq_width_mm, mark_seq_height_mm,
      mark_dm_left_mm, mark_dm_top_mm, mark_dm_width_mm, mark_dm_height_mm, mark_dot_x_mm, mark_dot_y_mm, mark_dot_diameter_mm,
      mrdf_dm_left_mm, mrdf_dm_top_mm, mrdf_dm_width_mm, mrdf_dm_height_mm, mrdf_ocr_font_pt, mrdf_ocr_left_mm, mrdf_ocr_top_mm, mrdf_ocr_width_mm, mrdf_ocr_height_mm FROM idoc.settings WHERE settings_id = 1`)).recordset[0];
  if (!r) throw new Error('idoc.settings has no row');
  const n = (k: string): number => Number(r[k]);
  return {
    autoCompose: n('auto_compose') === 1, maxPagesPerPdf: n('max_pages_per_pdf'),
    marks: {
      seq: { fontPt: n('mark_seq_font_pt'), leftMm: n('mark_seq_left_mm'), topMm: n('mark_seq_top_mm'), widthMm: n('mark_seq_width_mm'), heightMm: n('mark_seq_height_mm') },
      dm: { leftMm: n('mark_dm_left_mm'), topMm: n('mark_dm_top_mm'), widthMm: n('mark_dm_width_mm'), heightMm: n('mark_dm_height_mm') },
      dot: { xMm: n('mark_dot_x_mm'), yMm: n('mark_dot_y_mm'), diameterMm: n('mark_dot_diameter_mm') },
      mrdf: {
        dm: { leftMm: n('mrdf_dm_left_mm'), topMm: n('mrdf_dm_top_mm'), widthMm: n('mrdf_dm_width_mm'), heightMm: n('mrdf_dm_height_mm') },
        ocr: { fontPt: n('mrdf_ocr_font_pt'), leftMm: n('mrdf_ocr_left_mm'), topMm: n('mrdf_ocr_top_mm'), widthMm: n('mrdf_ocr_width_mm'), heightMm: n('mrdf_ocr_height_mm') },
      },
    },
  };
}

export interface JobToCompose { jobId: number; status: string; pdfFileName: string; batches: BatchToCompose[] }
export interface BatchToCompose {
  batchId: number; batchCode: number; status: string; paperName: string | null; mailpieces: PlanMailpiece[];
  /** The customer's MRDF details; null when the customer does not use MRDF. */
  mrdf: { accountCode: string; returnAddress: string[]; logo1: string | null; logo2: string | null } | null;
  /** The customer's archive tags; null when the customer does not archive mailpieces. */
  archive: { customerTag: string | null; providerTag: string | null; directoryTag: string | null } | null;
}

/** Reads the job, its batches and, for each, the mailpieces and packs the planner needs. Read-only. */
export async function loadJobToCompose(pool: sql.ConnectionPool, jobId: number): Promise<JobToCompose> {
  const job = (await pool.request().input('j', sql.BigInt, jobId).query<{ status: string; pdf_file_name: string }>('SELECT status, pdf_file_name FROM idoc.job WHERE job_id = @j')).recordset[0];
  if (!job) throw new Error(`Job ${jobId} does not exist`);
  // The customer (the owner of the account tree the batch belongs to) holds the MRDF switch, account code and return address
  const batches = (await pool.request().input('j', sql.BigInt, jobId).query<{ batch_id: number; batch_code: number; current_status: string; paper_name: string | null; use_mrdf: boolean; account_code: string; return_address: string | null; logo1: string | null; logo2: string | null; archive: boolean; archive_customer_tag: string | null; archive_provider_tag: string | null; archive_directory_tag: string | null }>(
    `SELECT b.batch_id, b.batch_code, b.current_status, pa.name AS paper_name, o.is_use_mrdf AS use_mrdf, o.account_code, o.return_address, o.logo1, o.logo2,
       o.is_archive_mailpieces AS archive, o.archive_customer_tag, o.archive_provider_tag, o.archive_directory_tag
     FROM idoc.batch AS b INNER JOIN idoc.paper AS pa ON pa.paper_id = b.paper_id
     INNER JOIN idoc.v_account_owner AS v ON v.account_id = b.account_id INNER JOIN idoc.account AS o ON o.account_id = v.owner_account_id
     WHERE b.job_id = @j ORDER BY b.batch_code`)).recordset;

  const rows = (await pool.request().input('j', sql.BigInt, jobId).query<{
    batch_id: number; mailpiece_id: number; sequence_number: number | null; max_weight_g: number | null; is_cancelled: boolean; colour_mode: string; is_address_matching: boolean;
    pack_id: number; start_page: number; end_page: number; submitting_account_id: number; release_date: Date; document_sequence: number; option_colour: string;
  }>(`
    SELECT m.batch_id, m.mailpiece_id, m.sequence_number, r.max_weight_g, m.is_cancelled,
           COALESCE((SELECT a.colour_mode FROM idoc.v_account_owner AS o INNER JOIN idoc.account AS a ON a.account_id = o.owner_account_id WHERE o.account_id = m.submitting_account_id), N'ORIGINAL') AS colour_mode,
           COALESCE((SELECT TOP 1 a.is_address_matching FROM idoc.v_account_setting_source AS s INNER JOIN idoc.account AS a ON a.account_id = s.source_account_id
                     WHERE s.account_id = m.account_id AND s.setting = N'matching' ORDER BY s.depth), 0) AS is_address_matching,
           p.pack_id, p.start_page, p.end_page, p.submitting_account_id, p.release_date, p.document_sequence, os.colour AS option_colour
    FROM idoc.mailpiece AS m
    INNER JOIN idoc.pack AS p ON p.mailpiece_id = m.mailpiece_id
    INNER JOIN idoc.option_set AS os ON os.option_set_id = p.option_set_id
    LEFT JOIN idoc.postal_rate AS r ON r.postal_rate_id = m.postal_rate_id
    WHERE m.job_id = @j AND m.batch_id IS NOT NULL ORDER BY m.mailpiece_id, p.pack_id`)).recordset;

  const byBatch = new Map<number, Map<number, PlanMailpiece>>();
  for (const x of rows) {
    const mps = byBatch.get(x.batch_id) ?? new Map<number, PlanMailpiece>();
    byBatch.set(x.batch_id, mps);
    let m = mps.get(x.mailpiece_id);
    if (!m) {
      const mode = (COLOUR_MODES as readonly string[]).includes(x.colour_mode) ? (x.colour_mode as ColourMode) : 'ORIGINAL';
      m = { mailpieceId: Number(x.mailpiece_id), sequenceNumber: x.sequence_number, weightBandG: x.max_weight_g, isCancelled: Boolean(x.is_cancelled), colourMode: mode, isAddressMatching: Boolean(x.is_address_matching), packs: [] };
      mps.set(x.mailpiece_id, m);
    }
    m.packs.push({ packId: Number(x.pack_id), startPage: x.start_page, endPage: x.end_page, submittingAccountId: x.submitting_account_id, releaseDate: x.release_date,
      documentSequence: x.document_sequence, forceMono: /^mono/i.test(x.option_colour.trim()) });
  }
  return {
    jobId, status: job.status, pdfFileName: job.pdf_file_name,
    batches: batches.map((b) => ({ batchId: Number(b.batch_id), batchCode: Number(b.batch_code), status: b.current_status, paperName: b.paper_name, mailpieces: [...(byBatch.get(b.batch_id)?.values() ?? [])],
      mrdf: b.use_mrdf ? { accountCode: b.account_code, returnAddress: (b.return_address ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean), logo1: b.logo1, logo2: b.logo2 } : null,
      archive: b.archive ? { customerTag: b.archive_customer_tag, providerTag: b.archive_provider_tag, directoryTag: b.archive_directory_tag } : null })),
  };
}

/** The file names already recorded for a batch (a re-compose removes the ones it no longer makes). */
export async function recordedFiles(pool: sql.ConnectionPool, batchId: number): Promise<string[]> {
  return (await pool.request().input('b', sql.BigInt, batchId).query<{ file_name: string }>('SELECT file_name FROM idoc.batch_file WHERE batch_id = @b')).recordset.map((r) => r.file_name);
}

/** Replaces the batch's file records and writes the sequence numbers and each pack's output pages, in one transaction. Only while the batch is Created. */
export async function saveComposition(pool: sql.ConnectionPool, batchId: number, plan: BatchPlan, files: ComposedFile[]): Promise<void> {
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const q = (text: string, inputs: [string, sql.ISqlType | (() => sql.ISqlType), unknown][] = []) => {
      const req = new sql.Request(tx); for (const [n, t, v] of inputs) req.input(n, t as sql.ISqlType, v); return req.query(text);
    };
    const st = (await q('SELECT current_status FROM idoc.batch WITH (UPDLOCK) WHERE batch_id = @b', [['b', sql.BigInt, batchId]])).recordset[0]?.current_status;
    if (st !== 'Created') throw new Error(`Batch ${batchId} is ${st ?? 'missing'}; only a Created batch can be composed again`);

    await q(`UPDATE p SET batch_file_id = NULL, output_start_page = NULL, output_end_page = NULL FROM idoc.pack AS p
             INNER JOIN idoc.mailpiece AS m ON m.mailpiece_id = p.mailpiece_id WHERE m.batch_id = @b`, [['b', sql.BigInt, batchId]]);
    await q('DELETE FROM idoc.batch_file WHERE batch_id = @b', [['b', sql.BigInt, batchId]]);
    // Set-based, so the transaction (and the locks it holds on the pack and mailpiece rows) lasts seconds, not minutes: one statement per
    // thousands of rows instead of one round trip per pack. A long transaction blocks the Jobs screen's queries until they time out.
    if (plan.newSequences.size) await q(`UPDATE m SET sequence_number = j.s FROM idoc.mailpiece AS m
        INNER JOIN OPENJSON(@seq) WITH (m BIGINT '$.m', s INT '$.s') AS j ON j.m = m.mailpiece_id WHERE m.sequence_number IS NULL`,
      [['seq', sql.NVarChar(sql.MAX), JSON.stringify([...plan.newSequences].map(([m, s]) => ({ m, s })))]]);
    const packs: { p: number; g: number; s: number; e: number }[] = [];
    for (const seg of plan.segments) {
      const f = files.find((x) => x.segmentNumber === seg.segmentNumber)!;
      await q(`INSERT INTO idoc.batch_file (batch_id, segment_number, file_name, mailpiece_count, page_count, first_sequence, last_sequence)
        VALUES (@b, @n, @f, @mc, @pc, @fs, @ls)`, [['b', sql.BigInt, batchId], ['n', sql.Int, f.segmentNumber], ['f', sql.NVarChar(260), f.fileName],
        ['mc', sql.Int, f.mailpieceCount], ['pc', sql.Int, f.pageCount], ['fs', sql.Int, f.firstSequence], ['ls', sql.Int, f.lastSequence]]);
      for (const p of seg.packs) packs.push({ p: p.packId, g: seg.segmentNumber, s: p.outputStart, e: p.outputEnd });
    }
    if (packs.length) await q(`UPDATE p SET batch_file_id = f.batch_file_id, output_start_page = j.s, output_end_page = j.e FROM idoc.pack AS p
        INNER JOIN OPENJSON(@packs) WITH (p BIGINT '$.p', g INT '$.g', s INT '$.s', e INT '$.e') AS j ON j.p = p.pack_id
        INNER JOIN idoc.batch_file AS f ON f.batch_id = @b AND f.segment_number = j.g`,
      [['packs', sql.NVarChar(sql.MAX), JSON.stringify(packs)], ['b', sql.BigInt, batchId]]);
    await tx.commit();
  } catch (e) {
    try { await tx.rollback(); } catch { /* already rolled back */ }
    throw e;
  }
}

/** Received jobs with a batch that still has mail to print and no print file yet, oldest first. */
export async function jobsToCompose(pool: sql.ConnectionPool): Promise<number[]> {
  return (await pool.request().query<{ job_id: number }>(`
    SELECT DISTINCT j.job_id FROM idoc.job AS j INNER JOIN idoc.batch AS b ON b.job_id = j.job_id
    WHERE j.status = N'Received' AND b.current_status = N'Created'
      AND NOT EXISTS (SELECT 1 FROM idoc.batch_file AS f WHERE f.batch_id = b.batch_id)
      AND EXISTS (SELECT 1 FROM idoc.mailpiece AS m WHERE m.batch_id = b.batch_id AND m.is_cancelled = 0)
    ORDER BY j.job_id`)).recordset.map((r) => Number(r.job_id));
}

/** The recipients of a batch's mailpieces, by mailpiece id, for the MRDF file: addressee and address lines, and the postcode. */
export async function loadMrdfRecipients(pool: sql.ConnectionPool, batchId: number): Promise<Map<number, { addressLines: string[]; postcode: string }>> {
  const rows = (await pool.request().input('b', sql.BigInt, batchId).query<{ mailpiece_id: number; postcode: string; line_no: number | null; text: string | null }>(
    `SELECT m.mailpiece_id, a.postcode, l.line_no, l.text FROM idoc.mailpiece AS m INNER JOIN idoc.address AS a ON a.address_id = m.address_id
     LEFT JOIN idoc.address_line AS l ON l.address_id = a.address_id
     WHERE m.batch_id = @b AND m.is_cancelled = 0 ORDER BY m.mailpiece_id, l.line_no`)).recordset;
  const out = new Map<number, { addressLines: string[]; postcode: string }>();
  for (const r of rows) {
    const id = Number(r.mailpiece_id);
    const e = out.get(id) ?? { addressLines: [], postcode: r.postcode };
    if (r.text !== null) e.addressLines.push(r.text);
    out.set(id, e);
  }
  return out;
}
