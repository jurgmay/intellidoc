import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { describeCostingMode, describeModelChange, describeModelCreated, describeModelRemoved } from './describe.js';
import { CHARGES, type AccountRef, type CostingLookups, type CostingMode, type CostingOverview, type CostingStore, type ModelDetail, type ModelInput, type ModelSummary, type NewModelInput } from './types.js';

interface Cust extends AccountRef { mode: CostingMode; inheritsAll: boolean; parentId: number | null }
interface Model { id: number; customerId: number; input: ModelInput; copiedFromId: number | null; mailpieceCount: number }

/** For tests and the stub server. Mirrors the rules the SQL store enforces. */
export class MemoryCostingStore implements CostingStore {
  customers = new Map<number, Cust>();
  models = new Map<number, Model>();
  envelopeStock: CostingLookups['envelopeStock'] = [];
  postalRates: { id: number; label: string; format: string; cost: number | null; sell: number | null }[] = [];
  audit: { customerId: number; by: string; summary: string }[] = [];
  today = (): string => new Date().toISOString().slice(0, 10);
  private next = 1;

  private cust(id: number): Cust { const c = this.customers.get(id); if (!c) throw new NotFoundError('Customer not found'); return c; }
  private mod(id: number): Model { const m = this.models.get(id); if (!m) throw new NotFoundError('Costing model not found'); return m; }
  private log(customerId: number, by: string, summary: string): void { this.audit.push({ customerId, by, summary }); }
  private summary(m: Model): ModelSummary { return { id: m.id, name: m.input.name, validFrom: m.input.validFrom, validTo: m.input.validTo, isActive: m.input.isActive, mailpieceCount: m.mailpieceCount }; }
  private modelsOf(customerId: number): ModelSummary[] {
    return [...this.models.values()].filter((m) => m.customerId === customerId).sort((a, b) => b.input.validFrom.localeCompare(a.input.validFrom)).map((m) => this.summary(m));
  }
  /** The account whose models price this customer's mail. */
  private sourceOf(c: Cust): Cust {
    let cur = c;
    while ((cur.inheritsAll || cur.mode === 'INHERIT') && cur.parentId !== null && this.customers.has(cur.parentId)) cur = this.customers.get(cur.parentId)!;
    return cur;
  }

  async overview(customerId: number): Promise<CostingOverview> {
    const c = this.cust(customerId); const src = this.sourceOf(c);
    const from = src.id === c.id ? null : { id: src.id, code: src.code, name: src.name };
    const day = this.today();
    const inForce = this.modelsOf(src.id).filter((m) => m.isActive && m.validFrom <= day && (m.validTo === null || m.validTo >= day))[0];
    return { customerId, mode: c.mode, inheritsAll: c.inheritsAll, source: from, models: this.modelsOf(c.id), sourceModels: from ? this.modelsOf(src.id) : [], inForceId: inForce?.id ?? null };
  }

  async setMode(customerId: number, mode: CostingMode, by: string): Promise<void> {
    const c = this.cust(customerId);
    if (c.inheritsAll) throw new ConflictError('This account takes all its settings from its parent, so it cannot choose its own costing.');
    if (mode === 'INHERIT' && c.parentId === null) throw new ValidationError({ mode: 'This customer has no parent to take prices from.' });
    if (c.mode === mode) return;
    this.log(customerId, by, describeCostingMode(c.mode, mode));
    c.mode = mode;
  }

  async model(id: number): Promise<ModelDetail> {
    const m = this.mod(id); const copied = m.copiedFromId === null ? null : this.models.get(m.copiedFromId);
    const ch = new Map(m.input.charges.map((c) => [c.code, c]));
    const adj = new Map(m.input.postage.map((p) => [p.postalRateId, p.adjustment]));
    return {
      ...this.summary(m), customerId: m.customerId, comments: m.input.comments, copiedFrom: copied ? { id: copied.id, name: copied.input.name } : null,
      charges: CHARGES.map((c) => ({ code: c.code, label: c.label, group: c.group, cost: ch.get(c.code)?.cost ?? 0, sellPrice: ch.get(c.code)?.sellPrice ?? 0, adjustment: ch.get(c.code)?.adjustment ?? 0 })),
      envelopes: m.input.envelopes.map((e) => { const s = this.envelopeStock.find((x) => x.id === e.stockItemId); return { stockItemId: e.stockItemId, stockCode: s?.code ?? null, description: s?.description ?? '', size: s?.size ?? null, cost: e.cost, sellPrice: e.sellPrice, adjustment: e.adjustment }; }),
      postage: this.postalRates.map((r) => ({ postalRateId: r.id, label: r.label, format: r.format, suggestedCost: r.cost, suggestedSell: r.sell, adjustment: adj.get(r.id) ?? 0 })),
    };
  }

  private clash(customerId: number, validFrom: string, exceptId: number | null): void {
    if ([...this.models.values()].some((m) => m.customerId === customerId && m.id !== exceptId && m.input.validFrom === validFrom)) throw new ConflictError('This customer already has a costing model starting on that day.');
  }

  async create(customerId: number, input: NewModelInput, by: string): Promise<number> {
    this.cust(customerId); this.clash(customerId, input.validFrom, null);
    const src = input.copyFromId === null ? null : this.mod(input.copyFromId);
    const id = this.next++;
    const base: ModelInput = src ? structuredClone(src.input) : { name: '', validFrom: '', validTo: null, isActive: true, comments: null, charges: [], envelopes: [], postage: [] };
    this.models.set(id, { id, customerId, copiedFromId: src?.id ?? null, mailpieceCount: 0, input: { ...base, name: input.name, validFrom: input.validFrom, validTo: input.validTo, isActive: input.isActive } });
    this.log(customerId, by, describeModelCreated(input.name, src?.input.name ?? null));
    return id;
  }

  async update(id: number, input: ModelInput, by: string): Promise<void> {
    const m = this.mod(id); this.clash(m.customerId, input.validFrom, id);
    const stockIds = new Set(this.envelopeStock.map((s) => s.id));
    const bad = input.envelopes.findIndex((e) => !stockIds.has(e.stockItemId));
    if (bad >= 0) throw new ValidationError({ [`envelopes.${bad}.stockItemId`]: 'That envelope does not exist' });
    const rateIds = new Set(this.postalRates.map((r) => r.id));
    const badRate = input.postage.findIndex((p) => !rateIds.has(p.postalRateId));
    if (badRate >= 0) throw new ValidationError({ [`postage.${badRate}.postalRateId`]: 'That postal rate does not exist' });
    const kept = { ...input, postage: input.postage.filter((p) => p.adjustment !== 0) };
    const line = describeModelChange(input.name, m.input, kept,
      (sid) => this.envelopeStock.find((s) => s.id === sid)?.code ?? String(sid), (rid) => this.postalRates.find((r) => r.id === rid)?.label ?? String(rid));
    m.input = kept;
    if (line) this.log(m.customerId, by, line);
  }

  async remove(id: number, by: string): Promise<void> {
    const m = this.mod(id);
    if (m.mailpieceCount > 0) throw new ConflictError(`This model has priced ${m.mailpieceCount} mailpiece${m.mailpieceCount === 1 ? '' : 's'}, so it cannot be deleted. Switch it off instead.`);
    if ([...this.models.values()].some((x) => x.copiedFromId === id)) { for (const x of this.models.values()) if (x.copiedFromId === id) x.copiedFromId = null; }
    this.models.delete(id);
    this.log(m.customerId, by, describeModelRemoved(m.input.name));
  }

  async lookups(): Promise<CostingLookups> { return { envelopeStock: this.envelopeStock }; }
}
