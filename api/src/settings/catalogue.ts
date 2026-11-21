/**
 * Every setting in idoc.settings, with what it means and where the app uses it.
 * The web page is generated from this list, so the explanation shown next to a setting is the one that lives next to the code.
 */
export type SettingValue = number | boolean | string;
export type SettingType = 'number' | 'integer' | 'boolean' | 'select' | 'emails';

export interface SettingDef {
  key: string;
  column: string;
  group: string;
  label: string;
  type: SettingType;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  description: string;
  /** Where the app uses it, in plain words. */
  usedBy: string;
  /** What "applies" means: when a change takes effect. */
  appliesTo: string;
}

export const GROUPS = ['Weights and sizes', 'Enclosing', 'PDF and alerts'] as const;

export const SETTINGS: SettingDef[] = [
  {
    key: 'a4SheetWeightG', column: 'a4_sheet_weight_g', group: 'Weights and sizes', label: 'Weight of one A4 sheet', type: 'number', unit: 'g', min: 0.1, max: 50, step: 0.001,
    description: 'Weight of one sheet of A4 90gsm paper (5.625 g). Every letter is assumed to be printed on this paper.',
    usedBy: 'Import: the weight of each mailpiece is sheets x this value plus inserts plus the envelope. That weight decides the postal format, weight band and envelope.',
    appliesTo: 'Next file imported. Mailpieces already imported keep their weight.',
  },
  {
    key: 'a4SheetThicknessMm', column: 'a4_sheet_thickness_mm', group: 'Weights and sizes', label: 'Thickness of one A4 sheet', type: 'number', unit: 'mm', min: 0.01, max: 5, step: 0.001,
    description: 'Thickness of one sheet of A4 paper.',
    usedBy: 'Import: the thickness of a mailpiece is checked against the postal format limit (Letter: 5 mm, Large Letter: 25 mm).',
    appliesTo: 'Next file imported.',
  },
  {
    key: 'machineEnclosingMinMailpieces', column: 'machine_enclosing_min_mailpieces', group: 'Enclosing', label: 'Machine enclosing: more than this many mailpieces', type: 'integer', unit: 'mailpieces', min: 0, max: 100000,
    description: 'A batch goes to the enclosing machine only when it has MORE than this many mailpieces; 25 or fewer are enclosed by hand.',
    usedBy: 'Import: decides the fulfilment department (Machine enclosing or Hand enclosing) of each batch, which is printed on the run sheet.',
    appliesTo: 'Next file imported.',
  },
  {
    key: 'machineEnclosingMaxSheets', column: 'machine_enclosing_max_sheets', group: 'Enclosing', label: 'Machine enclosing: most sheets per letter', type: 'integer', unit: 'sheets', min: 1, max: 500,
    description: 'The machine can enclose letters of up to this many sheets. Longer letters are enclosed by hand whatever the batch size.',
    usedBy: 'Import: a mailpiece with more sheets than this can never be in a machine batch.',
    appliesTo: 'Next file imported.',
  },
  {
    key: 'machineEnclosingEnvelopeSize', column: 'machine_enclosing_envelope_code', group: 'Enclosing', label: 'Machine enclosing: envelope size', type: 'select',
    description: 'The only envelope size the machine takes.',
    usedBy: 'Import: a batch can only go to the machine when its envelope is this size.',
    appliesTo: 'Next file imported.',
  },
  {
    key: 'handEnclosingMaxSheets', column: 'hand_enclosing_max_sheets', group: 'Enclosing', label: 'Hand enclosing: most sheets per letter', type: 'integer', unit: 'sheets', min: 1, max: 5000,
    description: 'Letters with more sheets than this go to Reception instead of the enclosing departments.',
    usedBy: 'Import: sets the Reception route; Reception batches never merge with other work.',
    appliesTo: 'Next file imported.',
  },
  {
    key: 'xmlFirstEnabled', column: 'xml_first_enabled', group: 'PDF and alerts', label: 'Import an XML without waiting for its PDF', type: 'boolean',
    description: 'When on, an XML is imported as soon as it arrives (the job waits as "Awaiting PDF"). When off, the watcher waits until the XML and PDF are both there.',
    usedBy: 'Folder watcher: whether a lone XML is imported, and whether a late PDF is matched to a waiting job.',
    appliesTo: 'The watcher re-reads this every minute; no restart needed.',
  },
  {
    key: 'pdfWaitMinutes', column: 'pdf_wait_minutes', group: 'PDF and alerts', label: 'Alert if the PDF has not arrived after', type: 'integer', unit: 'minutes', min: 1, max: 10080,
    description: 'How long a job may wait for its PDF before the first alert e-mail.',
    usedBy: 'Folder watcher: the once-a-minute check for jobs that are still "Awaiting PDF".',
    appliesTo: 'The watcher re-reads this every minute; no restart needed.',
  },
  {
    key: 'pdfReminderMinutes', column: 'pdf_reminder_minutes', group: 'PDF and alerts', label: 'Then remind every', type: 'integer', unit: 'minutes', min: 1, max: 10080,
    description: 'After the first alert, how often a reminder is sent until the PDF arrives.',
    usedBy: 'Folder watcher: the same once-a-minute check.',
    appliesTo: 'The watcher re-reads this every minute; no restart needed.',
  },
  {
    key: 'alertRecipients', column: 'alert_recipients', group: 'PDF and alerts', label: 'Alert e-mail recipients', type: 'emails',
    description: 'Who is told when a PDF is missing, rejected, or arrives after an alert. Separate addresses with commas. With direct send, use addresses on your own domain.',
    usedBy: 'Folder watcher: the To line of the alert e-mails. The mail server itself (SMTP) is set in the watcher .env file, not here.',
    appliesTo: 'The watcher re-reads this every minute; no restart needed.',
  },
];

export const BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

export function parseEmails(text: string): string[] {
  return text.split(/[;,\s]+/).map((x) => x.trim()).filter(Boolean);
}

/** Returns the cleaned value, or an error message. `options` are the allowed values of a select. */
export function validate(def: SettingDef, raw: unknown, options?: string[]): { value: SettingValue } | { error: string } {
  switch (def.type) {
    case 'boolean':
      return typeof raw === 'boolean' ? { value: raw } : { error: `${def.label} must be on or off` };
    case 'number':
    case 'integer': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return { error: `${def.label} must be a number` };
      if (def.type === 'integer' && !Number.isInteger(raw)) return { error: `${def.label} must be a whole number` };
      if (def.min !== undefined && raw < def.min) return { error: `${def.label} must be at least ${def.min}` };
      if (def.max !== undefined && raw > def.max) return { error: `${def.label} must be at most ${def.max}` };
      return { value: raw };
    }
    case 'select':
      if (typeof raw !== 'string') return { error: `${def.label} must be one of the listed values` };
      return !options || options.includes(raw) ? { value: raw } : { error: `${def.label} must be one of: ${options.join(', ')}` };
    case 'emails': {
      if (typeof raw !== 'string') return { error: `${def.label} must be text` };
      const list = parseEmails(raw);
      const bad = list.filter((e) => !EMAIL.test(e));
      if (bad.length) return { error: `Not an e-mail address: ${bad.join(', ')}` };
      return { value: list.join(', ') };
    }
  }
}
