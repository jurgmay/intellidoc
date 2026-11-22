import type { ActivityRow, ActivityStore, InboxItem, InboxReader } from './types.js';

export class MemoryActivityStore implements ActivityStore {
  rows: ActivityRow[] = [];
  async running(): Promise<ActivityRow[]> { return this.rows.filter((r) => r.state === 'Running'); }
  async recent(limit: number): Promise<ActivityRow[]> { return this.rows.filter((r) => r.state !== 'Running').sort((a, b) => b.id - a.id).slice(0, limit); }
}
export class MemoryInboxReader implements InboxReader {
  reason: string | null = null; items: InboxItem[] = [];
  unavailable(): string | null { return this.reason; }
  async list(): Promise<InboxItem[]> { return this.items; }
}
