import { describe, expect, it } from 'vitest';
import { run, buildXml, FakePdf, type PackSpec } from './helpers.js';
import { parseHpodV6 } from '../src/parser.js';
import { InMemoryRepository } from '../src/repository.js';
import { ingest } from '../src/ingest.js';
import { fixtureReference } from '../src/fixtureReference.js';
import { assertSingleRecipient } from '../src/matching.js';

const person = (first: string, surname: string, extra: Partial<PackSpec> = {}): PackSpec => ({ first, surname, lines: [`${first} ${surname}`, '1 High Street', 'Town', 'AB1 2CD'], ...extra });

describe('GDPR: one recipient per envelope', () => {
  it('same address, different people => separate mailpieces', async () => {
    const r = await run([person('John', 'Smith'), person('Jane', 'Smith'), person('John', 'Smith')]);
    expect(r.mailpieces).toHaveLength(2);
    for (const m of r.mailpieces) expect(new Set(m.packs.map((p) => p.address.hash)).size).toBe(1);
  });
  it('identical address lines but different FirstName/Surname attributes never merge', async () => {
    const a = person('John', 'Smith'); const b = { ...person('John', 'Smith'), first: 'Joan', surname: 'Smythe' };
    expect((await run([a, b])).mailpieces).toHaveLength(2);
  });
  it('shared household name line with different addressee line does not merge', async () => {
    const r = await run([
      { first: 'A', surname: 'Smith', lines: ['Mr A Smith', '1 High Street', 'Town', 'AB1 2CD'] },
      { first: 'B', surname: 'Smith', lines: ['Mrs B Smith', '1 High Street', 'Town', 'AB1 2CD'] },
    ]);
    expect(r.mailpieces).toHaveLength(2);
  });
  it('same person, case/punctuation/ampersand differences merge', async () => {
    const r = await run([
      { first: 'A', surname: 'B', lines: ['Mr A & Ms B', '1 High St.', 'AB1 2CD'] },
      { first: 'A', surname: 'B', lines: ['MR A AND MS B', '1 HIGH ST', 'ab1 2cd'] },
    ]);
    expect(r.mailpieces).toHaveLength(1);
    expect(r.mailpieces[0]!.sheets).toBe(2);
  });
  it('different house numbers do not merge ("10 4" vs "104")', async () => {
    const r = await run([
      { first: 'A', surname: 'B', lines: ['A B', '10 4 High St', 'AB1 2CD'] },
      { first: 'A', surname: 'B', lines: ['A B', '104 High St', 'AB1 2CD'] },
    ]);
    expect(r.mailpieces).toHaveLength(2);
  });
  it('randomised: any mix of people/addresses never produces a multi-recipient mailpiece', async () => {
    let seed = 12345; const rnd = (n: number): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const firsts = ['Ann', 'Bob', 'Cy', 'Di']; const surs = ['Lee', 'Lea', 'Li'];
    for (let round = 0; round < 40; round++) {
      const specs: PackSpec[] = [];
      for (let i = 0; i < 30; i++) {
        const f = firsts[rnd(4)]!; const s = surs[rnd(3)]!; const house = String(1 + rnd(3));
        specs.push({ first: f, surname: s, lines: [`${f} ${s}`, `${house} Road`, 'Town', 'AB1 2CD'] });
      }
      const r = await run(specs);
      for (const m of r.mailpieces) { assertSingleRecipient(m.packs); expect(new Set(m.packs.map((p) => `${p.parsed.address.firstName}${p.parsed.address.surname}${p.address.lines.join()}`)).size).toBe(1); }
      const keys = new Set(specs.map((s) => `${s.first}|${s.surname}|${s.lines![1]}`));
      expect(r.mailpieces.length).toBe(keys.size);
    }
  });
  it('safety net throws if a mixed group is ever formed', async () => {
    const r = await run([person('John', 'Smith'), person('Jane', 'Smith')]);
    expect(() => assertSingleRecipient([r.packs[0]!, r.packs[1]!])).toThrow(/GDPR/);
  });
});

describe('exclusions', () => {
  it('anonymous addressees never merge, even identical', async () => {
    const o: PackSpec = { first: 'THE', surname: 'OCCUPIER', lines: ['THE OCCUPIER', '5 Road', 'AB1 2CD'] };
    const r = await run([o, o, { ...o, first: 'The', surname: 'Occupier', lines: ['The Occupier', '5 Road', 'AB1 2CD'] }]);
    expect(r.mailpieces).toHaveLength(3);
    expect(r.packs.every((p) => p.matchExclusion === 'ANONYMOUS_ADDRESSEE')).toBe(true);
  });
  it('IMPORTANT NOTICE ENCLOSED packs are not merged, notice line is not stored', async () => {
    const lines = (n: boolean): string[] => [...(n ? ['IMPORTANT NOTICE ENCLOSED'] : []), 'Mr X', '1 Road', 'AB1 2CD'];
    const r = await run([{ first: 'Mr', surname: 'X', lines: lines(true) }, { first: 'Mr', surname: 'X', lines: lines(false) }, { first: 'Mr', surname: 'X', lines: lines(false) }]);
    expect(r.mailpieces).toHaveLength(2);
    expect(r.packs.flatMap((p) => p.address.lines).some((l) => /NOTICE/i.test(l))).toBe(false);
    expect(r.mailpieces.find((m) => m.packs.length === 2)!.packs.every((p) => !p.address.hadNotice)).toBe(true);
  });
  it('trailing postcode line is stored separately', async () => {
    const r = await run([person('A', 'B')]);
    expect(r.packs[0]!.address.lines.at(-1)).toBe('Town');
    expect(r.packs[0]!.address.postcode).toBe('AB1 2CD');
  });
  it('matching disabled / exclude rule on the account', async () => {
    const ref = fixtureReference();
    ref.accounts.get('FEXCO')!.matchExclude = [{ key: 'DocType', value: 'Arrears' }];
    const r = await run([person('A', 'B', { passthrough: { DocType: 'Arrears' } }), person('A', 'B', { passthrough: { DocType: 'Arrears' } }), person('A', 'B', { passthrough: { DocType: 'Letter' } }), person('A', 'B', { passthrough: { DocType: 'Letter' } })], { ref });
    expect(r.mailpieces).toHaveLength(3);
    ref.accounts.get('FEXCO')!.matchingEnabled = false;
    expect((await run([person('A', 'B'), person('A', 'B')], { ref })).mailpieces).toHaveLength(2);
  });
});

describe('batching and enclosing', () => {
  const many = (n: number, over: Partial<PackSpec> = {}): PackSpec[] => Array.from({ length: n }, (_, i) => { const sn = `${over.surname ?? 'N'}${i}`; return { first: 'P', lines: [`P ${sn}`, '1 Rd', 'AB1 2CD'], ...over, surname: sn }; });
  it('25 mailpieces -> hand; 26 -> machine (C5)', async () => {
    expect((await run(many(25))).batches[0]!.enclosing).toBe('HAND');
    expect((await run(many(26))).batches[0]!.enclosing).toBe('MACHINE');
  });
  it('different brands/envelopes are never combined to reach 26', async () => {
    const r = await run([...many(13), ...many(13, { brand: 'Crabtree', envCode: 'WH21519', envText: 'C5 Envelope ref: Crabtree' })]);
    expect(r.batches).toHaveLength(2);
    expect(r.batches.every((b) => b.enclosing === 'HAND')).toBe(true);
  });
  it('postal service, paper-insert set and batching key split batches', async () => {
    const ref = fixtureReference(); ref.accounts.get('FEXCO')!.batchingKey = 'Property';
    const r = await run([
      ...many(2, { method: '1st Class', surname: 'A' }), ...many(2, { method: '2nd Class', surname: 'B' }), ...many(2, { inserts: ['WH22911'], surname: 'C' }),
      ...many(2, { passthrough: { Property: 'P1' }, surname: 'D' }), ...many(2, { passthrough: { Property: 'P2' }, surname: 'E' }),
    ], { ref });
    expect(r.batches).toHaveLength(5);
  });
  it('same person with different inserts on two letters => one envelope carrying the union', async () => {
    const r = await run([person('A', 'B', { inserts: ['WH22911'] }), person('A', 'B')]);
    expect(r.mailpieces).toHaveLength(1);
    expect(r.mailpieces[0]!.insertCodes).toEqual([{ code: 'WH22911', quantity: 1 }]);
  });
  it('batches with sorted-insert order are the same batch', async () => {
    const r = await run([{ ...many(1)[0]!, inserts: ['INSERT-PARENT', 'WH22911'] }, { ...many(2)[1]!, inserts: ['WH22911', 'INSERT-PARENT'] }]);
    expect(r.batches).toHaveLength(1);
  });
  it('insert weight forces C5 -> C4 and out of machine route', async () => {
    const r = await run(many(30, { inserts: ['INSERT-HEAVY'] }));
    const m = r.mailpieces[0]!;
    expect(m.postalFormat).toBe('Large Letter'); expect(m.envelopeSize).toBe('C4'); expect(m.envelopeCode).toBe('C4-REMUS');
    expect(r.batches[0]!.enclosing).toBe('HAND');
  });
  it('an envelope code we do not hold is only a hint: the envelope comes from the account configuration', async () => {
    const r = await run(many(2, { envCode: 'WH99999' }));
    expect(r.mailpieces).toHaveLength(2);
    expect(r.mailpieces[0]!.envelopeCode).toBe('WH21518');
  });
  it('a one-page letter sent in a C4 is downsized to a C5 letter, keeping the service', async () => {
    const m = (await run([{ ...many(1)[0]!, pages: 1, envCode: 'C4-REMUS', envText: 'C4 Envelope ref: Remus', method: '1st Class' }])).mailpieces[0]!;
    expect(m.postalFormat).toBe('Letter'); expect(m.envelopeSize).toBe('C5'); expect(m.postalService).toBe('1st Class');
  });
  it('16 sheets requested in a C4 still posts as a 98 g letter in a C5 (the C4 alone would push it over 100 g)', async () => {
    const m = (await run([{ ...many(1)[0]!, pages: 32, envCode: 'C4-REMUS', envText: 'C4 Envelope ref: Remus' }])).mailpieces[0]!;
    expect(m.sheets).toBe(16); expect(m.weightG).toBe(98); expect(m.postalFormat).toBe('Letter'); expect(m.envelopeSize).toBe('C5');
  });
  it('machine enclosing: C5 up to 12 sheets only; 13 to 16 sheets go to hand whatever the batch size', async () => {
    expect((await run(many(26, { pages: 24 }))).batches[0]!.enclosing).toBe('MACHINE');
    expect((await run(many(26, { pages: 26 }))).batches[0]!.enclosing).toBe('HAND');
  });
  it('the Brand passthrough (from the letter template) beats a brand typed in the envelope text', async () => {
    const m = (await run([{ ...many(1)[0]!, passthrough: { Brand: 'Crabtree' }, envText: 'C5 Envelope ref: Crabtree (Remus)' }])).mailpieces[0]!;
    expect(m.brand).toBe('Crabtree'); expect(m.envelopeCode).toBe('WH21519');
  });
  it('with no matching configuration the customer\'s own selection is used, with a warning', async () => {
    const r = await run([{ ...many(1)[0]!, envText: 'C5 Envelope ref: Nowhere', envCode: 'WH21518' }]);
    expect(r.persisted).toBe(true);
    expect(r.mailpieces[0]!.envelopeCode).toBe('WH21518');
    expect(r.issues.some((i) => i.severity === 'warning' && /selected envelope/.test(i.message))).toBe(true);
  });
  it('linked stock children add weight', async () => {
    const light = (await run([{ ...many(1)[0]!, pages: 2, inserts: ['INSERT-PARENT'] }])).mailpieces[0]!;
    // 1 sheet*5.625 + 5 + 4 + 8 (C5) = 22.625 -> 23
    expect(light.weightG).toBe(23);
  });
  it('page count alone forces a larger format (17+ sheets)', async () => {
    const m = (await run([{ ...many(1)[0]!, pages: 34 }])).mailpieces[0]!;
    expect(m.sheets).toBe(17); expect(m.postalFormat).toBe('Large Letter'); expect(m.envelopeSize).toBe('C4');
  });
  it('merged packs add their sheets (8+8) into one weight', async () => {
    const m = (await run([person('A', 'B', { pages: 16 }), person('A', 'B', { pages: 16 })])).mailpieces[0]!;
    expect(m.sheets).toBe(16); expect(m.postalFormat).toBe('Letter'); expect(m.weightG).toBe(98); // 16*5.625 + 8 (C5) = 98
  });
  it('simplex counts one sheet per page', async () => {
    expect((await run([{ ...many(1)[0]!, pages: 3, duplex: false }])).mailpieces[0]!.sheets).toBe(3);
  });
  it('blank-brand account falls back to envelope config by stock code', async () => {
    const r = await run([{ ...many(1)[0]!, brand: null, account: 'FEXCO' }]);
    expect(r.packs[0]!.brand).toBe('Remus');
  });
});

describe('file validation', () => {
  it('rejects non-v6', () => { expect(() => parseHpodV6(buildXml([{}], '5').xml)).toThrow(/v6 only/); });
  it('rejects malformed xml', () => { expect(() => parseHpodV6('<Packs xmlns="http://www.h-pod.co.uk/export/6" Version="6"><Pack>')).toThrow(); });
  it('PDF page mismatch is an error and nothing is persisted', async () => {
    const repo = new InMemoryRepository();
    const r = await run([{}, {}], { repo, pdfPages: 99 });
    expect(r.issues.some((i) => i.severity === 'error' && /PDF has 99/.test(i.message))).toBe(true);
    expect(r.persisted).toBe(false); expect(repo.jobs).toHaveLength(0);
  });
  it('gap in page ranges is an error', async () => {
    const { xml } = buildXml([{ pages: 2 }, { pages: 2 }]);
    const bad = xml.replace('StartPage="3"', 'StartPage="4"');
    const r = await ingest(bad, 't', 'x', { ref: fixtureReference(), pdf: new FakePdf(4), repo: new InMemoryRepository() });
    expect(r.issues.some((i) => /gap or overlap/.test(i.message))).toBe(true);
  });
  it('an unknown account rejects the job', async () => {
    expect((await run([{ account: 'NOPE' }])).persisted).toBe(false);
  });
  it('re-ingesting the same file skips every pack (duplicate guid)', async () => {
    const repo = new InMemoryRepository();
    const specs = [{ guid: '11111111-1111-4111-8111-111111111111' }, { guid: '22222222-2222-4222-8222-222222222222' }];
    expect((await run(specs, { repo })).persisted).toBe(true);
    const again = await run(specs, { repo });
    expect(again.duplicates).toHaveLength(2); expect(again.packs).toHaveLength(0); expect(repo.jobs).toHaveLength(1);
  });
  it('more than six address lines are kept (FileMaker silently dropped them)', async () => {
    const r = await run([{ lines: ['A B', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'AB1 2CD'] }]);
    expect(r.packs[0]!.address.lines).toHaveLength(8);
  });
});

describe('account tree: batching boundary and invoicing account', () => {
  /** Three sub-accounts under one root (FEXCO): A and B are invoiced to FEXCO, C is invoiced to itself. */
  const tree = () => {
    const ref = fixtureReference(); const base = ref.accounts.get('FEXCO')!;
    for (const [code, invoicing] of [['FEXCO_A', 'FEXCO'], ['FEXCO_B', 'FEXCO'], ['FEXCO_C', 'FEXCO_C']] as const)
      ref.accounts.set(code, { ...base, code, customerCode: 'FEXCO', invoicingCode: invoicing });
    return ref;
  };
  const one = (account: string, n: string): PackSpec => ({ account, first: 'P', surname: n, lines: [`P ${n}`, '1 Rd', 'AB1 2CD'] });

  it('sub-accounts under one root with the same invoicing account share a batch', async () => {
    const r = await run([one('FEXCO_A', 'X1'), one('FEXCO_B', 'X2')], { ref: tree() });
    expect(r.batches).toHaveLength(1);
    expect(r.batches[0]).toMatchObject({ accountCode: 'FEXCO', invoicingCode: 'FEXCO' });
  });
  it('different invoicing accounts never share a batch, even with the same envelope and brand', async () => {
    const r = await run([one('FEXCO_A', 'X1'), one('FEXCO_C', 'X2')], { ref: tree() });
    expect(r.batches.map((b) => b.invoicingCode).sort()).toEqual(['FEXCO', 'FEXCO_C']);
    expect(new Set(r.mailpieces.map((m) => m.batchKey)).size).toBe(2);
  });
  it('the same recipient in two sub-accounts is not merged by default, even under one invoicing account', async () => {
    const r = await run([one('FEXCO_A', 'SAME'), one('FEXCO_B', 'SAME')], { ref: tree() });
    expect(r.mailpieces).toHaveLength(2);
    expect(r.batches).toHaveLength(1);
  });
  it('the same recipient in one sub-account still merges', async () => {
    const r = await run([one('FEXCO_A', 'SAME'), one('FEXCO_A', 'SAME')], { ref: tree() });
    expect(r.mailpieces).toHaveLength(1);
  });
});
