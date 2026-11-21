import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { describeDetailsChange, describeEnvelope, describeMatchRules, describeSequenceRules } from './describe.js';
import type {
  AuditEntry, CustomerDetail, CustomerDetailsInput, CustomerRow, CustomerStore, EnvelopeInput, EnvelopeView, FlagKey, Lookups, MatchRule, SequenceRule,
} from './types.js';
import { FLAGS } from './types.js';

interface Cust extends Omit<CustomerDetail, 'accounts' | 'brands' | 'envelopes' | 'parent' | 'children'> { parentId: number | null }
interface Acct { id: number; customerId: number; code: string; name: string; isDeleted: boolean }
interface Brand { id: number; customerId: number; name: string }
interface Env extends EnvelopeInput { id: number; customerId: number; isDeleted: boolean }

const noFlags = (): Record<FlagKey, boolean> => Object.fromEntries(FLAGS.map((f) => [f, false])) as Record<FlagKey, boolean>;

/** For tests and the stub server. Mirrors the rules the SQL store enforces. */
export class MemoryCustomerStore implements CustomerStore {
  customers = new Map<number, Cust>();
  accounts: Acct[] = [];
  brands: Brand[] = [];
  envelopes: Env[] = [];
  audit: (AuditEntry & { customerId: number })[] = [];
  lookupData: Lookups = {
    passthroughKeys: ['Department', 'Doc Type'],
    customers: [],
    deliveryBands: ['1st Class', '2nd Class', 'Signed For'],
    postalRates: [
      { id: 1, label: 'Royal Mail – 2nd Class (Letter), up to 100g', format: 'Letter' },
      { id: 2, label: 'Royal Mail – 1st Class (Letter), up to 100g', format: 'Letter' },
      { id: 3, label: 'Royal Mail – 2nd Class (Large Letter), 101–250g', format: 'Large Letter' },
    ],
    envelopeStock: [
      { id: 10, code: 'WH0101', description: 'C5 white window envelope', size: 'C5' },
      { id: 11, code: null, description: 'C4 white window envelope', size: 'C4' },
    ],
  };
  customersLookup = (): Lookups['customers'] => [...this.customers.values()].filter((c) => !c.flags.isDeleted).sort((a, b) => a.name.localeCompare(b.name)).map(({ id, code, name }) => ({ id, code, name }));
  now = (): string => new Date().toISOString();
  private seq = 100;
  private nextId = (): number => ++this.seq;

  seed(c: { code: string; name: string } & Partial<Cust>): number {
    const id = this.nextId();
    this.customers.set(id, { id, parentId: null, misJobNumber: null, returnAddress: null, colourMode: null, flags: noFlags(), batchingKey: null, packSequenceKey: null, matchRules: [], sequenceRules: [], emails: [], ...c });
    return id;
  }

  private cust(id: number): Cust { const c = this.customers.get(id); if (!c) throw new NotFoundError('Customer not found'); return c; }
  private codeTaken(code: string, exceptId?: number): boolean {
    const l = code.toLowerCase();
    return [...this.customers.values()].some((c) => c.id !== exceptId && c.code.toLowerCase() === l) || this.accounts.some((a) => a.id !== exceptId && a.code.toLowerCase() === l);
  }
  private log(customerId: number, by: string, summary: string): void {
    this.audit.unshift({ id: this.audit.length + 1, customerId, changedAt: this.now(), changedBy: by, summary });
  }
  private rate(id: number) { const r = this.lookupData.postalRates.find((x) => x.id === id); if (!r) throw new ValidationError({ postalRateId: 'Postal service and weight band not found' }); return r; }
  private stock(id: number) { const s = this.lookupData.envelopeStock.find((x) => x.id === id); if (!s) throw new ValidationError({ stockItemId: 'Envelope not found' }); return s; }
  private brandUsage(brandId: number): number { return this.envelopes.filter((e) => !e.isDeleted && e.brandId === brandId).length; }

  async list(search: string, includeDeleted: boolean): Promise<CustomerRow[]> {
    const q = search.trim().toLowerCase();
    return [...this.customers.values()]
      .filter((c) => (includeDeleted || !c.flags.isDeleted) && (!q || c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || (c.misJobNumber ?? '').toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({
        id: c.id, code: c.code, name: c.name, misJobNumber: c.misJobNumber, parentId: c.parentId, parentCode: c.parentId === null ? null : this.customers.get(c.parentId)?.code ?? null, isAddressMatching: c.flags.isAddressMatching, isTesting: c.flags.isTesting, isDeleted: c.flags.isDeleted,
        accountCount: this.accounts.filter((a) => a.customerId === c.id && !a.isDeleted).length,
        brandCount: this.brands.filter((b) => b.customerId === c.id).length,
        envelopeCount: this.envelopes.filter((e) => e.customerId === c.id && !e.isDeleted).length,
      }));
  }

  async get(id: number): Promise<CustomerDetail> {
    const { parentId, ...c } = this.cust(id);
    const par = parentId === null ? undefined : this.customers.get(parentId);
    return {
      ...c, flags: { ...c.flags },
      parent: par ? { id: par.id, code: par.code, name: par.name } : null,
      children: [...this.customers.values()].filter((x) => x.parentId === id).sort((a, b) => a.name.localeCompare(b.name)).map((x) => ({ id: x.id, code: x.code, name: x.name, isDeleted: x.flags.isDeleted })),
      accounts: this.accounts.filter((a) => a.customerId === id).map(({ id: i, code, name, isDeleted }) => ({ id: i, code, name, isDeleted })),
      brands: this.brands.filter((b) => b.customerId === id).map((b) => ({ id: b.id, name: b.name, usage: this.brandUsage(b.id) })),
      envelopes: this.envelopes.filter((e) => e.customerId === id && !e.isDeleted).map((e): EnvelopeView => {
        const r = this.rate(e.postalRateId), s = this.stock(e.stockItemId);
        return {
          id: e.id, brandId: e.brandId, brandName: this.brands.find((b) => b.id === e.brandId)?.name ?? null, deliveryBand: e.deliveryBand, postalRateId: e.postalRateId, rateLabel: r.label,
          stockItemId: e.stockItemId, stockCode: s.code, stockDescription: s.description, reference: e.reference, externalName: e.externalName, isOversticker: e.isOversticker,
        };
      }),
    };
  }

  async lookups(): Promise<Lookups> { return { ...this.lookupData, customers: this.customersLookup() }; }

  async create(input: { code: string; name: string }, by: string): Promise<number> {
    if (this.codeTaken(input.code)) throw new ConflictError(`Account code "${input.code}" is already in use`);
    const id = this.seed(input);
    this.log(id, by, `Created customer ${input.code} "${input.name}"`);
    return id;
  }

  async updateDetails(id: number, input: CustomerDetailsInput, by: string): Promise<void> {
    const old = await this.get(id);
    if (this.codeTaken(input.code, id)) throw new ConflictError(`Account code "${input.code}" is already in use`);
    this.checkParent(id, input.parentId);
    const lines = describeDetailsChange(old, input, input.parentId === null ? null : this.cust(input.parentId).code);
    Object.assign(this.cust(id), input);
    for (const l of lines) this.log(id, by, l);
  }

  /** A parent must be another customer, and must not be this customer or one of its descendants. */
  private checkParent(id: number, parentId: number | null): void {
    if (parentId === null) return;
    if (!this.customers.has(parentId)) throw new ValidationError({ parentId: 'Parent customer not found' });
    for (let at: number | null = parentId, n = 0; at !== null && n < 1000; at = this.customers.get(at)?.parentId ?? null, n++) {
      if (at === id) throw new ValidationError({ parentId: parentId === id ? 'A customer cannot be its own parent' : 'That customer is below this one in the hierarchy, so it cannot be its parent' });
    }
  }

  async addAccount(customerId: number, input: { code: string; name: string }, by: string): Promise<number> {
    this.cust(customerId);
    if (this.codeTaken(input.code)) throw new ConflictError(`Account code "${input.code}" is already in use`);
    const id = this.nextId();
    this.accounts.push({ id, customerId, ...input, isDeleted: false });
    this.log(customerId, by, `Added account ${input.code} "${input.name}"`);
    return id;
  }

  async updateAccount(accountId: number, input: { code: string; name: string; isDeleted: boolean }, by: string): Promise<void> {
    const a = this.accounts.find((x) => x.id === accountId);
    if (!a) throw new NotFoundError('Account not found');
    if (this.codeTaken(input.code, accountId)) throw new ConflictError(`Account code "${input.code}" is already in use`);
    const was = `${a.code} "${a.name}"`;
    Object.assign(a, input);
    this.log(a.customerId, by, input.isDeleted ? `Removed account ${was}` : `Updated account ${was} → ${a.code} "${a.name}"`);
  }

  async addBrand(customerId: number, name: string, by: string): Promise<number> {
    this.cust(customerId);
    if (this.brands.some((b) => b.customerId === customerId && b.name.toLowerCase() === name.toLowerCase())) throw new ConflictError(`Brand "${name}" already exists for this customer`);
    const id = this.nextId();
    this.brands.push({ id, customerId, name });
    this.log(customerId, by, `Added brand "${name}"`);
    return id;
  }

  async renameBrand(brandId: number, name: string, by: string): Promise<void> {
    const b = this.brands.find((x) => x.id === brandId);
    if (!b) throw new NotFoundError('Brand not found');
    if (this.brands.some((o) => o.id !== brandId && o.customerId === b.customerId && o.name.toLowerCase() === name.toLowerCase())) throw new ConflictError(`Brand "${name}" already exists for this customer`);
    const was = b.name; b.name = name;
    this.log(b.customerId, by, `Renamed brand "${was}" → "${name}"`);
  }

  async deleteBrand(brandId: number, by: string): Promise<void> {
    const b = this.brands.find((x) => x.id === brandId);
    if (!b) throw new NotFoundError('Brand not found');
    const n = this.brandUsage(brandId);
    if (n > 0) throw new ConflictError(`Brand "${b.name}" is used by ${n} envelope setting${n === 1 ? '' : 's'}. Remove those first.`);
    this.brands = this.brands.filter((x) => x.id !== brandId);
    this.log(b.customerId, by, `Deleted brand "${b.name}"`);
  }

  private checkEnvelope(customerId: number, input: EnvelopeInput, exceptId?: number): void {
    this.rate(input.postalRateId); this.stock(input.stockItemId);
    if (input.brandId !== null && !this.brands.some((b) => b.id === input.brandId && b.customerId === customerId)) throw new ValidationError({ brandId: 'That brand does not belong to this customer' });
    const dup = this.envelopes.some((e) => !e.isDeleted && e.id !== exceptId && e.customerId === customerId && e.brandId === input.brandId && e.deliveryBand.toLowerCase() === input.deliveryBand.toLowerCase()
      && e.postalRateId === input.postalRateId && (e.reference ?? '') === (input.reference ?? ''));
    if (dup) throw new ConflictError('There is already an envelope setting for this brand, delivery band, postal service and reference');
  }
  private envText(i: EnvelopeInput): string {
    return describeEnvelope(this.brands.find((b) => b.id === i.brandId)?.name ?? null, i.deliveryBand, this.rate(i.postalRateId).label, this.stock(i.stockItemId).description);
  }

  async addEnvelope(customerId: number, input: EnvelopeInput, by: string): Promise<number> {
    this.cust(customerId); this.checkEnvelope(customerId, input);
    const id = this.nextId();
    this.envelopes.push({ id, customerId, ...input, isDeleted: false });
    this.log(customerId, by, `Added envelope: ${this.envText(input)}`);
    return id;
  }

  async updateEnvelope(envelopeId: number, input: EnvelopeInput, by: string): Promise<void> {
    const e = this.envelopes.find((x) => x.id === envelopeId && !x.isDeleted);
    if (!e) throw new NotFoundError('Envelope setting not found');
    this.checkEnvelope(e.customerId, input, envelopeId);
    const was = this.envText(e);
    Object.assign(e, input);
    this.log(e.customerId, by, `Changed envelope: ${was} → ${this.envText(e)}`);
  }

  async deleteEnvelope(envelopeId: number, by: string): Promise<void> {
    const e = this.envelopes.find((x) => x.id === envelopeId && !x.isDeleted);
    if (!e) throw new NotFoundError('Envelope setting not found');
    e.isDeleted = true;
    this.log(e.customerId, by, `Removed envelope: ${this.envText(e)}`);
  }

  async setMatchRules(customerId: number, rules: MatchRule[], by: string): Promise<void> {
    const c = this.cust(customerId);
    const was = describeMatchRules(c.matchRules), now = describeMatchRules(rules);
    c.matchRules = rules;
    if (was !== now) this.log(customerId, by, `Address-matching rules: ${was} → ${now}`);
  }

  async setSequenceRules(customerId: number, rules: SequenceRule[], by: string): Promise<void> {
    const c = this.cust(customerId);
    const was = describeSequenceRules(c.sequenceRules), now = describeSequenceRules(rules);
    c.sequenceRules = rules;
    if (was !== now) this.log(customerId, by, `Pack sequence: ${was} → ${now}`);
  }

  async setEmails(customerId: number, emails: string[], by: string): Promise<void> {
    const c = this.cust(customerId);
    const was = c.emails.join(', ') || 'none', now = emails.join(', ') || 'none';
    c.emails = emails;
    if (was !== now) this.log(customerId, by, `Notification e-mails: ${was} → ${now}`);
  }

  async history(customerId: number, limit: number): Promise<AuditEntry[]> {
    return this.audit.filter((a) => a.customerId === customerId).slice(0, limit).map(({ id, changedAt, changedBy, summary }) => ({ id, changedAt, changedBy, summary }));
  }
}
