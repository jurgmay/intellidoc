import { NotFoundError } from '../errors.js';
import type { SearchScope } from '../recipients/types.js';
import type { BatchQuery, BatchResult, BatchRow, BatchStore } from './types.js';

export interface MemoryBatch extends BatchRow {
  /** The accounts the batch's mailpieces were submitted from, and every account above them: a search in any of these finds the batch. */
  ancestors: number[];
}

/** In-memory batch search for the stub server and the tests; the same rules as the SQL. */
export class MemoryBatchStore implements BatchStore {
  scopeList: SearchScope[] = [];
  batches: MemoryBatch[] = [];

  async search(q: BatchQuery): Promise<BatchResult> {
    const scope = this.scopeList.find((s) => s.id === q.accountId);
    if (!scope) throw new NotFoundError('That account does not exist.');
    const hits = this.batches
      .filter((b) => b.ancestors.includes(q.accountId))
      .filter((b) => q.code === null || b.batchCode === q.code)
      .filter((b) => !q.status || b.status === q.status)
      .filter((b) => !q.job || b.job.toLowerCase().includes(q.job.toLowerCase()))
      .filter((b) => !q.from || b.createdAt.slice(0, 10) >= q.from)
      .filter((b) => !q.to || b.createdAt.slice(0, 10) <= q.to)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.batchId - a.batchId);
    const rows = hits.slice(0, q.limit).map(({ ancestors: _a, ...row }) => row);
    return { scope: { id: scope.id, label: scope.label }, rows, truncated: hits.length > q.limit };
  }
}
