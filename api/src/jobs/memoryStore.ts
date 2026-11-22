import { NotFoundError } from '../errors.js';
import type { ComposeBatchResult, JobComposer, JobDetail, JobQuery, JobStore } from './types.js';

/** For tests and the stub server. */
export class MemoryJobStore implements JobStore {
  jobs: JobDetail[] = [];
  async list(q: JobQuery): Promise<JobDetail[]> {
    const s = q.search?.toLowerCase();
    return this.jobs
      .filter((j) => (!s || [j.customerCode, j.customerName, j.baseName].some((v) => v.toLowerCase().includes(s))) && (!q.status || j.status === q.status))
      .sort((a, b) => b.id - a.id).slice(0, q.limit);
  }
  async get(id: number): Promise<JobDetail> { const j = this.jobs.find((x) => x.id === id); if (!j) throw new NotFoundError('Job not found'); return j; }
}

export class MemoryJobComposer implements JobComposer {
  reason: string | null = null;
  calls: { jobId: number; onlyNew: boolean }[] = [];
  result: ComposeBatchResult[] = [];
  failWith: string | null = null;
  /** Called while composing; lets a test hold the job open. */
  gate: Promise<void> | null = null;
  unavailable(): string | null { return this.reason; }
  async compose(jobId: number, onlyNew: boolean): Promise<ComposeBatchResult[]> {
    this.calls.push({ jobId, onlyNew });
    if (this.gate) await this.gate;
    if (this.failWith) throw new Error(this.failWith);
    return this.result;
  }
}
