import { ConflictError, NotFoundError } from '../errors.js';
import * as D from './describe.js';
import { checkFormatLimits, paperInUse } from './rules.js';
import type { FormatInput, FormatView, HistoryEntry, PaperInput, PaperView, ReferenceStore } from './types.js';

/** In-memory store for tests and the stub server. */
export class MemoryReferenceStore implements ReferenceStore {
  paperRows: PaperView[] = [
    { id: 1, name: 'A4 White', batchName: 'A4 WHITE', paperCode: null, usedBy: 3 },
    { id: 2, name: 'A4 Plain', batchName: 'A4 PLAIN', paperCode: null, usedBy: 0 },
  ];
  formatRows: FormatView[] = [
    { id: 1, name: 'Letter', rank: 1, maxWeightG: 100, maxThicknessMm: 5, maxSheets: 16, maxLengthMm: 240, maxWidthMm: 165, usedBy: 2 },
    { id: 2, name: 'Large Letter', rank: 2, maxWeightG: 750, maxThicknessMm: 25, maxSheets: 125, maxLengthMm: 353, maxWidthMm: 250, usedBy: 1 },
    { id: 3, name: 'Small Parcel', rank: 3, maxWeightG: 2000, maxThicknessMm: 80, maxSheets: null, maxLengthMm: 450, maxWidthMm: 350, usedBy: 0 },
  ];
  names = ['THEOCCUPIER', 'THERESIDENT'];
  log: HistoryEntry[] = [];
  private next = 1;
  now = (): string => new Date().toISOString();
  private note(by: string, summary: string): void { this.log.push({ id: this.next++, changedAt: this.now(), changedBy: by, summary }); }

  async papers(): Promise<PaperView[]> { return this.paperRows.map((p) => ({ ...p })).sort((a, b) => a.name.localeCompare(b.name)); }
  private paper(id: number): PaperView { const p = this.paperRows.find((x) => x.id === id); if (!p) throw new NotFoundError('Paper not found'); return p; }
  async updatePaper(id: number, input: PaperInput, by: string): Promise<void> {
    const p = this.paper(id); const line = D.describePaperChange(p, input);
    p.batchName = input.batchName; p.paperCode = input.paperCode;
    if (line) this.note(by, line);
  }
  async deletePaper(id: number, by: string): Promise<void> {
    const p = this.paper(id);
    if (p.usedBy > 0) throw paperInUse(p.name, p.usedBy);
    this.paperRows = this.paperRows.filter((x) => x.id !== id); this.note(by, D.describePaperDeleted(p.name));
  }

  async formats(): Promise<FormatView[]> { return this.formatRows.map((f) => ({ ...f })).sort((a, b) => a.rank - b.rank); }
  async updateFormat(id: number, input: FormatInput, by: string): Promise<void> {
    const f = this.formatRows.find((x) => x.id === id); if (!f) throw new NotFoundError('Postal format not found');
    checkFormatLimits(f, input, this.formatRows.filter((x) => x.id !== id));
    const line = D.describeFormatChange(f, input);
    Object.assign(f, input);
    if (line) this.note(by, line);
  }

  async anonymous(): Promise<string[]> { return [...this.names].sort(); }
  async addAnonymous(text: string, by: string): Promise<string> {
    if (this.names.includes(text)) throw new ConflictError(`${text} is already on the list.`);
    this.names.push(text); this.note(by, D.describeAnonymousAdded(text)); return text;
  }
  async deleteAnonymous(text: string, by: string): Promise<void> {
    if (!this.names.includes(text)) throw new NotFoundError('Not on the list');
    this.names = this.names.filter((n) => n !== text); this.note(by, D.describeAnonymousDeleted(text));
  }
  async history(limit: number): Promise<HistoryEntry[]> { return [...this.log].reverse().slice(0, limit); }
}
