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

export const GROUPS = ['Weights and sizes', 'Enclosing', 'PDF and alerts', 'Print production settings', 'Sequence number', 'Data Matrix', 'Pack start dot', 'MRDF page codes'] as const;

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
    key: 'machineEnclosingMaxSheets', column: 'machine_enclosing_max_sheets', group: 'Enclosing', label: 'Machine enclosing: maximum sheets per letter', type: 'integer', unit: 'sheets', min: 1, max: 500,
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
    key: 'handEnclosingMaxSheets', column: 'hand_enclosing_max_sheets', group: 'Enclosing', label: 'Hand enclosing: maximum sheets per letter', type: 'integer', unit: 'sheets', min: 1, max: 5000,
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
  {
    key: 'emailRunSheets', column: 'email_run_sheets', group: 'PDF and alerts', label: 'E-mail run sheets when print files are made', type: 'boolean',
    description: 'When on, the first time the print files of a job are made, one e-mail goes to the run sheet recipients (below) with the job\'s run sheets in one PDF and a summary of the job. The customer\'s notification addresses are copied in. A customer marked as Testing sends it to the alert recipients only. A job is e-mailed once; use Resend on the Jobs page to send it again.',
    usedBy: 'Making print files (the watcher and the Jobs page). The mail server (SMTP_HOST ...) is set in the .env file of the watcher and of the API; nothing is sent without it.',
    appliesTo: 'Next job whose print files are made.',
  },
  {
    key: 'runSheetRecipients', column: 'run_sheet_recipients', group: 'PDF and alerts', label: 'Run sheet e-mail recipients', type: 'emails',
    description: 'Who gets the run sheets, usually production. The first address is the To; the others are Cc. Separate addresses with commas.',
    usedBy: 'The run sheet e-mail, and the Resend button on the Jobs page.',
    appliesTo: 'Next run sheet e-mail.',
  },
  {
    key: 'autoCompose', column: 'auto_compose', group: 'Print production settings', label: 'Make print files automatically', type: 'boolean',
    description: 'When on, the folder watcher makes the print PDFs of a job as soon as it is Received, and again for any job it could not do. When off, print files are made only by running the compose command. Off until the marks below have been checked on a printed proof.',
    usedBy: 'Folder watcher: after each job is Received. It also needs the COMPOSE_OUT_DIR folder in the watcher .env file; without it nothing is made, whatever this says.',
    appliesTo: 'The watcher re-reads this every minute; no restart needed. Print files already made are not changed.',
  },
  {
    key: 'maxPagesPerPdf', column: 'max_pages_per_pdf', group: 'Print production settings', label: 'Maximum pages in one print file', type: 'integer', unit: 'pages', min: 2, max: 1000000,
    description: 'A batch is printed from one PDF. When a file passes this many pages it is closed after the mailpiece that took it over, and the batch continues in a new file, so a file can run over by up to one mailpiece. The run sheet and blank padding pages count.',
    usedBy: 'Print file composition: where a batch is split into files.',
    appliesTo: 'Next print file composed.',
  },
  {
    key: 'markSeqFontPt', column: 'mark_seq_font_pt', group: 'Sequence number', label: 'Font size', type: 'number', unit: 'pt', min: 1, max: 72, step: 0.1,
    description: 'Size of the sequence number text (OCR-B), e.g. 1042/000123.',
    usedBy: 'Print file composition: the sequence number printed on the first page of each mailpiece, for the enclosing machine camera.',
    appliesTo: 'Next print file composed. Files already made are not changed.',
  },
  {
    key: 'markSeqLeftMm', column: 'mark_seq_left_mm', group: 'Sequence number', label: 'Left', type: 'number', unit: 'mm', min: 0, max: 400, step: 0.1,
    description: 'Left edge of the box the sequence number is centred in. Measured from the top left of the trim box.',
    usedBy: 'Print file composition: the sequence number printed on the first page of each mailpiece, for the enclosing machine camera.',
    appliesTo: 'Next print file composed. Files already made are not changed.',
  },
  {
    key: 'markSeqTopMm', column: 'mark_seq_top_mm', group: 'Sequence number', label: 'Top', type: 'number', unit: 'mm', min: 0, max: 400, step: 0.1,
    description: 'Top edge of the box the sequence number is centred in. Measured from the top left of the trim box.',
    usedBy: 'Print file composition: the sequence number printed on the first page of each mailpiece, for the enclosing machine camera.',
    appliesTo: 'Next print file composed. Files already made are not changed.',
  },
  {
    key: 'markSeqWidthMm', column: 'mark_seq_width_mm', group: 'Sequence number', label: 'Box width', type: 'number', unit: 'mm', min: 0.1, max: 400, step: 0.1,
    description: 'Width of the box the sequence number is centred in.',
    usedBy: 'Print file composition: the sequence number printed on the first page of each mailpiece, for the enclosing machine camera.',
    appliesTo: 'Next print file composed. Files already made are not changed.',
  },
  {
    key: 'markSeqHeightMm', column: 'mark_seq_height_mm', group: 'Sequence number', label: 'Box height', type: 'number', unit: 'mm', min: 0.1, max: 400, step: 0.1,
    description: 'Height of the box the sequence number is centred in.',
    usedBy: 'Print file composition: the sequence number printed on the first page of each mailpiece, for the enclosing machine camera.',
    appliesTo: 'Next print file composed. Files already made are not changed.',
  },
  {
    key: 'markDmLeftMm', column: 'mark_dm_left_mm', group: 'Data Matrix', label: 'Left', type: 'number', unit: 'mm', min: 0, max: 400, step: 0.1,
    description: 'Left edge of the Data Matrix. Measured from the top left of the trim box.',
    usedBy: 'Print file composition: the Data Matrix printed on the first page of each mailpiece.',
    appliesTo: 'Next print file composed. Files already made are not changed.',
  },
  {
    key: 'markDmTopMm', column: 'mark_dm_top_mm', group: 'Data Matrix', label: 'Top', type: 'number', unit: 'mm', min: 0, max: 400, step: 0.1,
    description: 'Top edge of the Data Matrix. Measured from the top left of the trim box.',
    usedBy: 'Print file composition: the Data Matrix printed on the first page of each mailpiece.',
    appliesTo: 'Next print file composed. Files already made are not changed.',
  },
  {
    key: 'markDmWidthMm', column: 'mark_dm_width_mm', group: 'Data Matrix', label: 'Width', type: 'number', unit: 'mm', min: 0.1, max: 400, step: 0.1,
    description: 'The code is square and is fitted inside the smaller of its width and height.',
    usedBy: 'Print file composition: the Data Matrix printed on the first page of each mailpiece.',
    appliesTo: 'Next print file composed. Files already made are not changed.',
  },
  {
    key: 'markDmHeightMm', column: 'mark_dm_height_mm', group: 'Data Matrix', label: 'Height', type: 'number', unit: 'mm', min: 0.1, max: 400, step: 0.1,
    description: 'The code is square and is fitted inside the smaller of its width and height.',
    usedBy: 'Print file composition: the Data Matrix printed on the first page of each mailpiece.',
    appliesTo: 'Next print file composed. Files already made are not changed.',
  },
  {
    key: 'markDotXMm', column: 'mark_dot_x_mm', group: 'Pack start dot', label: 'Centre across', type: 'number', unit: 'mm', min: 0, max: 400, step: 0.1,
    description: 'Distance of the dot centre from the left of the trim box.',
    usedBy: 'Print file composition: the dot printed on the first page of each mailpiece that marks where a pack starts.',
    appliesTo: 'Next print file composed. Files already made are not changed.',
  },
  {
    key: 'markDotYMm', column: 'mark_dot_y_mm', group: 'Pack start dot', label: 'Centre down', type: 'number', unit: 'mm', min: 0, max: 400, step: 0.1,
    description: 'Distance of the dot centre from the top of the trim box.',
    usedBy: 'Print file composition: the dot printed on the first page of each mailpiece that marks where a pack starts.',
    appliesTo: 'Next print file composed. Files already made are not changed.',
  },
  {
    key: 'markDotDiameterMm', column: 'mark_dot_diameter_mm', group: 'Pack start dot', label: 'Diameter', type: 'number', unit: 'mm', min: 0.1, max: 50, step: 0.1,
    description: 'Diameter of the dot. It is red, or black when the page is printed mono.',
    usedBy: 'Print file composition: the dot printed on the first page of each mailpiece that marks where a pack starts.',
    appliesTo: 'Next print file composed. Files already made are not changed.',
  },
  {
    key: 'mrdfDmLeftMm', column: 'mrdf_dm_left_mm', group: 'MRDF page codes', label: 'Data Matrix: left', type: 'number', unit: 'mm', min: 0, max: 400, step: 0.1,
    description: 'Left edge of the MRDF Data Matrix. Measured from the top left of the trim box.',
    usedBy: 'Print file composition: the MRDF codes printed on the front of every sheet for customers that use MRDF, read by the Bluecrest inserter.',
    appliesTo: 'Next print file composed. Files already made are not changed.',
  },
  {
    key: 'mrdfDmTopMm', column: 'mrdf_dm_top_mm', group: 'MRDF page codes', label: 'Data Matrix: top', type: 'number', unit: 'mm', min: 0, max: 400, step: 0.1,
    description: 'Top edge of the MRDF Data Matrix. Measured from the top left of the trim box.',
    usedBy: 'Print file composition: the MRDF codes printed on the front of every sheet for customers that use MRDF, read by the Bluecrest inserter.',
    appliesTo: 'Next print file composed. Files already made are not changed.',
  },
  {
    key: 'mrdfDmWidthMm', column: 'mrdf_dm_width_mm', group: 'MRDF page codes', label: 'Data Matrix: box width', type: 'number', unit: 'mm', min: 0.1, max: 400, step: 0.1,
    description: 'Width of the box the MRDF Data Matrix is fitted in (the code is square, so the smaller of width and height is used).',
    usedBy: 'Print file composition: the MRDF codes printed on the front of every sheet for customers that use MRDF, read by the Bluecrest inserter.',
    appliesTo: 'Next print file composed. Files already made are not changed.',
  },
  {
    key: 'mrdfDmHeightMm', column: 'mrdf_dm_height_mm', group: 'MRDF page codes', label: 'Data Matrix: box height', type: 'number', unit: 'mm', min: 0.1, max: 400, step: 0.1,
    description: 'Height of the box the MRDF Data Matrix is fitted in.',
    usedBy: 'Print file composition: the MRDF codes printed on the front of every sheet for customers that use MRDF, read by the Bluecrest inserter.',
    appliesTo: 'Next print file composed. Files already made are not changed.',
  },
  {
    key: 'mrdfOcrFontPt', column: 'mrdf_ocr_font_pt', group: 'MRDF page codes', label: 'OCR code: font size', type: 'number', unit: 'pt', min: 1, max: 72, step: 0.1,
    description: 'Size of the MRDF OCR code text (OCR-B), e.g. 01020001234. FileMaker used 8.2.',
    usedBy: 'Print file composition: the MRDF codes printed on the front of every sheet for customers that use MRDF, read by the Bluecrest inserter.',
    appliesTo: 'Next print file composed. Files already made are not changed.',
  },
  {
    key: 'mrdfOcrLeftMm', column: 'mrdf_ocr_left_mm', group: 'MRDF page codes', label: 'OCR code: left', type: 'number', unit: 'mm', min: 0, max: 400, step: 0.1,
    description: 'Left edge of the box the OCR code is centred in. Measured from the top left of the trim box.',
    usedBy: 'Print file composition: the MRDF codes printed on the front of every sheet for customers that use MRDF, read by the Bluecrest inserter.',
    appliesTo: 'Next print file composed. Files already made are not changed.',
  },
  {
    key: 'mrdfOcrTopMm', column: 'mrdf_ocr_top_mm', group: 'MRDF page codes', label: 'OCR code: top', type: 'number', unit: 'mm', min: 0, max: 400, step: 0.1,
    description: 'Top edge of the box the OCR code is centred in.',
    usedBy: 'Print file composition: the MRDF codes printed on the front of every sheet for customers that use MRDF, read by the Bluecrest inserter.',
    appliesTo: 'Next print file composed. Files already made are not changed.',
  },
  {
    key: 'mrdfOcrWidthMm', column: 'mrdf_ocr_width_mm', group: 'MRDF page codes', label: 'OCR code: box width', type: 'number', unit: 'mm', min: 0.1, max: 400, step: 0.1,
    description: 'Width of the box the OCR code is centred in.',
    usedBy: 'Print file composition: the MRDF codes printed on the front of every sheet for customers that use MRDF, read by the Bluecrest inserter.',
    appliesTo: 'Next print file composed. Files already made are not changed.',
  },
  {
    key: 'mrdfOcrHeightMm', column: 'mrdf_ocr_height_mm', group: 'MRDF page codes', label: 'OCR code: box height', type: 'number', unit: 'mm', min: 0.1, max: 400, step: 0.1,
    description: 'Height of the box the OCR code is centred in.',
    usedBy: 'Print file composition: the MRDF codes printed on the front of every sheet for customers that use MRDF, read by the Bluecrest inserter.',
    appliesTo: 'Next print file composed. Files already made are not changed.',
  },
];

/** Groups whose settings are labelled without the group's name (the heading says it): Left under Sequence number, Left under Data Matrix. */
const NAMED_BY_GROUP = new Set<string>(['Sequence number', 'Data Matrix', 'Pack start dot']);
/** The setting's full name, for messages and the change log, where the heading is not there to say which "Left" it is: "Sequence number: left". */
export function nameOf(def: SettingDef): string {
  return NAMED_BY_GROUP.has(def.group) ? `${def.group}: ${def.label.charAt(0).toLowerCase()}${def.label.slice(1)}` : def.label;
}

export const BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

export function parseEmails(text: string): string[] {
  return text.split(/[;,\s]+/).map((x) => x.trim()).filter(Boolean);
}

/** Returns the cleaned value, or an error message. `options` are the allowed values of a select. */
export function validate(def: SettingDef, raw: unknown, options?: string[]): { value: SettingValue } | { error: string } {
  switch (def.type) {
    case 'boolean':
      return typeof raw === 'boolean' ? { value: raw } : { error: `${nameOf(def)} must be on or off` };
    case 'number':
    case 'integer': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return { error: `${nameOf(def)} must be a number` };
      if (def.type === 'integer' && !Number.isInteger(raw)) return { error: `${nameOf(def)} must be a whole number` };
      if (def.min !== undefined && raw < def.min) return { error: `${nameOf(def)} must be at least ${def.min}` };
      if (def.max !== undefined && raw > def.max) return { error: `${nameOf(def)} must be at most ${def.max}` };
      return { value: raw };
    }
    case 'select':
      if (typeof raw !== 'string') return { error: `${nameOf(def)} must be one of the listed values` };
      return !options || options.includes(raw) ? { value: raw } : { error: `${nameOf(def)} must be one of: ${options.join(', ')}` };
    case 'emails': {
      if (typeof raw !== 'string') return { error: `${nameOf(def)} must be text` };
      const list = parseEmails(raw);
      const bad = list.filter((e) => !EMAIL.test(e));
      if (bad.length) return { error: `Not an e-mail address: ${bad.join(', ')}` };
      return { value: list.join(', ') };
    }
  }
}
