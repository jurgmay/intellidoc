import sql from 'mssql';
import { SecretBox, SecretKeyMissing } from './secret.js';
import { BY_KEY, nameOf, SETTINGS, type SettingValue } from './catalogue.js';

export interface AuditRow { id: number; changedAt: string; changedBy: string; setting: string; oldValue: string | null; newValue: string | null }
export interface Change { key: string; oldValue: SettingValue; newValue: SettingValue }
export interface BatchCodeInfo { highestUsed: number | null; next: number }

/**
 * `maxUsed` is the highest batch code on any batch; `sequenceValue` is the sequence's current_value. After a restart (or before the first batch) the current value is the next
 * number to issue, not yet used; once a batch has taken it, it equals the highest used. So a current value above every batch code is what comes next, otherwise it is one more than the highest.
 */
export function nextBatchCodeInfo(maxUsed: number | null, sequenceValue: number | null): BatchCodeInfo {
  if (maxUsed === null) return { highestUsed: null, next: sequenceValue ?? 1 };
  return { highestUsed: maxUsed, next: sequenceValue !== null && sequenceValue > maxUsed ? sequenceValue : maxUsed + 1 };
}

export interface SettingsStore {
  read(): Promise<Record<string, SettingValue>>;
  /** Allowed values of the envelope size select. */
  envelopeSizes(): Promise<string[]>;
  /** Writes the changes and the audit rows in one transaction. */
  update(changes: Change[], by: string): Promise<void>;
  audit(limit: number): Promise<AuditRow[]>;
  batchCode(): Promise<BatchCodeInfo>;
  setNextBatchCode(next: number, by: string): Promise<void>;
  /** A secret setting (a password) in the clear, for server code that needs it; never for a browser. Null when none is saved. */
  secret(key: string): Promise<string | null>;
  /** Removes a saved secret, with a change-log row. */
  clearSecret(key: string, by: string): Promise<void>;
}

const fmt = (v: SettingValue): string => (typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v));
/** What the change log says about a secret: never the value, never the ciphertext. */
const SET = '(set)', NOT_SET = '(not set)';
const SECRET_KEYS = new Set(SETTINGS.filter((s) => s.type === 'secret').map((s) => s.key));
const auditValue = (key: string, v: SettingValue): string => (SECRET_KEYS.has(key) ? (v === '' ? NOT_SET : SET) : fmt(v));
/** The value to store: a secret is encrypted first (the key must be set), everything else is as given. */
function toStored(box: SecretBox | null, key: string, v: SettingValue): SettingValue {
  if (!SECRET_KEYS.has(key) || v === '') return v;
  if (!box) throw new SecretKeyMissing();
  return box.encrypt(v as string);
}

export class MssqlSettingsStore implements SettingsStore {
  /** `secrets` encrypts the password setting; without it a password cannot be saved (SecretKeyMissing). */
  constructor(private readonly pool: sql.ConnectionPool, private readonly secrets: SecretBox | null = null) {}

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
    const stored = changes.map((c) => toStored(this.secrets, c.key, c.newValue)); // before anything is written: a missing key refuses the whole save
    const tx = new sql.Transaction(this.pool);
    await tx.begin();
    try {
      const req = new sql.Request(tx);
      const sets: string[] = [];
      changes.forEach((c, i) => {
        const def = BY_KEY.get(c.key)!; // column names come from the catalogue only, never from the request
        sets.push(`${def.column} = @v${i}`);
        if (def.type === 'boolean') req.input(`v${i}`, sql.Bit, stored[i] as boolean);
        else if (def.type === 'number') req.input(`v${i}`, sql.Decimal(8, 3), stored[i] as number);
        else if (def.type === 'integer') req.input(`v${i}`, sql.Int, stored[i] as number);
        else req.input(`v${i}`, sql.NVarChar(1000), stored[i] as string);
      });
      await req.query(`UPDATE idoc.settings SET ${sets.join(', ')} WHERE settings_id = 1`);
      for (const c of changes) {
        await new sql.Request(tx).input('by', sql.NVarChar(200), by).input('n', sql.NVarChar(100), nameOf(BY_KEY.get(c.key)!))
          .input('o', sql.NVarChar(1000), auditValue(c.key, c.oldValue)).input('v', sql.NVarChar(1000), auditValue(c.key, c.newValue))
          .query('INSERT INTO idoc.settings_audit (changed_by, setting_name, old_value, new_value) VALUES (@by, @n, @o, @v)');
      }
      await tx.commit();
    } catch (e) {
      try { await tx.rollback(); } catch { /* already rolled back */ }
      throw e;
    }
  }

  async secret(key: string): Promise<string | null> {
    const def = BY_KEY.get(key);
    if (!def || def.type !== 'secret') throw new Error(`${key} is not a secret setting`);
    const stored = (await this.read())[key] as string;
    if (stored === '') return null;
    if (!this.secrets) throw new SecretKeyMissing();
    return this.secrets.decrypt(stored);
  }

  async clearSecret(key: string, by: string): Promise<void> {
    const def = BY_KEY.get(key);
    if (!def || def.type !== 'secret') throw new Error(`${key} is not a secret setting`);
    const old = (await this.read())[key] as string;
    if (old === '') return;
    await this.update([{ key, oldValue: old, newValue: '' }], by);
  }

  async audit(limit: number): Promise<AuditRow[]> {
    const rows = (await this.pool.request().input('n', sql.Int, limit).query(
      'SELECT TOP (@n) audit_id, changed_at, changed_by, setting_name, old_value, new_value FROM idoc.settings_audit ORDER BY audit_id DESC')).recordset;
    return rows.map((r: { audit_id: number; changed_at: Date; changed_by: string; setting_name: string; old_value: string | null; new_value: string | null }) =>
      ({ id: Number(r.audit_id), changedAt: r.changed_at.toISOString(), changedBy: r.changed_by, setting: r.setting_name, oldValue: r.old_value, newValue: r.new_value }));
  }

  async batchCode(): Promise<BatchCodeInfo> {
    const max = (await this.pool.request().query('SELECT MAX(batch_code) AS m FROM idoc.batch')).recordset[0].m as number | null;
    const cur = (await this.pool.request().query(`SELECT CAST(current_value AS BIGINT) AS v FROM sys.sequences WHERE name = N'batch_code_seq' AND schema_id = SCHEMA_ID(N'idoc')`)).recordset[0];
    return nextBatchCodeInfo(max === null ? null : Number(max), cur?.v === undefined || cur.v === null ? null : Number(cur.v));
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
    handEnclosingMaxSheets: 125, smallBatchLimit: 20, xmlFirstEnabled: true, pdfWaitMinutes: 30, pdfReminderMinutes: 30, alertRecipients: '', emailRunSheets: false, runSheetRecipients: '',
    autoCompose: false, maxPagesPerPdf: 10000, activityKeepDays: 7, activityRowsShown: 30, pageWidthMm: 210, pageHeightMm: 297, windowLeftMm: 15, windowTopMm: 25, windowWidthMm: 90, windowHeightMm: 35, markSeqFontPt: 8, markSeqLeftMm: 20, markSeqTopMm: 40, markSeqWidthMm: 45, markSeqHeightMm: 4,
    markDmLeftMm: 20, markDmTopMm: 30, markDmWidthMm: 8, markDmHeightMm: 8, markDotXMm: 205.5, markDotYMm: 269, markDotDiameterMm: 2,
    mrdfDmLeftMm: 10, mrdfDmTopMm: 10, mrdfDmWidthMm: 8, mrdfDmHeightMm: 8, mrdfOcrFontPt: 8.2, mrdfOcrLeftMm: 20, mrdfOcrTopMm: 10, mrdfOcrWidthMm: 30, mrdfOcrHeightMm: 4, mrdfOcrRotationDeg: 0,
    networkUsername: '', networkPassword: '', workflowNetworkPath: '', workflowSharedFolder: '', folderIn: '', folderOut: '', folderHold: '', folderPrintFiles: '', folderProcessed: '', bluecrestNetworkPath: '', bluecrestInputFolder: '', bluecrestOutputFolder: '', bluecrestLockFolder: '', bluecrestSelectFolder: '', bluecrestArchiveName: '', docketsFolder: '', docketsSignedForFolder: '',
    emailEnabled: false, smtpFromName: '', smtpFromAddress: '', smtpReplyTo: '', smtpServer: '', smtpPort: 587, smtpUsername: '', smtpPassword: '', hpodEndpoint: '', hpodInstance: '', hpodAccountCode: '', hpodUsername: '', hpodPassword: '',
  };
  rows: AuditRow[] = [];
  highestUsed: number | null = 1041;
  sizes = ['C5', 'C4'];
  now = (): string => new Date().toISOString();
  async read(): Promise<Record<string, SettingValue>> { return { ...this.values }; }
  async envelopeSizes(): Promise<string[]> { return this.sizes; }
  constructor(private readonly secrets: SecretBox | null = new SecretBox('memory store test key')) { /* a key by default, so a password can be saved in tests and the stub */ }
  async update(changes: Change[], by: string): Promise<void> {
    const stored = changes.map((c) => toStored(this.secrets, c.key, c.newValue));
    changes.forEach((c, i) => {
      this.values[c.key] = stored[i]!;
      this.rows.unshift({ id: this.rows.length + 1, changedAt: this.now(), changedBy: by, setting: nameOf(BY_KEY.get(c.key)!), oldValue: auditValue(c.key, c.oldValue), newValue: auditValue(c.key, c.newValue) });
    });
  }
  async secret(key: string): Promise<string | null> {
    if (BY_KEY.get(key)?.type !== 'secret') throw new Error(`${key} is not a secret setting`);
    const stored = this.values[key] as string;
    if (stored === '') return null;
    if (!this.secrets) throw new SecretKeyMissing();
    return this.secrets.decrypt(stored);
  }
  async clearSecret(key: string, by: string): Promise<void> {
    if (BY_KEY.get(key)?.type !== 'secret') throw new Error(`${key} is not a secret setting`);
    const old = this.values[key] as string;
    if (old !== '') await this.update([{ key, oldValue: old, newValue: '' }], by);
  }
  async audit(limit: number): Promise<AuditRow[]> { return this.rows.slice(0, limit); }
  async batchCode(): Promise<BatchCodeInfo> { return { highestUsed: this.highestUsed, next: (this.highestUsed ?? 0) + 1 }; }
  async setNextBatchCode(next: number, by: string): Promise<void> {
    const old = await this.batchCode(); this.highestUsed = next - 1;
    this.rows.unshift({ id: this.rows.length + 1, changedAt: this.now(), changedBy: by, setting: 'Next batch code', oldValue: String(old.next), newValue: String(next) });
  }
}
