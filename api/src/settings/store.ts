import sql from 'mssql';
import { BY_KEY, SETTINGS, type SettingValue } from './catalogue.js';

export interface AuditRow { id: number; changedAt: string; changedBy: string; setting: string; oldValue: string | null; newValue: string | null }
export interface Change { key: string; oldValue: SettingValue; newValue: SettingValue }
export interface BatchCodeInfo { highestUsed: number | null; next: number }

export interface SettingsStore {
  read(): Promise<Record<string, SettingValue>>;
  /** Allowed values of the envelope size select. */
  envelopeSizes(): Promise<string[]>;
  /** Writes the changes and the audit rows in one transaction. */
  update(changes: Change[], by: string): Promise<void>;
  audit(limit: number): Promise<AuditRow[]>;
  batchCode(): Promise<BatchCodeInfo>;
  setNextBatchCode(next: number, by: string): Promise<void>;
}

const fmt = (v: SettingValue): string => (typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v));

export class MssqlSettingsStore implements SettingsStore {
  constructor(private readonly pool: sql.ConnectionPool) {}

  async read(): Promise<Record<string, SettingValue>> {
    const row = (await this.pool.request().query(`SELECT ${SETTINGS.map((s) => `CAST(${s.column} AS ${s.type === 'boolean' ? 'BIT' : s.type === 'number' ? 'FLOAT' : s.type === 'integer' ? 'INT' : 'NVARCHAR(1000)'}) AS ${s.column}`).join(', ')}
      FROM idoc.settings WHERE settings_id = 1`)).recordset[0] as Record<string, unknown> | undefined;
    if (!row) throw new Error('idoc.settings has no row');
    const out: Record<string, SettingValue> = {};
    for (const s of SETTINGS) {
      const v = row[s.column];
      out[s.key] = s.type === 'boolean' ? Boolean(v) : s.type === 'number' || s.type === 'integer' ? Number(v) : String(v ?? '');
    }
    return out;
  }

  async envelopeSizes(): Promise<string[]> {
    return (await this.pool.request().query('SELECT code FROM idoc.envelope_size ORDER BY code')).recordset.map((r: { code: string }) => r.code);
  }

  async update(changes: Change[], by: string): Promise<void> {
    if (changes.length === 0) return;
    const tx = new sql.Transaction(this.pool);
    await tx.begin();
    try {
      const req = new sql.Request(tx);
      const sets: string[] = [];
      changes.forEach((c, i) => {
        const def = BY_KEY.get(c.key)!; // column names come from the catalogue only, never from the request
        sets.push(`${def.column} = @v${i}`);
        if (def.type === 'boolean') req.input(`v${i}`, sql.Bit, c.newValue as boolean);
        else if (def.type === 'number') req.input(`v${i}`, sql.Decimal(8, 3), c.newValue as number);
        else if (def.type === 'integer') req.input(`v${i}`, sql.Int, c.newValue as number);
        else req.input(`v${i}`, sql.NVarChar(1000), c.newValue as string);
      });
      await req.query(`UPDATE idoc.settings SET ${sets.join(', ')} WHERE settings_id = 1`);
      for (const c of changes) {
        await new sql.Request(tx).input('by', sql.NVarChar(200), by).input('n', sql.NVarChar(100), BY_KEY.get(c.key)!.label)
          .input('o', sql.NVarChar(1000), fmt(c.oldValue)).input('v', sql.NVarChar(1000), fmt(c.newValue))
          .query('INSERT INTO idoc.settings_audit (changed_by, setting_name, old_value, new_value) VALUES (@by, @n, @o, @v)');
      }
      await tx.commit();
    } catch (e) {
      try { await tx.rollback(); } catch { /* already rolled back */ }
      throw e;
    }
  }

  async audit(limit: number): Promise<AuditRow[]> {
    const rows = (await this.pool.request().input('n', sql.Int, limit).query(
      'SELECT TOP (@n) audit_id, changed_at, changed_by, setting_name, old_value, new_value FROM idoc.settings_audit ORDER BY audit_id DESC')).recordset;
    return rows.map((r: { audit_id: number; changed_at: Date; changed_by: string; setting_name: string; old_value: string | null; new_value: string | null }) =>
      ({ id: Number(r.audit_id), changedAt: r.changed_at.toISOString(), changedBy: r.changed_by, setting: r.setting_name, oldValue: r.old_value, newValue: r.new_value }));
  }

  async batchCode(): Promise<BatchCodeInfo> {
    const max = (await this.pool.request().query('SELECT MAX(batch_code) AS m FROM idoc.batch')).recordset[0].m as number | null;
    if (max !== null) return { highestUsed: Number(max), next: Number(max) + 1 };
    const cur = (await this.pool.request().query(`SELECT CAST(current_value AS BIGINT) AS v FROM sys.sequences WHERE name = N'batch_code_seq' AND schema_id = SCHEMA_ID(N'idoc')`)).recordset[0];
    return { highestUsed: null, next: Number(cur?.v ?? 1) };
  }

  async setNextBatchCode(next: number, by: string): Promise<void> {
    if (!Number.isSafeInteger(next) || next < 1) throw new Error('Next batch code must be a whole number of 1 or more');
    const old = await this.batchCode();
    // RESTART WITH cannot take a parameter; `next` has been checked to be an integer above.
    await this.pool.request().query(`ALTER SEQUENCE idoc.batch_code_seq RESTART WITH ${next}`);
    await this.pool.request().input('by', sql.NVarChar(200), by).input('o', sql.NVarChar(1000), String(old.next)).input('v', sql.NVarChar(1000), String(next))
      .query(`INSERT INTO idoc.settings_audit (changed_by, setting_name, old_value, new_value) VALUES (@by, N'Next batch code', @o, @v)`);
  }
}

/** For tests and the stub server. */
export class MemorySettingsStore implements SettingsStore {
  values: Record<string, SettingValue> = {
    a4SheetWeightG: 5.625, a4SheetThicknessMm: 0.1, machineEnclosingMinMailpieces: 25, machineEnclosingMaxSheets: 12, machineEnclosingEnvelopeSize: 'C5',
    handEnclosingMaxSheets: 125, xmlFirstEnabled: true, pdfWaitMinutes: 30, pdfReminderMinutes: 30, alertRecipients: '', emailRunSheets: false, runSheetRecipients: '',
    autoCompose: false, maxPagesPerPdf: 10000, markSeqFontPt: 8, markSeqLeftMm: 20, markSeqTopMm: 40, markSeqWidthMm: 45, markSeqHeightMm: 4,
    markDmLeftMm: 20, markDmTopMm: 30, markDmWidthMm: 8, markDmHeightMm: 8, markDotXMm: 205.5, markDotYMm: 269, markDotDiameterMm: 2,
    mrdfDmLeftMm: 10, mrdfDmTopMm: 10, mrdfDmWidthMm: 8, mrdfDmHeightMm: 8, mrdfOcrFontPt: 8.2, mrdfOcrLeftMm: 20, mrdfOcrTopMm: 10, mrdfOcrWidthMm: 30, mrdfOcrHeightMm: 4,
  };
  rows: AuditRow[] = [];
  highestUsed: number | null = 1041;
  sizes = ['C5', 'C4'];
  now = (): string => new Date().toISOString();
  async read(): Promise<Record<string, SettingValue>> { return { ...this.values }; }
  async envelopeSizes(): Promise<string[]> { return this.sizes; }
  async update(changes: Change[], by: string): Promise<void> {
    for (const c of changes) {
      this.values[c.key] = c.newValue;
      this.rows.unshift({ id: this.rows.length + 1, changedAt: this.now(), changedBy: by, setting: BY_KEY.get(c.key)!.label, oldValue: fmt(c.oldValue), newValue: fmt(c.newValue) });
    }
  }
  async audit(limit: number): Promise<AuditRow[]> { return this.rows.slice(0, limit); }
  async batchCode(): Promise<BatchCodeInfo> { return { highestUsed: this.highestUsed, next: (this.highestUsed ?? 0) + 1 }; }
  async setNextBatchCode(next: number, by: string): Promise<void> {
    const old = await this.batchCode(); this.highestUsed = next - 1;
    this.rows.unshift({ id: this.rows.length + 1, changedAt: this.now(), changedBy: by, setting: 'Next batch code', oldValue: String(old.next), newValue: String(next) });
  }
}
