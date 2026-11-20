import type { IngestResult } from './types.js';

/** Persistence port. The MSSQL implementation maps onto the idoc.* schema (not included/tested here). */
export interface Repository {
  packExists(guid: string): Promise<boolean>;
  /** Must be atomic: all rows or none. */
  saveJob(result: IngestResult): Promise<void>;
}

export class InMemoryRepository implements Repository {
  readonly jobs: IngestResult[] = [];
  private guids = new Set<string>();
  async packExists(guid: string): Promise<boolean> { return this.guids.has(guid); }
  async saveJob(r: IngestResult): Promise<void> {
    for (const p of r.packs) this.guids.add(p.parsed.guid);
    this.jobs.push(r);
  }
}
