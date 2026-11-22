export const JOB_STATUSES = ['Received', 'Awaiting PDF', 'PDF Rejected'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export interface JobRow {
  id: number; customerCode: string; customerName: string; baseName: string; pdfFileName: string;
  /** When the job was received (ISO, UTC). */
  receivedAt: string; status: JobStatus; packCount: number | null; pageCount: number | null; pdfError: string | null;
  batchCount: number;
  /** Batches that have print files. */
  composedBatchCount: number;
}
export interface JobFile { fileName: string; segment: number; mailpieces: number; pages: number }
export interface JobBatch { id: number; batchCode: number; status: string; mailpieceCount: number; files: JobFile[] }
export interface JobDetail extends JobRow { batches: JobBatch[] }

export interface JobQuery { search: string | null; status: JobStatus | null; limit: number }

export interface JobStore {
  list(q: JobQuery): Promise<JobRow[]>;
  get(id: number): Promise<JobDetail>;
}

export interface ComposeBatchResult { batchCode: number; files: string[]; mrdfFile: string | null; skipped: string | null }

/** Makes the print files of a job. The real one reads the PDF the watcher kept and writes to the print folders; tests use a stand-in. */
export interface JobComposer {
  /** Why print files cannot be made on this server (a folder is not set up), or null when they can. */
  unavailable(): string | null;
  /** Throws an Error whose message is fit to show the user (PDF missing, job not ready, ...). */
  compose(jobId: number, onlyNew: boolean): Promise<ComposeBatchResult[]>;
}

export interface JobDeps { store: JobStore; composer: JobComposer }
