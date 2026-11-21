import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import * as D from './describe.js';
import { checkNoOverlap, planPriceChange, statusOf, type BandRow } from './rules.js';
import type { FormatRef, HistoryEntry, PostalOverview, PostalStore, PriceChangeInput, ProviderView, RateInput, RateView, ServiceInput, ServiceView } from './types.js';

interface Svc extends ServiceInput { id: number; providerId: number; batches: number }
interface Rate extends RateInput { id: number; serviceId: number; usedBy: number }

/** For tests and the stub server. Mirrors the rules the SQL store enforces. */
export class MemoryPostalStore implements PostalStore {
  formats: FormatRef[] = [{ id: 1, name: 'Letter' }, { id: 2, name: 'Large letter' }, { id: 3, name: 'Packet' }];
  providers = new Map<number, string>();
  services = new Map<number, Svc>();
  rates = new Map<number, Rate>();
  audit: { by: string; summary: string }[] = [];
  today = (): string => new Date().toISOString().slice(0, 10);
  private next = 1;

  private log(by: string, summary: string): void { this.audit.push({ by, summary }); }
  private provider(id: number): string { const p = this.providers.get(id); if (p === undefined) throw new NotFoundError('Provider not found'); return p; }
  private svc(id: number): Svc { const s = this.services.get(id); if (!s) throw new NotFoundError('Service not found'); return s; }
  private rate(id: number): Rate { const r = this.rates.get(id); if (!r) throw new NotFoundError('Price not found'); return r; }
  private fmt(id: number): FormatRef { const f = this.formats.find((x) => x.id === id); if (!f) throw new ValidationError({ formatId: 'Unknown format' }); return f; }
  private label(s: Svc): string { return `${this.provider(s.providerId)} – ${s.name}`; }
  private band(r: Rate): BandRow { return { id: r.id, minWeightG: r.minWeightG, maxWeightG: r.maxWeightG, validFrom: r.validFrom, validTo: r.validTo }; }
  private rowsOf(serviceId: number): Rate[] { return [...this.rates.values()].filter((r) => r.serviceId === serviceId); }
  private checkServiceNames(providerId: number, input: ServiceInput, exceptId: number | null): void {
    for (const s of this.services.values()) if (s.id !== exceptId && s.providerId === providerId && s.formatId === input.formatId && s.name.toLowerCase() === input.name.toLowerCase()) throw new ConflictError('This provider already has a service with that name and format.');
  }

  async overview(): Promise<PostalOverview> {
    const today = this.today();
    const providers: ProviderView[] = [...this.providers.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => ({
      id, name,
      services: [...this.services.values()].filter((s) => s.providerId === id).sort((a, b) => a.name.localeCompare(b.name)).map((s): ServiceView => ({
        id: s.id, name: s.name, formatId: s.formatId, formatName: this.fmt(s.formatId).name, serviceCode: s.serviceCode, isSignedFor: s.isSignedFor, isTracked: s.isTracked, isRecorded: s.isRecorded,
        rates: this.rowsOf(s.id).sort((a, b) => a.minWeightG - b.minWeightG || a.maxWeightG - b.maxWeightG || b.validFrom.localeCompare(a.validFrom)).map((r): RateView => ({
          id: r.id, minWeightG: r.minWeightG, maxWeightG: r.maxWeightG, validFrom: r.validFrom, validTo: r.validTo, cost: r.cost, sellPrice: r.sellPrice, usedBy: r.usedBy, status: statusOf(r.validFrom, r.validTo, today),
        })),
      })),
    }));
    return { today, formats: this.formats, providers };
  }

  async createProvider(name: string, by: string): Promise<number> {
    if ([...this.providers.values()].some((n) => n.toLowerCase() === name.toLowerCase())) throw new ConflictError('There is already a provider with that name.');
    const id = this.next++; this.providers.set(id, name); this.log(by, D.describeProviderCreated(name)); return id;
  }
  async updateProvider(id: number, name: string, by: string): Promise<void> {
    const old = this.provider(id);
    if ([...this.providers.entries()].some(([i, n]) => i !== id && n.toLowerCase() === name.toLowerCase())) throw new ConflictError('There is already a provider with that name.');
    if (old === name) return;
    this.providers.set(id, name); this.log(by, D.describeProviderRenamed(old, name));
  }
  async deleteProvider(id: number, by: string): Promise<void> {
    const name = this.provider(id);
    if ([...this.services.values()].some((s) => s.providerId === id)) throw new ConflictError('This provider still has services. Delete them first, or end their prices with a last day.');
    this.providers.delete(id); this.log(by, D.describeProviderDeleted(name));
  }

  async createService(providerId: number, input: ServiceInput, by: string): Promise<number> {
    const p = this.provider(providerId); this.fmt(input.formatId); this.checkServiceNames(providerId, input, null);
    const id = this.next++; this.services.set(id, { ...input, id, providerId, batches: 0 }); this.log(by, D.describeServiceCreated(p, input.name)); return id;
  }
  async updateService(id: number, input: ServiceInput, by: string): Promise<void> {
    const s = this.svc(id); const f = this.fmt(input.formatId); this.checkServiceNames(s.providerId, input, id);
    const before = { ...s, formatName: this.fmt(s.formatId).name };
    Object.assign(s, input);
    const line = D.describeServiceChange(this.provider(s.providerId), before, { ...input, formatName: f.name });
    if (line) this.log(by, line);
  }
  async deleteService(id: number, by: string): Promise<void> {
    const s = this.svc(id);
    if (this.rowsOf(id).length) throw new ConflictError('This service still has prices. Delete them, or end them with a last day to switch the service off.');
    if (s.batches > 0) throw new ConflictError('Batches have been made with this service, so it cannot be deleted.');
    this.services.delete(id); this.log(by, D.describeServiceDeleted(this.provider(s.providerId), s.name));
  }

  async createRate(serviceId: number, input: RateInput, by: string): Promise<number> {
    const s = this.svc(serviceId);
    checkNoOverlap(input, this.rowsOf(serviceId).map((r) => this.band(r)));
    const id = this.next++; this.rates.set(id, { ...input, id, serviceId, usedBy: 0 }); this.log(by, D.describeRateCreated(this.label(s), input)); return id;
  }
  async updateRate(id: number, input: RateInput, by: string): Promise<void> {
    const r = this.rate(id); const s = this.svc(r.serviceId);
    if (r.usedBy > 0 && (r.minWeightG !== input.minWeightG || r.maxWeightG !== input.maxWeightG || r.validFrom !== input.validFrom)) throw new ConflictError('This price is in use, so its weights and first day cannot change. Use "Change prices from a date" instead.');
    checkNoOverlap(input, this.rowsOf(r.serviceId).filter((x) => x.id !== id).map((x) => this.band(x)));
    const before: RateInput = { minWeightG: r.minWeightG, maxWeightG: r.maxWeightG, validFrom: r.validFrom, validTo: r.validTo, cost: r.cost, sellPrice: r.sellPrice };
    Object.assign(r, input);
    const line = D.describeRateChange(this.label(s), before, input);
    if (line) this.log(by, line);
  }
  async deleteRate(id: number, by: string): Promise<void> {
    const r = this.rate(id); const s = this.svc(r.serviceId);
    if (r.usedBy > 0) throw new ConflictError('This price is in use by envelope settings, customer prices or mailpieces, so it cannot be deleted. Give it a last day instead.');
    this.rates.delete(id); this.log(by, D.describeRateDeleted(this.label(s), r));
  }

  async priceChange(serviceId: number, input: PriceChangeInput, by: string): Promise<number> {
    const s = this.svc(serviceId);
    const rows = this.rowsOf(serviceId);
    const plan = planPriceChange(input.effectiveFrom, this.today(), rows.map((r) => this.band(r)), input.changes);
    const lines: Parameters<typeof D.describePriceChange>[2] = [];
    for (const p of plan) {
      const old = this.rate(p.row.id);
      lines.push({ min: old.minWeightG, max: old.maxWeightG, cost: [old.cost, p.cost], sell: [old.sellPrice, p.sellPrice] });
      const id = this.next++;
      this.rates.set(id, { id, serviceId, minWeightG: old.minWeightG, maxWeightG: old.maxWeightG, validFrom: input.effectiveFrom, validTo: old.validTo, cost: p.cost, sellPrice: p.sellPrice, usedBy: 0 });
      old.validTo = new Date(Date.parse(`${input.effectiveFrom}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
    }
    this.log(by, D.describePriceChange(this.label(s), input.effectiveFrom, lines));
    return plan.length;
  }

  async history(limit: number): Promise<HistoryEntry[]> {
    return this.audit.map((a, i) => ({ id: i + 1, changedAt: new Date().toISOString(), changedBy: a.by, summary: a.summary })).reverse().slice(0, limit);
  }
}
