import sql from 'mssql';

/** Settings the watcher re-reads while it runs (set in the web app, stored in idoc.settings). */
export interface AlertSettings {
  xmlFirst: boolean;
  pdfWaitMinutes: number;
  pdfReminderMinutes: number;
  alertTo: string[];
  /** Finished Activity rows are deleted after this many days. */
  activityKeepDays: number;
}

export function parseRecipients(text: string): string[] {
  return text.split(/[;,\s]+/).map((x) => x.trim()).filter(Boolean);
}

export async function loadAlertSettings(pool: sql.ConnectionPool): Promise<AlertSettings> {
  const r = (await pool.request().query<{ xml_first_enabled: boolean; pdf_wait_minutes: number; pdf_reminder_minutes: number; alert_recipients: string; activity_keep_days: number }>(
    'SELECT xml_first_enabled, pdf_wait_minutes, pdf_reminder_minutes, alert_recipients, activity_keep_days FROM idoc.settings WHERE settings_id = 1')).recordset[0];
  if (!r) throw new Error('idoc.settings has no row');
  return { xmlFirst: Boolean(r.xml_first_enabled), pdfWaitMinutes: r.pdf_wait_minutes, pdfReminderMinutes: r.pdf_reminder_minutes, alertTo: parseRecipients(r.alert_recipients), activityKeepDays: r.activity_keep_days };
}
