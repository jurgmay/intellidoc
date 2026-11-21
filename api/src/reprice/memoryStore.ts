import { NotFoundError } from '../errors.js';
import { describeReprice } from './validate.js';
import type { RepriceInput, RepricePreview, RepriceResult, RepriceStore } from './types.js';

/** For tests and the stub server. The counts it answers with are set by the test. */
export class MemoryRepriceStore implements RepriceStore {
  customers = new Set<number>();
  counts: RepricePreview = { inScope: 0, alreadyPriced: 0, wouldPrice: 0, noModel: 0, unknownColours: 0 };
  runs: { customerId: number; input: RepriceInput }[] = [];
  audit: { customerId: number; by: string; summary: string }[] = [];
  private check(id: number): void { if (!this.customers.has(id)) throw new NotFoundError('Customer not found'); }
  async preview(customerId: number, _input: RepriceInput): Promise<RepricePreview> { this.check(customerId); return { ...this.counts }; }
  async run(customerId: number, input: RepriceInput, by: string): Promise<RepriceResult> {
    this.check(customerId); this.runs.push({ customerId, input });
    const r = { priced: this.counts.wouldPrice, noModel: this.counts.noModel, unknownColours: this.counts.unknownColours };
    this.audit.push({ customerId, by, summary: describeReprice(input, r) });
    return r;
  }
}
