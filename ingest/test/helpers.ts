import type { PageInk } from '../src/pdfInk.js';
import type { PdfInspector } from '../src/pdf.js';
import { InMemoryRepository } from '../src/repository.js';
import { ingest } from '../src/ingest.js';
import { fixtureReference } from '../src/fixtureReference.js';
import type { ReferenceData } from '../src/reference.js';

export interface PackSpec {
  guid?: string; pages?: number; account?: string; lines?: string[]; first?: string; surname?: string; postcode?: string;
  brand?: string | null; envCode?: string; envText?: string; method?: string; inserts?: string[]; passthrough?: Record<string, string>; duplex?: boolean;
}
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
let n = 0;
export function buildXml(specs: PackSpec[], version = '6'): { xml: string; pages: number } {
  let page = 1;
  const parts = specs.map((s) => {
    const pages = s.pages ?? 2; const start = page; page += pages;
    const guid = s.guid ?? `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
    const pc = s.postcode ?? 'AB1 2CD';
    const lines = s.lines ?? [`${s.first ?? 'A'} ${s.surname ?? 'Smith'}`, '1 High Street', 'Town', pc];
    const brand = s.brand === undefined ? 'Remus' : s.brand;
    const pt = { ...(brand ? { Brand: brand } : {}), ...(s.passthrough ?? {}) };
    return `<Pack Guid="${guid}" PageCount="${pages}" StartPage="${start}" EndPage="${start + pages - 1}" Status="Processed" DeliveryPointSuffix="" ReleaseDate="2026-01-01T00:00:00Z" AttachmentCount="0">
<Source Guid="2ce8e2ed-b620-4ce3-9ef7-f52f7b449789" OwnerAccount="${s.account ?? 'FEXCO'}" OwnerUser="u" />
<Address FirstName="${esc(s.first ?? 'A')}" Surname="${esc(s.surname ?? 'Smith')}" Postcode="${pc}" Country="gb">${lines.map((l) => `<Line>${esc(l)}</Line>`).join('')}</Address>
<Options><Colour Value="Colour" /><DeliveryMethod DeliveryBand="Letter (Up to 100g)" Value="${s.method ?? '2nd Class'}" /><Envelope Value="${s.envText ?? 'C5 Envelope ref: Remus'}" Code="${s.envCode ?? 'WH21518'}" /><Duplex Value="${s.duplex === false ? 'No' : 'Yes'}" /><Paper Value="A4 White" /></Options>
${s.inserts?.length ? `<Inserts>${s.inserts.map((c) => `<Insert Code="${c}" Name="n" PublicationDate="" />`).join('')}</Inserts>` : ''}
<Passthrough>${Object.entries(pt).map(([k, v]) => `<Item Name="${k}" Value="${esc(v)}" />`).join('')}</Passthrough></Pack>`;
  });
  return { xml: `<Packs xmlns="http://www.h-pod.co.uk/export/6" Version="${version}">${parts.join('')}</Packs>`, pages: page - 1 };
}
export class FakePdf implements PdfInspector {
  /** `ink` is the colour of each page; the default is every page mono. */
  constructor(public pages: number, public text = '', public ink?: PageInk[]) {}
  async pageInk(): Promise<PageInk[]> { return this.ink ?? Array<PageInk>(this.pages).fill('mono'); }
  async pageCount(): Promise<number> { return this.pages; }
  async pageText(): Promise<string> { return this.text; }
}
export async function run(specs: PackSpec[], opt: { ref?: ReferenceData; repo?: InMemoryRepository; version?: string; pdfPages?: number } = {}) {
  const { xml, pages } = buildXml(specs, opt.version);
  return ingest(xml, 't.xml', 'x.pdf', { ref: opt.ref ?? fixtureReference(), pdf: new FakePdf(opt.pdfPages ?? pages), repo: opt.repo ?? new InMemoryRepository() });
}
