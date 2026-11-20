import sql from 'mssql';
import type { RunSheetInput } from './data.js';

/** Loads one RunSheetInput per batch of a job, in batch code order. Read-only. */
export async function loadRunSheetInputs(pool: sql.ConnectionPool, jobId: number): Promise<RunSheetInput[]> {
  const batches = (await pool.request().input('job', sql.BigInt, jobId).query<{
    batch_id: number; batch_code: number; export_date: Date; mis_job_number: string | null; customer_name: string; return_address: string | null;
    department: string; format_name: string; envelope_code: string | null; envelope_description: string;
    service_name: string; service_code: string | null; provider_name: string;
    paper_name: string | null; is_duplex: boolean | null; colour: string | null;
  }>(`
    SELECT b.batch_id, b.batch_code, j.export_date, c.mis_job_number, c.name AS customer_name, c.return_address,
           b.fulfilment_department AS department, pf.name AS format_name, si.stock_code AS envelope_code, si.description AS envelope_description,
           ps.name AS service_name, ps.service_code, pp.name AS provider_name,
           o.paper_name, o.is_duplex, o.colour
    FROM idoc.batch AS b
    INNER JOIN idoc.job AS j ON j.job_id = b.job_id
    INNER JOIN idoc.account AS c ON c.account_id = b.account_id
    INNER JOIN idoc.postal_format AS pf ON pf.postal_format_id = b.postal_format_id
    INNER JOIN idoc.stock_item AS si ON si.stock_item_id = b.outer_stock_item_id
    INNER JOIN idoc.postal_service AS ps ON ps.postal_service_id = b.postal_service_id
    INNER JOIN idoc.postal_provider AS pp ON pp.postal_provider_id = ps.postal_provider_id
    OUTER APPLY (
      SELECT TOP 1 pa.name AS paper_name, os.is_duplex, os.colour
      FROM idoc.mailpiece AS m
      INNER JOIN idoc.pack AS k ON k.mailpiece_id = m.mailpiece_id
      INNER JOIN idoc.option_set AS os ON os.option_set_id = k.option_set_id
      INNER JOIN idoc.paper AS pa ON pa.paper_id = os.paper_id
      WHERE m.batch_id = b.batch_id ORDER BY m.mailpiece_id
    ) AS o
    WHERE b.job_id = @job ORDER BY b.batch_code`)).recordset;

  const out: RunSheetInput[] = [];
  for (const b of batches) {
    const mps = (await pool.request().input('b', sql.BigInt, b.batch_id).query<{ page_count: number; max_weight_g: number | null }>(`
      SELECT m.page_count, r.max_weight_g
      FROM idoc.mailpiece AS m LEFT JOIN idoc.postal_rate AS r ON r.postal_rate_id = m.postal_rate_id
      WHERE m.batch_id = @b AND m.is_cancelled = 0`)).recordset;
    const inserts = (await pool.request().input('b', sql.BigInt, b.batch_id).query<{ stock_code: string | null; description: string; quantity: number }>(`
      SELECT si.stock_code, si.description, bi.quantity
      FROM idoc.batch_insert AS bi INNER JOIN idoc.stock_item AS si ON si.stock_item_id = bi.stock_item_id
      WHERE bi.batch_id = @b ORDER BY si.stock_code`)).recordset;
    out.push({
      batchCode: b.batch_code,
      jobNumber: b.mis_job_number ?? '',
      customerName: b.customer_name,
      submitted: b.export_date,
      paper: b.paper_name ?? '',
      isDuplex: Boolean(b.is_duplex),
      colour: b.colour ?? '',
      mailpieces: mps.length,
      pages: mps.reduce((n, m) => n + m.page_count, 0),
      department: b.department,
      envelopeCode: b.envelope_code ?? '',
      envelopeDescription: b.envelope_description,
      inserts: inserts.map((i) => ({ code: i.stock_code ?? '', description: i.description, quantity: i.quantity })),
      postalProvider: b.provider_name,
      postalServiceName: b.service_name,
      serviceCode: b.service_code,
      postalFormat: b.format_name,
      weightBandsG: mps.map((m) => m.max_weight_g),
      returnAddress: b.return_address,
    });
  }
  return out;
}
