import { ConflictError } from '../errors.js';
import type { Sample } from './estimate.js';
import type { ActivityRow, ActivityStore, InboxItem, InboxReader } from './types.js';

export class MemoryActivityStore implements ActivityStore {
  rows: ActivityRow[] = [];
  sampleRows: Sample[] = [];
  async samples(limit: number): Promise<Sample[]> { return this.sampleRows.slice(0, limit); }
  async running(): Promise<ActivityRow[]> { return this.rows.filter((r) => r.state === 'Running'); }
  async get(id: number): Promise<ActivityRow | null> { return this.rows.find((r) => r.id === id) ?? null; }
  async dismiss(id: number): Promise<void> { const r = this.rows.find((x) => x.id === id); if (r && r.state === 'Failed') r.state = 'Abandoned'; }
  async recent(limit: number): Promise<ActivityRow[]> { return this.rows.filter((r) => r.state !== 'Running').sort((a, b) => b.id - a.id).slice(0, limit); }
}
export class MemoryInboxReader implements InboxReader {
  reason: string | null = null; items: InboxItem[] = [];
  unavailable(): string | null { return this.reason; }
  async list(): Promise<InboxItem[]> { return this.items; }
  restored: { name: string; withPartner: boolean }[] = []; failedHas: string[] = [];
  async restoreFailed(name: string, withPartner: boolean): Promise<string[]> {
    if (!this.failedHas.includes(name)) throw new ConflictError(`${name} is not in the failed folder.`);
    this.restored.push({ name, withPartner });
    return [name];
  }
}
