import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { describeBecameCustomer, describeBecameSubAccount, describeDetailsChange, describeEnvelope, describeMode, describeLeftAsCustomer, describeMatchRules, describeSequenceRules, describeSubAccountOf, noChildCustomers } from './describe.js';
import type {
  AuditEntry, CustomerDetail, CustomerDetailsInput, CustomerRow, CustomerStore, EnvelopeInput, InheritMode, EnvelopeView, InheritedEnvelopeView, InheritedSettings, FlagKey, Lookups, MatchRule, ParentView, SequenceRule, SettingKey,
} from './types.js';
import { FLAGS, SETTINGS } from './types.js';

interface Cust extends Omit<CustomerDetail, 'accounts' | 'brands' | 'envelopes' | 'parent' | 'children' | 'pendingJobNumber' | 'pendingFrom' | 'invoicing' | 'invoicingOptions' | 'inheritedEnvelopes' | 'inherited'> {
  parentId: number | null; invoicingAccountId: number | null; pendingJobNumber: string | null; pendingFrom: string | null; jobNumberRolloverDay: number;
}

/** The next date after today (YYYY-MM-DD) that falls on the given day of the month (1-28). */
export function nextRollover(today: string, rollDay: number): string {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const pad = (n: number): string => String(n).padStart(2, '0');
  if (d < rollDay) return `${y}-${pad(m)}-${pad(rollDay)}`;
  return m === 12 ? `${y + 1}-01-${pad(rollDay)}` : `${y}-${pad(m + 1)}-${pad(rollDay)}`;
}
/** `rehomedFrom`: the customer this account belonged to before that customer became a sub-account (so that undoing it can give the account back). */
interface Acct { id: number; customerId: number; code: string; name: string; isDeleted: boolean; rehomedFrom?: number }
interface Brand { id: number; customerId: number; name: string }
interface Env extends EnvelopeInput { id: number; customerId: number; isDeleted: boolean }

const noModes = (): Record<SettingKey, InheritMode> => Object.fromEntries(SETTINGS.map((k) => [k, 'OWN'])) as Record<SettingKey, InheritMode>;
const noFlags = (): Record<FlagKey, boolean> => Object.fromEntries(FLAGS.map((f) => [f, false])) as Record<FlagKey, boolean>;

/** For tests and the stub server. Mirrors the rules the SQL store enforces. */
export class MemoryCustomerStore implements CustomerStore {
  customers = new Map<number, Cust>();
  /** Customers that became sub-accounts. Their own settings are kept, so that undoing it brings them back. */
  converted = new Map<number, Cust>();
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
  /** Today's date in London as YYYY-MM-DD. Tests replace this. */
  today = (): string => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  now = (): string => new Date().toISOString();
  private seq = 100;
  private nextId = (): number => ++this.seq;

  seed(c: { code: string; name: string } & Partial<Cust>): number {
    const id = this.nextId();
    this.put(id, c);
    return id;
  }
  private put(id: number, c: { code: string; name: string } & Partial<Cust>): void {
    this.customers.set(id, { id, parentId: null, modes: noModes(), invoicingAccountId: null, misJobNumber: null, pendingJobNumber: null, pendingFrom: null, jobNumberRolloverDay: 1, returnAddress: null, colourMode: 'ORIGINAL', flags: noFlags(), batchingKey: null, packSequenceKey: null, matchRules: [], sequenceRules: [], emails: [], ...c });
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
      .filter((c) => (includeDeleted || !c.flags.isDeleted) && (!q || c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || (c.misJobNumber ?? '').toLowerCase().includes(q) || (c.pendingJobNumber ?? '').toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => ({
        id: c.id, code: c.code, name: c.name, misJobNumber: c.misJobNumber, pendingJobNumber: c.pendingJobNumber, parentId: c.parentId, parentCode: c.parentId === null ? null : this.customers.get(c.parentId)?.code ?? null, isAddressMatching: c.flags.isAddressMatching, isTesting: c.flags.isTesting, isDeleted: c.flags.isDeleted,
        accountCount: this.accounts.filter((a) => a.customerId === c.id && !a.isDeleted).length,
        brandCount: this.brands.filter((b) => b.customerId === c.id).length,
        envelopeCount: this.envelopes.filter((e) => e.customerId === c.id && !e.isDeleted).length,
      }));
  }

  async get(id: number): Promise<CustomerDetail> {
    const { parentId, invoicingAccountId, ...c } = this.cust(id);
    const par = parentId === null ? undefined : this.customers.get(parentId);
    const view = (x: { id: number; code: string; name: string }) => ({ id: x.id, code: x.code, name: x.name });
    const options = this.invoicingOptions(id);
    return {
      ...c, flags: { ...c.flags },
      invoicing: invoicingAccountId === null ? null : options.find((o) => o.id === invoicingAccountId) ?? null, invoicingOptions: options.map(view),
      parent: par ? { id: par.id, code: par.code, name: par.name } : null,
      children: [...this.customers.values()].filter((x) => x.parentId === id).sort((a, b) => a.name.localeCompare(b.name)).map((x) => ({ id: x.id, code: x.code, name: x.name, isDeleted: x.flags.isDeleted })),
      accounts: this.accounts.filter((a) => a.customerId === id).map(({ id: i, code, name, isDeleted }) => ({ id: i, code, name, isDeleted })),
      brands: this.brands.filter((b) => b.customerId === id).map((b) => ({ id: b.id, name: b.name, usage: this.brandUsage(b.id) })),
      envelopes: this.envelopes.filter((e) => e.customerId === id && !e.isDeleted).map((e) => this.envelopeView(e)),
      modes: { ...c.modes },
      inheritedEnvelopes: this.inheritedEnvelopes(id),
      inherited: this.inheritedSettings(id),
    };
  }

  private envelopeView(e: Env): EnvelopeView {
    const r = this.rate(e.postalRateId), s = this.stock(e.stockItemId);
    return {
      id: e.id, brandId: e.brandId, brandName: this.brands.find((b) => b.id === e.brandId)?.name ?? null, deliveryBand: e.deliveryBand, postalRateId: e.postalRateId, rateLabel: r.label,
      stockItemId: e.stockItemId, stockCode: s.code, stockDescription: s.description, reference: e.reference, externalName: e.externalName, isOversticker: e.isOversticker,
    };
  }

  /** The customers whose rows make up this customer's settings of one group, nearest first (itself included when it contributes). */
  private sources(id: number, setting: SettingKey): number[] {
    const c = this.customers.get(id);
    if (!c) return [];
    const m = c.modes[setting];
    if (m === 'OWN') return [id];
    const up = c.parentId === null ? [] : this.sources(c.parentId, setting);
    return m === 'INHERIT' ? up : [id, ...up];
  }
  private from = (id: number): ParentView => { const c = this.cust(id); return { id: c.id, code: c.code, name: c.name }; };

  /** Brands, rules, e-mails and single values that come from the parents. A nearer entry with the same key replaces a further one. */
  private inheritedSettings(id: number): InheritedSettings {
    const c = this.cust(id);
    const out: InheritedSettings = { brands: [], matchRules: [], sequenceRules: [], emails: [], matching: null, sequence: null };
    const own = (n: number): boolean => n === id;
    const seenB = new Set(this.brands.filter((b) => b.customerId === id).map((b) => b.name.toLowerCase()));
    for (const src of this.sources(id, 'brands').filter((n) => !own(n))) for (const b of this.brands.filter((x) => x.customerId === src)) { if (seenB.has(b.name.toLowerCase())) continue; seenB.add(b.name.toLowerCase()); out.brands.push({ name: b.name, from: this.from(src) }); }
    const ruleKey = (r: MatchRule): string => `${r.isInclude}|${r.key.toLowerCase()}|${(r.value ?? '').toLowerCase()}`;
    const seenR = new Set(c.matchRules.map(ruleKey));
    for (const src of this.sources(id, 'matching').filter((n) => !own(n))) for (const r of this.cust(src).matchRules) { if (seenR.has(ruleKey(r))) continue; seenR.add(ruleKey(r)); out.matchRules.push({ ...r, from: this.from(src) }); }
    const seenS = new Set(c.sequenceRules.map((r) => r.value.toLowerCase()));
    for (const src of this.sources(id, 'sequence').filter((n) => !own(n))) for (const r of this.cust(src).sequenceRules) { if (seenS.has(r.value.toLowerCase())) continue; seenS.add(r.value.toLowerCase()); out.sequenceRules.push({ ...r, from: this.from(src) }); }
    const seenE = new Set(c.emails.map((e) => e.toLowerCase()));
    for (const src of this.sources(id, 'emails').filter((n) => !own(n))) for (const e of this.cust(src).emails) { if (seenE.has(e.toLowerCase())) continue; seenE.add(e.toLowerCase()); out.emails.push({ email: e, from: this.from(src) }); }
    const nearM = this.sources(id, 'matching')[0]; if (c.modes.matching === 'INHERIT' && nearM !== undefined) { const m = this.cust(nearM); out.matching = { isAddressMatching: m.flags.isAddressMatching, batchingKey: m.batchingKey, from: this.from(nearM) }; }
    const nearQ = this.sources(id, 'sequence')[0]; if (c.modes.sequence === 'INHERIT' && nearQ !== undefined) { const m = this.cust(nearQ); out.sequence = { key: m.packSequenceKey, from: this.from(nearQ) }; }
    return out;
  }

  /** What comes from the parents. A nearer entry with the same brand name, band, rate and reference replaces a further one. */
  private inheritedEnvelopes(id: number): InheritedEnvelopeView[] {
    const key = (e: EnvelopeView): string => `${(e.brandName ?? '').toLowerCase()}|${e.deliveryBand.toLowerCase()}|${e.postalRateId}|${(e.reference ?? '').toLowerCase()}`;
    const seen = new Set<string>(); const out: InheritedEnvelopeView[] = [];
    for (const src of this.sources(id, 'envelopes')) {
      for (const e of this.envelopes.filter((x) => x.customerId === src && !x.isDeleted)) {
        const v = this.envelopeView(e); const k = key(v);
        if (seen.has(k)) continue;
        seen.add(k);
        if (src !== id) { const c = this.cust(src); out.push({ ...v, from: { id: c.id, code: c.code, name: c.name } }); }
      }
    }
    return out;
  }

  async setMode(customerId: number, setting: SettingKey, mode: InheritMode, by: string): Promise<void> {
    const c = this.cust(customerId);
    if (mode !== 'OWN' && c.parentId === null) throw new ValidationError({ mode: 'This customer has no parent to take these settings from. Choose a parent on the Details tab first.' });
    if (c.modes[setting] === mode) return;
    const was = c.modes[setting]; c.modes[setting] = mode;
    this.log(customerId, by, describeMode(setting, was, mode));
  }

  async makeSubAccount(customerId: number, by: string): Promise<void> {
    const c = this.cust(customerId);
    const owner = c.parentId === null ? undefined : this.customers.get(c.parentId);
    if (!owner) throw new ValidationError({ parentId: 'Choose a parent customer on the Details tab first. A sub-account takes its settings from its parent.' });
    const kids = [...this.customers.values()].filter((x) => x.parentId === customerId && !x.flags.isDeleted);
    if (kids.length > 0) throw new ValidationError({ parentId: noChildCustomers(kids.map((k) => k.name)) });
    this.customers.delete(customerId); this.converted.set(customerId, c);
    for (const a of this.accounts) if (a.customerId === customerId) { a.customerId = owner.id; a.rehomedFrom = customerId; }
    this.accounts.push({ id: customerId, customerId: owner.id, code: c.code, name: c.name, isDeleted: c.flags.isDeleted });
    this.log(customerId, by, describeBecameSubAccount(owner.code, owner.code));
    this.log(owner.id, by, describeSubAccountOf(c.code, c.name));
  }

  async makeCustomer(accountId: number, by: string): Promise<void> {
    const a = this.accounts.find((x) => x.id === accountId);
    if (!a) throw new NotFoundError('Account not found');
    const owner = a.customerId;
    const kept = this.converted.get(accountId);
    this.accounts = this.accounts.filter((x) => x !== a);
    if (kept) { this.converted.delete(accountId); this.customers.set(accountId, kept); }
    else this.put(accountId, { code: a.code, name: a.name, parentId: owner, flags: { ...noFlags(), isDeleted: a.isDeleted } });
    for (const x of this.accounts) if (x.rehomedFrom === accountId) { x.customerId = accountId; delete x.rehomedFrom; }
    this.log(accountId, by, describeBecameCustomer(a.code, a.name));
    this.log(owner, by, describeLeftAsCustomer(a.code, a.name));
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
    const invoicing = this.checkInvoicing(id, input.parentId, input.invoicingAccountId);
    // A new pending number (or a new rollover day) starts on the next occurrence of the rollover day; an unchanged one keeps its date.
    const pendingFrom = input.pendingJobNumber === null ? null
      : input.pendingJobNumber === old.pendingJobNumber && input.jobNumberRolloverDay === old.jobNumberRolloverDay ? old.pendingFrom
        : nextRollover(this.today(), input.jobNumberRolloverDay);
    const lines = describeDetailsChange(old, input, input.parentId === null ? null : this.cust(input.parentId).code, pendingFrom, invoicing);
    Object.assign(this.cust(id), input, { pendingFrom });
    for (const l of lines) this.log(id, by, l);
    // without a parent there is nothing to inherit from
    if (input.parentId === null) for (const k of SETTINGS) if (old.modes[k] !== 'OWN') { this.cust(id).modes[k] = 'OWN'; this.log(id, by, describeMode(k, old.modes[k], 'OWN')); }
  }

  /** This customer, then each ancestor up the tree (using `parentId` for this customer when it is being changed). */
  private invoicingOptions(id: number, parentId: number | null | undefined = undefined): (Cust & { id: number })[] {
    const out: Cust[] = []; const first = this.cust(id); out.push(first);
    for (let at = parentId === undefined ? first.parentId : parentId, n = 0; at !== null && n < 1000; at = this.customers.get(at)?.parentId ?? null, n++) { const c = this.customers.get(at); if (c) out.push(c); }
    return out;
  }

  private checkInvoicing(id: number, parentId: number | null, invoicingId: number | null): string | null {
    if (invoicingId === null) return null;
    const c = this.invoicingOptions(id, parentId).find((o) => o.id === invoicingId);
    if (!c) throw new ValidationError({ invoicingAccountId: 'The invoicing account must be this customer or one of its parents' });
    return c.code;
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

  async applyDuePending(): Promise<number> {
    let moved = 0;
    for (const c of this.customers.values()) {
      if (c.pendingJobNumber === null || c.pendingFrom === null || c.pendingFrom > this.today()) continue;
      const was = c.misJobNumber;
      c.misJobNumber = c.pendingJobNumber; c.pendingJobNumber = null; c.pendingFrom = null; moved++;
      this.log(c.id, 'system', `Job number: ${was === null ? '(none)' : `"${was}"`} → "${c.misJobNumber}" (the pending job number took effect)`);
    }
    return moved;
  }

  async history(customerId: number, limit: number): Promise<AuditEntry[]> {
    return this.audit.filter((a) => a.customerId === customerId).slice(0, limit).map(({ id, changedAt, changedBy, summary }) => ({ id, changedAt, changedBy, summary }));
  }
}
