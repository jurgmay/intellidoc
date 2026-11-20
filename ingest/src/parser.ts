import { SaxesParser } from 'saxes';
import type { ParsedPack } from './types.js';

const NS = 'http://www.h-pod.co.uk/export/6';

export class ParseError extends Error {}

/** Streaming SAX parse of an H-POD v6 export. v6 only: anything else is rejected. */
export function parseHpodV6(xml: string): ParsedPack[] {
  const p = new SaxesParser({ xmlns: true, position: false });
  const packs: ParsedPack[] = [];
  let cur: ParsedPack | null = null;
  let inElem: string | null = null; // Line | other leaf with text
  let text = '';
  let sawRoot = false;
  let err: Error | null = null;
  const stack: string[] = [];
  let inPassthrough = false;

  p.on('error', (e) => { err = e; });

  p.on('opentag', (t) => {
    const name = t.local;
    const a = (k: string): string => {
      const v = t.attributes[k];
      if (v === undefined) return '';
      return typeof v === 'string' ? v : v.value;
    };
    if (!sawRoot) {
      sawRoot = true;
      if (name !== 'Packs' || t.uri !== NS) throw new ParseError(`Not an H-POD v6 export (root ${t.uri}:${name})`);
      if (a('Version') !== '6') throw new ParseError(`Unsupported export version "${a('Version')}" (v6 only)`);
    }
    stack.push(name);
    switch (name) {
      case 'Pack':
        cur = {
          guid: a('Guid').toLowerCase(),
          pageCount: Number(a('PageCount')),
          startPage: Number(a('StartPage')),
          endPage: Number(a('EndPage')),
          status: a('Status'),
          deliveryPointSuffix: a('DeliveryPointSuffix'),
          releaseDate: a('ReleaseDate') || null,
          attachmentCount: Number(a('AttachmentCount') || 0),
          source: { guid: '', ownerAccount: '', ownerUser: '' },
          address: { firstName: '', surname: '', postcode: '', country: '', lines: [] },
          identifiers: [],
          options: { colour: '', deliveryBand: '', deliveryMethod: '', envelopeValue: '', envelopeCode: '', duplex: false, paper: '' },
          passthrough: {},
          inserts: [],
        };
        break;
      case 'Source':
        if (cur) cur.source = { guid: a('Guid'), ownerAccount: a('OwnerAccount'), ownerUser: a('OwnerUser') };
        break;
      case 'Address':
        if (cur) Object.assign(cur.address, { firstName: a('FirstName'), surname: a('Surname'), postcode: a('Postcode'), country: a('Country') });
        break;
      case 'Line':
        inElem = 'Line'; text = '';
        break;
      case 'Identifier':
        if (cur) cur.identifiers.push({ type: a('ExtractionZone'), value: a('Value') });
        break;
      case 'Colour': if (cur) cur.options.colour = a('Value'); break;
      case 'DeliveryMethod':
        if (cur) { cur.options.deliveryBand = a('DeliveryBand'); cur.options.deliveryMethod = a('Value'); }
        break;
      case 'Envelope': if (cur) { cur.options.envelopeValue = a('Value'); cur.options.envelopeCode = a('Code'); } break;
      case 'Duplex': if (cur) cur.options.duplex = a('Value').toLowerCase() === 'yes'; break;
      case 'Paper': if (cur) cur.options.paper = a('Value'); break;
      case 'Passthrough': inPassthrough = true; break;
      case 'Item':
        if (cur && inPassthrough) cur.passthrough[a('Name')] = a('Value');
        break;
      case 'Insert':
        if (cur) cur.inserts.push({ code: a('Code'), name: a('Name'), publicationDate: a('PublicationDate') });
        break;
      default: // Coverage/Band intentionally ignored (unused by IntelliDoc)
    }
  });
  p.on('text', (s) => { if (inElem) text += s; });
  p.on('closetag', (t) => {
    stack.pop();
    if (t.local === 'Line' && cur) { cur.address.lines.push(text); inElem = null; }
    if (t.local === 'Passthrough') inPassthrough = false;
    if (t.local === 'Pack' && cur) { packs.push(cur); cur = null; }
  });

  p.write(xml).close();
  if (err) throw new ParseError(`Malformed XML: ${(err as Error).message}`);
  if (!sawRoot) throw new ParseError('Empty XML document');
  return packs;
}
