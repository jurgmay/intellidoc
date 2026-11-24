/**
 * Every setting in idoc.settings, with what it means and where the app uses it.
 * The web page is generated from this list, so the explanation shown next to a setting is the one that lives next to the code.
 */
export type SettingValue = number | boolean | string;
export type SettingType = 'number' | 'integer' | 'boolean' | 'select' | 'emails' | 'text' | 'email' | 'url' | 'secret';

export interface SettingDef {
  key: string;
  column: string;
  group: string;
  label: string;
  type: SettingType;
  unit?: string;
  min?: number;
  max?: number;
  /** A number that may only be one of these (shown as a drop-down). */
  allowed?: number[];
  step?: number;
  description: string;
  /** Where the app uses it, in plain words. */
  usedBy: string;
  /** What "applies" means: when a change takes effect. */
  appliesTo: string;
}

export const GROUPS = ['Weights and sizes', 'Enclosing', 'PDF and alerts', 'Print production settings', 'Page size', 'Envelope window', 'Sequence number', 'Data Matrix', 'Pack start dot', 'MRDF OCR code', 'MRDF Data Matrix', 'Network access', 'Workflow server', 'IntelliDoc folders', 'Bluecrest File-Based folders', 'Postal docketing', 'Email settings', 'H-POD API settings'] as const;

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
    key: 'smallBatchLimit', column: 'small_batch_limit', group: 'Enclosing', label: 'Small batch adjustment: batches of fewer than', type: 'integer', unit: 'mailpieces', min: 0, max: 100000,
    description: 'A batch with fewer mailpieces than this carries the customer\'s small batch adjustment (a sell price only). 0 turns the adjustment off.',
    usedBy: 'Pricing: each mailpiece in a small batch gets the small batch adjustment line.',
    appliesTo: 'Mail priced from now on; mail already priced keeps its price until "Price mail again".',
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
    key: 'pageWidthMm', column: 'page_width_mm', group: 'Page size', label: 'Width', type: 'number', unit: 'mm', min: 50, max: 1000, step: 0.1,
    description: 'Width of the page the marks are measured on. A4 is 210 mm. Rarely needs to change.',
    usedBy: 'Marks preview: the size of the page drawn. Print file composition: the size of a blank page when there is no page before it to copy a size from (normally a blank copies the page before it). Pages copied from the customer PDF keep their own size.',
    appliesTo: 'Next print file composed, and the next preview.',
  },
  {
    key: 'pageHeightMm', column: 'page_height_mm', group: 'Page size', label: 'Height', type: 'number', unit: 'mm', min: 50, max: 1000, step: 0.1,
    description: 'Height of the page the marks are measured on. A4 is 297 mm. Rarely needs to change.',
    usedBy: 'Marks preview: the size of the page drawn. Print file composition: the size of a blank page when there is no page before it to copy a size from (normally a blank copies the page before it). Pages copied from the customer PDF keep their own size.',
    appliesTo: 'Next print file composed, and the next preview.',
  },
  {
    key: 'windowLeftMm', column: 'window_left_mm', group: 'Envelope window', label: 'Left', type: 'number', unit: 'mm', min: 0, max: 400, step: 0.1,
    description: 'Left edge of the address window, where it lies over the letter once folded and enclosed. Measured from the top left of the trim box.',
    usedBy: 'Marks preview on the Control marks tab: the window is drawn so you can see the marks sit inside it. The print files do not use it.',
    appliesTo: 'Immediately, in the next preview. Print files are not affected.',
  },
  {
    key: 'windowTopMm', column: 'window_top_mm', group: 'Envelope window', label: 'Top', type: 'number', unit: 'mm', min: 0, max: 400, step: 0.1,
    description: 'Top edge of the address window. Measured from the top left of the trim box.',
    usedBy: 'Marks preview on the Control marks tab: the window is drawn so you can see the marks sit inside it. The print files do not use it.',
    appliesTo: 'Immediately, in the next preview. Print files are not affected.',
  },
  {
    key: 'windowWidthMm', column: 'window_width_mm', group: 'Envelope window', label: 'Width', type: 'number', unit: 'mm', min: 0.1, max: 400, step: 0.1,
    description: 'Width of the address window.',
    usedBy: 'Marks preview on the Control marks tab: the window is drawn so you can see the marks sit inside it. The print files do not use it.',
    appliesTo: 'Immediately, in the next preview. Print files are not affected.',
  },
  {
    key: 'windowHeightMm', column: 'window_height_mm', group: 'Envelope window', label: 'Height', type: 'number', unit: 'mm', min: 0.1, max: 400, step: 0.1,
    description: 'Height of the address window.',
    usedBy: 'Marks preview on the Control marks tab: the window is drawn so you can see the marks sit inside it. The print files do not use it.',
    appliesTo: 'Immediately, in the next preview. Print files are not affected.',
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
    key: 'mrdfDmLeftMm', column: 'mrdf_dm_left_mm', group: 'MRDF Data Matrix', label: 'Left', type: 'number', unit: 'mm', min: 0, max: 400, step: 0.1,
    description: 'Left edge of the MRDF Data Matrix. Measured from the top left of the trim box.',
    usedBy: 'Print file composition: the MRDF codes printed on the front of every sheet for customers that use MRDF, read by the Bluecrest inserter.',
    appliesTo: 'Next print file composed. Files already made are not changed.',
  },
  {
    key: 'mrdfDmTopMm', column: 'mrdf_dm_top_mm', group: 'MRDF Data Matrix', label: 'Top', type: 'number', unit: 'mm', min: 0, max: 400, step: 0.1,
    description: 'Top edge of the MRDF Data Matrix. Measured from the top left of the trim box.',
    usedBy: 'Print file composition: the MRDF codes printed on the front of every sheet for customers that use MRDF, read by the Bluecrest inserter.',
    appliesTo: 'Next print file composed. Files already made are not changed.',
  },
  {
    key: 'mrdfDmWidthMm', column: 'mrdf_dm_width_mm', group: 'MRDF Data Matrix', label: 'Width', type: 'number', unit: 'mm', min: 0.1, max: 400, step: 0.1,
    description: 'Width of the box the MRDF Data Matrix is fitted in (the code is square, so the smaller of width and height is used).',
    usedBy: 'Print file composition: the MRDF codes printed on the front of every sheet for customers that use MRDF, read by the Bluecrest inserter.',
    appliesTo: 'Next print file composed. Files already made are not changed.',
  },
  {
    key: 'mrdfDmHeightMm', column: 'mrdf_dm_height_mm', group: 'MRDF Data Matrix', label: 'Height', type: 'number', unit: 'mm', min: 0.1, max: 400, step: 0.1,
    description: 'Height of the box the MRDF Data Matrix is fitted in.',
    usedBy: 'Print file composition: the MRDF codes printed on the front of every sheet for customers that use MRDF, read by the Bluecrest inserter.',
    appliesTo: 'Next print file composed. Files already made are not changed.',
  },
  {
    key: 'mrdfOcrFontPt', column: 'mrdf_ocr_font_pt', group: 'MRDF OCR code', label: 'Font size', type: 'number', unit: 'pt', min: 1, max: 72, step: 0.1,
    description: 'Size of the MRDF OCR code text (OCR-B), e.g. 01020001234. FileMaker used 8.2.',
    usedBy: 'Print file composition: the MRDF codes printed on the front of every sheet for customers that use MRDF, read by the Bluecrest inserter.',
    appliesTo: 'Next print file composed. Files already made are not changed.',
  },
  {
    key: 'mrdfOcrLeftMm', column: 'mrdf_ocr_left_mm', group: 'MRDF OCR code', label: 'Left', type: 'number', unit: 'mm', min: 0, max: 400, step: 0.1,
    description: 'Left edge of the box the OCR code is centred in. Measured from the top left of the trim box.',
    usedBy: 'Print file composition: the MRDF codes printed on the front of every sheet for customers that use MRDF, read by the Bluecrest inserter.',
    appliesTo: 'Next print file composed. Files already made are not changed.',
  },
  {
    key: 'mrdfOcrTopMm', column: 'mrdf_ocr_top_mm', group: 'MRDF OCR code', label: 'Top', type: 'number', unit: 'mm', min: 0, max: 400, step: 0.1,
    description: 'Top edge of the box the OCR code is centred in.',
    usedBy: 'Print file composition: the MRDF codes printed on the front of every sheet for customers that use MRDF, read by the Bluecrest inserter.',
    appliesTo: 'Next print file composed. Files already made are not changed.',
  },
  {
    key: 'mrdfOcrWidthMm', column: 'mrdf_ocr_width_mm', group: 'MRDF OCR code', label: 'Box width', type: 'number', unit: 'mm', min: 0.1, max: 400, step: 0.1,
    description: 'Width of the box the OCR code is centred in.',
    usedBy: 'Print file composition: the MRDF codes printed on the front of every sheet for customers that use MRDF, read by the Bluecrest inserter.',
    appliesTo: 'Next print file composed. Files already made are not changed.',
  },
  {
    key: 'mrdfOcrHeightMm', column: 'mrdf_ocr_height_mm', group: 'MRDF OCR code', label: 'Box height', type: 'number', unit: 'mm', min: 0.1, max: 400, step: 0.1,
    description: 'Height of the box the OCR code is centred in.',
    usedBy: 'Print file composition: the MRDF codes printed on the front of every sheet for customers that use MRDF, read by the Bluecrest inserter.',
    appliesTo: 'Next print file composed. Files already made are not changed.',
  },
  {
    key: 'mrdfOcrRotationDeg', column: 'mrdf_ocr_rotation_deg', group: 'MRDF OCR code', label: 'Rotation', type: 'integer', unit: '°', allowed: [0, 90, 180, 270],
    description: 'Turns the OCR code clockwise about the centre of its box: 0 reads left to right, 90 reads downwards, 180 upside down, 270 upwards. The box is the area the code occupies on the page and stays as you set it, so for 90 or 270 make it tall and narrow; the text is centred in it.',
    usedBy: 'Print file composition: the MRDF codes printed on the front of every sheet for customers that use MRDF, read by the Bluecrest inserter.',
    appliesTo: 'Next print file composed. Files already made are not changed.',
  },
  {
    key: 'networkUsername', column: 'network_username', group: 'Network access', label: 'Username', type: 'text',
    description: 'The account the app signs in to the network shares with.',
    usedBy: 'Nothing reads it yet: it is kept here so the watcher and the app can take it from one place.',
    appliesTo: 'Saved immediately. Nothing changes until a part of the app starts reading it.',
  },
  {
    key: 'networkPassword', column: 'network_password', group: 'Network access', label: 'Password', type: 'secret',
    description: 'The password for the username above. It is stored encrypted and is never shown again: type a new one to replace it, or use Remove to clear it.',
    usedBy: 'Nothing reads it yet. When something does, it reads it on the server; it is never sent to a browser.',
    appliesTo: 'Saved immediately. Needs INTELLIDOC_SECRET_KEY in the API\'s .env file.',
  },
  {
    key: 'workflowNetworkPath', column: 'workflow_network_path', group: 'Workflow server', label: 'Network path', type: 'text',
    description: 'Network path of the workflow server, e.g. \\\\server.',
    usedBy: 'Nothing reads it yet: it is kept here so the watcher and the app can take it from one place.',
    appliesTo: 'Saved immediately. Nothing changes until a part of the app starts reading it.',
  },
  {
    key: 'workflowSharedFolder', column: 'workflow_shared_folder', group: 'Workflow server', label: 'Shared folder', type: 'text',
    description: 'The shared folder on the workflow server.',
    usedBy: 'Nothing reads it yet: it is kept here so the watcher and the app can take it from one place.',
    appliesTo: 'Saved immediately. Nothing changes until a part of the app starts reading it.',
  },
  {
    key: 'folderIn', column: 'folder_in', group: 'IntelliDoc folders', label: '\'In\' folder', type: 'text',
    description: 'Folder the customers\' files arrive in (XML and PDF).',
    usedBy: 'Nothing reads it yet: it is kept here so the watcher and the app can take it from one place.',
    appliesTo: 'Saved immediately. Nothing changes until a part of the app starts reading it.',
  },
  {
    key: 'folderOut', column: 'folder_out', group: 'IntelliDoc folders', label: '\'Out\' folder', type: 'text',
    description: 'Folder the app writes finished output to.',
    usedBy: 'Nothing reads it yet: it is kept here so the watcher and the app can take it from one place.',
    appliesTo: 'Saved immediately. Nothing changes until a part of the app starts reading it.',
  },
  {
    key: 'folderHold', column: 'folder_hold', group: 'IntelliDoc folders', label: '\'Hold\' folder', type: 'text',
    description: 'Folder files are put in when they are held back.',
    usedBy: 'Nothing reads it yet: it is kept here so the watcher and the app can take it from one place.',
    appliesTo: 'Saved immediately. Nothing changes until a part of the app starts reading it.',
  },
  {
    key: 'folderPrintFiles', column: 'folder_print_files', group: 'IntelliDoc folders', label: 'Print files folder', type: 'text',
    description: 'Folder the composed print PDFs are written to.',
    usedBy: 'Nothing reads it yet: it is kept here so the watcher and the app can take it from one place.',
    appliesTo: 'Saved immediately. Nothing changes until a part of the app starts reading it.',
  },
  {
    key: 'folderProcessed', column: 'folder_processed', group: 'IntelliDoc folders', label: 'Processed files folder', type: 'text',
    description: 'Folder files are moved to once they have been processed.',
    usedBy: 'Nothing reads it yet: it is kept here so the watcher and the app can take it from one place.',
    appliesTo: 'Saved immediately. Nothing changes until a part of the app starts reading it.',
  },
  {
    key: 'bluecrestNetworkPath', column: 'bluecrest_network_path', group: 'Bluecrest File-Based folders', label: 'Network path', type: 'text',
    description: 'Network path of the Bluecrest file-based system.',
    usedBy: 'Nothing reads it yet: it is kept here so the watcher and the app can take it from one place.',
    appliesTo: 'Saved immediately. Nothing changes until a part of the app starts reading it.',
  },
  {
    key: 'bluecrestInputFolder', column: 'bluecrest_input_folder', group: 'Bluecrest File-Based folders', label: '\'Input\' folder', type: 'text',
    description: 'The Bluecrest \'Input\' folder.',
    usedBy: 'Nothing reads it yet: it is kept here so the watcher and the app can take it from one place.',
    appliesTo: 'Saved immediately. Nothing changes until a part of the app starts reading it.',
  },
  {
    key: 'bluecrestOutputFolder', column: 'bluecrest_output_folder', group: 'Bluecrest File-Based folders', label: '\'Output\' folder', type: 'text',
    description: 'The Bluecrest \'Output\' folder.',
    usedBy: 'Nothing reads it yet: it is kept here so the watcher and the app can take it from one place.',
    appliesTo: 'Saved immediately. Nothing changes until a part of the app starts reading it.',
  },
  {
    key: 'bluecrestLockFolder', column: 'bluecrest_lock_folder', group: 'Bluecrest File-Based folders', label: '\'Lock\' folder', type: 'text',
    description: 'The Bluecrest \'Lock\' folder.',
    usedBy: 'Nothing reads it yet: it is kept here so the watcher and the app can take it from one place.',
    appliesTo: 'Saved immediately. Nothing changes until a part of the app starts reading it.',
  },
  {
    key: 'bluecrestSelectFolder', column: 'bluecrest_select_folder', group: 'Bluecrest File-Based folders', label: '\'Select\' folder', type: 'text',
    description: 'The Bluecrest \'Select\' folder.',
    usedBy: 'Nothing reads it yet: it is kept here so the watcher and the app can take it from one place.',
    appliesTo: 'Saved immediately. Nothing changes until a part of the app starts reading it.',
  },
  {
    key: 'bluecrestArchiveName', column: 'bluecrest_archive_name', group: 'Bluecrest File-Based folders', label: 'Archive name', type: 'text',
    description: 'Name of the Bluecrest archive.',
    usedBy: 'Nothing reads it yet: it is kept here so the watcher and the app can take it from one place.',
    appliesTo: 'Saved immediately. Nothing changes until a part of the app starts reading it.',
  },
  {
    key: 'docketsFolder', column: 'dockets_folder', group: 'Postal docketing', label: 'Postal dockets folder', type: 'text',
    description: 'Folder the postal dockets are kept in.',
    usedBy: 'Nothing reads it yet: it is kept here so the watcher and the app can take it from one place.',
    appliesTo: 'Saved immediately. Nothing changes until a part of the app starts reading it.',
  },
  {
    key: 'docketsSignedForFolder', column: 'dockets_signed_for_folder', group: 'Postal docketing', label: '\'Signed for\' data folder', type: 'text',
    description: 'Folder the \'Signed for\' data is kept in.',
    usedBy: 'Nothing reads it yet: it is kept here so the watcher and the app can take it from one place.',
    appliesTo: 'Saved immediately. Nothing changes until a part of the app starts reading it.',
  },
  {
    key: 'emailEnabled', column: 'email_enabled', group: 'Email settings', label: 'Send e-mail', type: 'boolean',
    description: 'Master switch for e-mail sent by IntelliDoc. Off keeps every e-mail from being sent. The test button on this tab sends one whatever this says, so you can check the settings first.',
    usedBy: 'Nothing reads it yet: the watcher and the run sheet e-mail still use the SMTP_* lines in their .env files.',
    appliesTo: 'Saved immediately. Nothing changes until a part of the app starts reading it.',
  },
  {
    key: 'smtpFromName', column: 'smtp_from_name', group: 'Email settings', label: 'SMTP \'from\' name', type: 'text',
    description: 'The name e-mails show as the sender, e.g. IntelliDoc.',
    usedBy: 'The test e-mail button; the other e-mails will take it later.',
    appliesTo: 'Saved immediately. Nothing changes until a part of the app starts reading it.',
  },
  {
    key: 'smtpFromAddress', column: 'smtp_from_address', group: 'Email settings', label: 'SMTP \'from\' address', type: 'email',
    description: 'The address e-mails are sent from. The mail server may insist it is one the SMTP user is allowed to send as.',
    usedBy: 'The test e-mail button; the other e-mails will take it later.',
    appliesTo: 'Saved immediately. Nothing changes until a part of the app starts reading it.',
  },
  {
    key: 'smtpReplyTo', column: 'smtp_reply_to', group: 'Email settings', label: 'SMTP \'reply to\'', type: 'email',
    description: 'Where replies go, if not to the \'from\' address. Leave empty to use the \'from\' address.',
    usedBy: 'The test e-mail button; the other e-mails will take it later.',
    appliesTo: 'Saved immediately. Nothing changes until a part of the app starts reading it.',
  },
  {
    key: 'smtpServer', column: 'smtp_server', group: 'Email settings', label: 'SMTP server', type: 'text',
    description: 'Host name of the mail server, e.g. smtp.office365.com.',
    usedBy: 'The test e-mail button; the other e-mails will take it later.',
    appliesTo: 'Saved immediately. Nothing changes until a part of the app starts reading it.',
  },
  {
    key: 'smtpPort', column: 'smtp_port', group: 'Email settings', label: 'SMTP port', type: 'integer', unit: 'port', min: 1, max: 65535,
    description: 'Port of the mail server. 587 (STARTTLS) is usual; 465 uses TLS from the start; 25 is plain.',
    usedBy: 'The test e-mail button; the other e-mails will take it later.',
    appliesTo: 'Saved immediately. Nothing changes until a part of the app starts reading it.',
  },
  {
    key: 'smtpUsername', column: 'smtp_username', group: 'Email settings', label: 'SMTP username', type: 'text',
    description: 'The user to sign in to the mail server with. Leave empty if the server needs no sign-in.',
    usedBy: 'The test e-mail button; the other e-mails will take it later.',
    appliesTo: 'Saved immediately. Nothing changes until a part of the app starts reading it.',
  },
  {
    key: 'smtpPassword', column: 'smtp_password', group: 'Email settings', label: 'SMTP password', type: 'secret',
    description: 'The password for the SMTP username. It is stored encrypted and is never shown again: type a new one to replace it, or use Remove to clear it.',
    usedBy: 'The test e-mail button; the other e-mails will take it later. It is read on the server only and never sent to a browser.',
    appliesTo: 'Saved immediately. Nothing changes until a part of the app starts reading it.',
  },
  {
    key: 'hpodEndpoint', column: 'hpod_endpoint', group: 'H-POD API settings', label: 'Endpoint', type: 'url',
    description: 'The web address of the H-POD API, starting http:// or https://. A bare address such as https://api-uk.h-pod.co.uk gets /v3 added.',
    usedBy: 'The H-POD page and the test button on this tab.',
    appliesTo: 'Saved immediately. The H-POD page signs in again with the new details.',
  },
  {
    key: 'hpodInstance', column: 'hpod_instance', group: 'H-POD API settings', label: 'Instance', type: 'text',
    description: 'The H-POD instance to sign in to. Ask your H-POD provider for it.',
    usedBy: 'The H-POD page and the test button on this tab.',
    appliesTo: 'Saved immediately. The H-POD page signs in again with the new details.',
  },
  {
    key: 'hpodAccountCode', column: 'hpod_account_code', group: 'H-POD API settings', label: 'Account code', type: 'text',
    description: 'The "login" value of the H-POD account to sign in to.',
    usedBy: 'The H-POD page and the test button on this tab.',
    appliesTo: 'Saved immediately. The H-POD page signs in again with the new details.',
  },
  {
    key: 'hpodUsername', column: 'hpod_username', group: 'H-POD API settings', label: 'Username', type: 'text',
    description: 'The e-mail address of the H-POD user to sign in as.',
    usedBy: 'The H-POD page and the test button on this tab.',
    appliesTo: 'Saved immediately. The H-POD page signs in again with the new details.',
  },
  {
    key: 'hpodPassword', column: 'hpod_password', group: 'H-POD API settings', label: 'Password', type: 'secret',
    description: 'The password for the H-POD user. It is stored encrypted and is never shown again: type a new one to replace it, or use Remove to clear it.',
    usedBy: 'The H-POD page and the test button on this tab. It is read on the server only and never sent to a browser.',
    appliesTo: 'Saved immediately. The H-POD page signs in again with the new details.',
  },
];

/** Groups whose settings are labelled without the group's name (the heading says it): Width under Page size, Left under Envelope window, Left under Sequence number, Left under Data Matrix. */
const NAMED_BY_GROUP = new Set<string>(['H-POD API settings', 'Network access', 'Workflow server', 'Bluecrest File-Based folders', 'Page size', 'Envelope window', 'Sequence number', 'Data Matrix', 'Pack start dot']);
/** The setting's full name, for messages and the change log, where the heading is not there to say which "Left" it is: "Sequence number: left". */
export function nameOf(def: SettingDef): string {
  return NAMED_BY_GROUP.has(def.group) ? `${def.group}: ${def.label.charAt(0).toLowerCase()}${def.label.slice(1)}` : def.label;
}

export const BY_KEY = new Map(SETTINGS.map((s) => [s.key, s]));

/** Longest folder path or name, and longest password. */
const MAX_TEXT = 500, MAX_SECRET = 200;

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
      if (def.allowed && !def.allowed.includes(raw)) return { error: `${nameOf(def)} must be one of: ${def.allowed.join(', ')}` };
      if (def.max !== undefined && raw > def.max) return { error: `${nameOf(def)} must be at most ${def.max}` };
      return { value: raw };
    }
    case 'select':
      if (typeof raw !== 'string') return { error: `${nameOf(def)} must be one of the listed values` };
      return !options || options.includes(raw) ? { value: raw } : { error: `${nameOf(def)} must be one of: ${options.join(', ')}` };
    case 'text': {
      if (typeof raw !== 'string') return { error: `${nameOf(def)} must be text` };
      const t = raw.trim();
      if (t.length > MAX_TEXT) return { error: `${nameOf(def)} must be at most ${MAX_TEXT} characters` };
      if (/[\u0000-\u001f]/.test(t)) return { error: `${nameOf(def)} cannot contain line breaks or control characters` };
      return { value: t };
    }
    case 'email': {
      if (typeof raw !== 'string') return { error: `${nameOf(def)} must be text` };
      const t = raw.trim();
      return t === '' || EMAIL.test(t) ? { value: t } : { error: `${nameOf(def)}: not an e-mail address: ${t}` };
    }
    case 'url': {
      if (typeof raw !== 'string') return { error: `${nameOf(def)} must be text` };
      const t = raw.trim();
      if (t === '') return { value: t };
      if (t.length > MAX_TEXT) return { error: `${nameOf(def)} must be at most ${MAX_TEXT} characters` };
      try { const u = new URL(t); if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('scheme'); } catch { return { error: `${nameOf(def)} must be a web address starting http:// or https://` }; }
      return { value: t };
    }
    case 'secret': {
      if (typeof raw !== 'string' || raw === '') return { error: `${nameOf(def)} must be text (use Remove to clear it)` };
      if (raw.length > MAX_SECRET) return { error: `${nameOf(def)} must be at most ${MAX_SECRET} characters` };
      return { value: raw };
    }
    case 'emails': {
      if (typeof raw !== 'string') return { error: `${nameOf(def)} must be text` };
      const list = parseEmails(raw);
      const bad = list.filter((e) => !EMAIL.test(e));
      if (bad.length) return { error: `Not an e-mail address: ${bad.join(', ')}` };
      return { value: list.join(', ') };
    }
  }
}
