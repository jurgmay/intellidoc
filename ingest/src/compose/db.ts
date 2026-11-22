import sql from 'mssql';
import { COLOUR_MODES, type ColourMode } from '../costing/colour.js';
import type { MarkSettings } from './marks.js';
import type { BatchPlan, PlanMailpiece } from './plan.js';
import type { ComposedFile } from './compose.js';

export interface ComposeSettings { maxPagesPerPdf: number; marks: MarkSettings }

export async function loadComposeSettings(pool: sql.ConnectionPool): Promise<ComposeSettings> {
  const r = (await pool.request().query<Record<string, number>>(`SELECT max_pages_per_pdf, mark_seq_font_pt, mark_seq_left_mm, mark_seq_top_mm, mark_seq_width_mm, mark_seq_height_mm,
      mark_dm_left_mm, mark_dm_top_mm, mark_dm_width_mm, mark_dm_height_mm, mark_dot_x_mm, mark_dot_y_mm, mark_dot_diameter_mm FROM idoc.settings WHERE settings_id = 1`)).recordset[0];
  if (!r) throw new Error('idoc.settings has no row');
  const n = (k: string): number => Number(r[k]);
  return {
    maxPagesPerPdf: n('max_pages_per_pdf'),
    marks: {
      seq: { fontPt: n('mark_seq_font_pt'), leftMm: n('mark_seq_left_mm'), topMm: n('mark_seq_top_mm'), widthMm: n('mark_seq_width_mm'), heightMm: n('mark_seq_height_mm') },
      dm: { leftMm: n('mark_dm_left_mm'), topMm: n('mark_dm_top_mm'), widthMm: n('mark_dm_width_mm'), heightMm: n('mark_dm_height_mm') },
      dot: { xMm: n('mark_dot_x_mm'), yMm: n('mark_dot_y_mm'), diameterMm: n('mark_dot_diameter_mm') },
    },
  };
}

export interface JobToCompose { jobId: number; status: string; pdfFileName: string; batches: BatchToCompose[] }
export interface BatchToCompose { batchId: number; batchCode: number; status: string; paperName: string | null; mailpieces: PlanMailpiece[] }

/** Reads the job, its batches and, for each, the mailpieces and packs the planner needs. Read-only. */
export async function loadJobToCompose(pool: sql.ConnectionPool, jobId: number): Promise<JobToCompose> {
  const job = (await pool.request().input('j', sql.BigInt, jobId).query<{ status: string; pdf_file_name: string }>('SELECT status, pdf_file_name FROM idoc.job WHERE job_id = @j')).recordset[0];
  if (!job) throw new Error(`Job ${jobId} does not exist`);
  const batches = (await pool.request().input('j', sql.BigInt, jobId).query<{ batch_id: number; batch_code: number; current_status: string; paper_name: string | null }>(
    `SELECT b.batch_id, b.batch_code, b.current_status, pa.name AS paper_name FROM idoc.batch AS b INNER JOIN idoc.paper AS pa ON pa.paper_id = b.paper_id
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
    batches: batches.map((b) => ({ batchId: Number(b.batch_id), batchCode: Number(b.batch_code), status: b.current_status, paperName: b.paper_name, mailpieces: [...(byBatch.get(b.batch_id)?.values() ?? [])] })),
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
    for (const [mailpieceId, seq] of plan.newSequences) await q('UPDATE idoc.mailpiece SET sequence_number = @s WHERE mailpiece_id = @m AND sequence_number IS NULL',
      [['s', sql.Int, seq], ['m', sql.BigInt, mailpieceId]]);
    for (const seg of plan.segments) {
      const f = files.find((x) => x.segmentNumber === seg.segmentNumber)!;
      const id = (await q(`INSERT INTO idoc.batch_file (batch_id, segment_number, file_name, mailpiece_count, page_count, first_sequence, last_sequence)
        OUTPUT INSERTED.batch_file_id AS id VALUES (@b, @n, @f, @mc, @pc, @fs, @ls)`, [['b', sql.BigInt, batchId], ['n', sql.Int, f.segmentNumber], ['f', sql.NVarChar(260), f.fileName],
        ['mc', sql.Int, f.mailpieceCount], ['pc', sql.Int, f.pageCount], ['fs', sql.Int, f.firstSequence], ['ls', sql.Int, f.lastSequence]])).recordset[0].id as number;
      for (const p of seg.packs) await q('UPDATE idoc.pack SET batch_file_id = @f, output_start_page = @s, output_end_page = @e WHERE pack_id = @p',
        [['f', sql.BigInt, id], ['s', sql.Int, p.outputStart], ['e', sql.Int, p.outputEnd], ['p', sql.BigInt, p.packId]]);
    }
    await tx.commit();
  } catch (e) {
    try { await tx.rollback(); } catch { /* already rolled back */ }
    throw e;
  }
}
