import type { IngestResult } from './types.js';

/** Persistence port. The MSSQL implementation maps onto the idoc.* schema (not included/tested here). */
export interface Repository {
  packExists(guid: string): Promise<boolean>;
  /** Must be atomic: all rows or none. */
  saveJob(result: IngestResult): Promise<void>;
}

/** A job saved without its PDF, as far as the PDF check needs it. */
export interface AwaitingJob {
  jobId: number;
  xmlName: string;
  customerName: string;
  packs: { guid: string; startPage: number; endPage: number; pageCount: number }[];
  /** How many "PDF is late" alerts have been sent for it. */
  alertCount: number;
}
export interface OverdueJob {
  jobId: number;
  baseName: string;
  xmlName: string;
  customerName: string;
  packCount: number;
  expectedPages: number;
  receivedAt: Date;
  minutesWaiting: number;
  alertCount: number;
}

/** XML-first import: jobs waiting for their PDF. */
export interface PdfTracker {
  /** The job saved from `<baseName>.xml` that is still waiting for its PDF (case-insensitive), or null. */
  findAwaitingPdf(baseName: string): Promise<AwaitingJob | null>;
  /** The PDF checked out: status Received. Returns how many alerts had been sent while it was missing. */
  markPdfReceived(jobId: number, pdfPages: number): Promise<{ alertCount: number }>;
  /** The PDF does not match the packs: status 'PDF Rejected' (production must not use it). */
  markPdfRejected(jobId: number, message: string): Promise<void>;
  /** Jobs still waiting after `waitMinutes`, not alerted within the last `reminderMinutes`. */
  listOverdue(waitMinutes: number, reminderMinutes: number): Promise<OverdueJob[]>;
  markAlerted(jobId: number): Promise<void>;
}

export class InMemoryRepository implements Repository, PdfTracker {
  readonly jobs: IngestResult[] = [];
  private guids = new Set<string>();
  async packExists(guid: string): Promise<boolean> { return this.guids.has(guid); }
  /** Test clock for the PDF tracker. */
  now = (): number => Date.now();
  readonly tracked: { jobId: number; result: IngestResult; status: string; savedAt: number; alerts: number; lastAlert: number | null; error?: string }[] = [];
  async saveJob(r: IngestResult): Promise<void> {
    for (const p of r.packs) this.guids.add(p.parsed.guid);
    this.jobs.push(r);
    this.tracked.push({ jobId: this.tracked.length + 1, result: r, status: r.pdfReceived ? 'Received' : 'Awaiting PDF', savedAt: this.now(), alerts: 0, lastAlert: null });
  }
  async findAwaitingPdf(baseName: string): Promise<AwaitingJob | null> {
    const j = this.tracked.find((t) => t.status === 'Awaiting PDF' && t.result.xmlName.replace(/\.xml$/i, '').toLowerCase() === baseName.toLowerCase());
    return j ? { jobId: j.jobId, xmlName: j.result.xmlName, customerName: j.result.packs[0]?.customerCode ?? '',
      packs: j.result.packs.map((p) => ({ guid: p.parsed.guid, startPage: p.parsed.startPage, endPage: p.parsed.endPage, pageCount: p.parsed.pageCount })), alertCount: j.alerts } : null;
  }
  async markPdfReceived(jobId: number, pdfPages: number): Promise<{ alertCount: number }> {
    const j = this.tracked.find((t) => t.jobId === jobId)!; j.status = 'Received'; j.result.pdfPages = pdfPages; j.result.pdfReceived = true;
    return { alertCount: j.alerts };
  }
  async markPdfRejected(jobId: number, message: string): Promise<void> { const j = this.tracked.find((t) => t.jobId === jobId)!; j.status = 'PDF Rejected'; j.error = message; }
  async listOverdue(waitMinutes: number, reminderMinutes: number): Promise<OverdueJob[]> {
    const n = this.now();
    return this.tracked.filter((t) => t.status === 'Awaiting PDF' && n - t.savedAt >= waitMinutes * 60_000 && (t.lastAlert === null || n - t.lastAlert >= reminderMinutes * 60_000))
      .map((t) => ({ jobId: t.jobId, baseName: t.result.xmlName.replace(/\.xml$/i, ''), xmlName: t.result.xmlName, customerName: t.result.packs[0]?.customerCode ?? '',
        packCount: t.result.packs.length, expectedPages: t.result.pdfPages, receivedAt: new Date(t.savedAt), minutesWaiting: Math.floor((n - t.savedAt) / 60_000), alertCount: t.alerts }));
  }
  async markAlerted(jobId: number): Promise<void> { const j = this.tracked.find((t) => t.jobId === jobId)!; j.alerts++; j.lastAlert = this.now(); }
}
