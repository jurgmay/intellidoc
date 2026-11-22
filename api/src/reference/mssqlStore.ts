import sql from 'mssql';
import { ConflictError, NotFoundError } from '../errors.js';
import * as D from './describe.js';
import { checkFormatLimits, paperInUse } from './rules.js';
import type { FormatInput, FormatView, HistoryEntry, PaperInput, PaperView, ReferenceStore } from './types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>;
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** The SQL behind the Settings Paper, Postal formats and Anonymous addressees tabs. Every change writes its audit line (entity 'reference') in the same transaction. */
export class MssqlReferenceStore implements ReferenceStore {
  constructor(private readonly pool: sql.ConnectionPool) {}

  private async tx<T>(fn: (t: sql.Transaction) => Promise<T>): Promise<T> {
    const t = new sql.Transaction(this.pool);
    await t.begin();
    try { const out = await fn(t); await t.commit(); return out; }
    catch (e) { try { await t.rollback(); } catch { /* already rolled back */ } throw e; }
  }
  private async audit(t: sql.Transaction, by: string, summary: string): Promise<void> {
    await new sql.Request(t).input('by', sql.NVarChar(200), by).input('s', sql.NVarChar(1000), summary.slice(0, 1000))
      .query(`INSERT INTO idoc.audit_log (changed_by, entity, entity_id, summary) VALUES (@by, N'reference', 0, @s)`);
  }

  private async paperRows(t: sql.Transaction | null, id?: number): Promise<PaperView[]> {
    const req = t ? new sql.Request(t) : this.pool.request();
    if (id !== undefined) req.input('i', sql.Int, id);
    const rows = (await req.query(`
      SELECT p.paper_id, p.name, p.batch_name, p.paper_code, (SELECT COUNT(*) FROM idoc.option_set AS o WHERE o.paper_id = p.paper_id) AS used_by
      FROM idoc.paper AS p ${id !== undefined ? 'WHERE p.paper_id = @i' : ''} ORDER BY p.name`)).recordset as R[];
    return rows.map((r) => ({ id: r.paper_id, name: r.name, batchName: r.batch_name, paperCode: r.paper_code ?? null, usedBy: Number(r.used_by) }));
  }
  async papers(): Promise<PaperView[]> { return this.paperRows(null); }
  async updatePaper(id: number, input: PaperInput, by: string): Promise<void> {
    await this.tx(async (t) => {
      const old = (await this.paperRows(t, id))[0]; if (!old) throw new NotFoundError('Paper not found');
      const line = D.describePaperChange(old, input); if (!line) return;
      await new sql.Request(t).input('i', sql.Int, id).input('b', sql.NVarChar(100), input.batchName).input('c', sql.NVarChar(50), input.paperCode)
        .query('UPDATE idoc.paper SET batch_name = @b, paper_code = @c WHERE paper_id = @i');
      await this.audit(t, by, line);
    });
  }
  async deletePaper(id: number, by: string): Promise<void> {
    await this.tx(async (t) => {
      const old = (await this.paperRows(t, id))[0]; if (!old) throw new NotFoundError('Paper not found');
      if (old.usedBy > 0) throw paperInUse(old.name, old.usedBy);
      await new sql.Request(t).input('i', sql.Int, id).query('DELETE FROM idoc.paper WHERE paper_id = @i');
      await this.audit(t, by, D.describePaperDeleted(old.name));
    });
  }

  private async formatRows(t: sql.Transaction | null): Promise<FormatView[]> {
    const req = t ? new sql.Request(t) : this.pool.request();
    const rows = (await req.query(`
      SELECT f.postal_format_id, f.name, f.rank_order, f.max_weight_g, f.max_thickness_mm, f.max_sheets, f.max_length_mm, f.max_width_mm,
             (SELECT COUNT(*) FROM idoc.postal_service AS s WHERE s.postal_format_id = f.postal_format_id) AS used_by
      FROM idoc.postal_format AS f ORDER BY f.rank_order`)).recordset as R[];
    return rows.map((r) => ({ id: r.postal_format_id, name: r.name, rank: r.rank_order, maxWeightG: r.max_weight_g, maxThicknessMm: num(r.max_thickness_mm), maxSheets: num(r.max_sheets), maxLengthMm: Number(r.max_length_mm), maxWidthMm: Number(r.max_width_mm), usedBy: Number(r.used_by) }));
  }
  async formats(): Promise<FormatView[]> { return this.formatRows(null); }
  async updateFormat(id: number, input: FormatInput, by: string): Promise<void> {
    await this.tx(async (t) => {
      const all = await this.formatRows(t); const f = all.find((x) => x.id === id); if (!f) throw new NotFoundError('Postal format not found');
      checkFormatLimits(f, input, all.filter((x) => x.id !== id));
      const line = D.describeFormatChange(f, input); if (!line) return;
      await new sql.Request(t).input('i', sql.Int, id).input('w', sql.Int, input.maxWeightG).input('th', sql.Decimal(6, 2), input.maxThicknessMm).input('s', sql.Int, input.maxSheets)
        .input('mw', sql.Decimal(7, 2), input.maxLengthMm).input('mh', sql.Decimal(7, 2), input.maxWidthMm)
        .query('UPDATE idoc.postal_format SET max_weight_g = @w, max_thickness_mm = @th, max_sheets = @s, max_length_mm = @mw, max_width_mm = @mh WHERE postal_format_id = @i');
      await this.audit(t, by, line);
    });
  }

  async anonymous(): Promise<string[]> {
    return ((await this.pool.request().query('SELECT normalised_text FROM idoc.anonymous_addressee ORDER BY normalised_text')).recordset as R[]).map((r) => r.normalised_text as string);
  }
  async addAnonymous(text: string, by: string): Promise<string> {
    await this.tx(async (t) => {
      const have = (await new sql.Request(t).input('n', sql.NVarChar(200), text).query('SELECT 1 AS x FROM idoc.anonymous_addressee WHERE normalised_text = @n')).recordset.length;
      if (have) throw new ConflictError(`${text} is already on the list.`);
      await new sql.Request(t).input('n', sql.NVarChar(200), text).query('INSERT INTO idoc.anonymous_addressee (normalised_text) VALUES (@n)');
      await this.audit(t, by, D.describeAnonymousAdded(text));
    });
    return text;
  }
  async deleteAnonymous(text: string, by: string): Promise<void> {
    await this.tx(async (t) => {
      const r = await new sql.Request(t).input('n', sql.NVarChar(200), text).query('DELETE FROM idoc.anonymous_addressee WHERE normalised_text = @n');
      if (!r.rowsAffected[0]) throw new NotFoundError('Not on the list');
      await this.audit(t, by, D.describeAnonymousDeleted(text));
    });
  }

  async history(limit: number): Promise<HistoryEntry[]> {
    const rows = (await this.pool.request().input('n', sql.Int, limit).query(`SELECT TOP (@n) audit_id, changed_at, changed_by, summary FROM idoc.audit_log WHERE entity = N'reference' ORDER BY audit_id DESC`)).recordset as R[];
    return rows.map((r) => ({ id: Number(r.audit_id), changedAt: (r.changed_at as Date).toISOString(), changedBy: r.changed_by, summary: r.summary }));
  }
}
