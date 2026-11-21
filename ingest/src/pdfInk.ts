import { decodePDFRawStream, PDFArray, PDFBool, PDFContext, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFStream, type PDFObject } from 'pdf-lib';

/**
 * What a printed page carries, for the print and price calculations:
 *  - blank: nothing is printed on it at all
 *  - mono: everything on it is black or a grey: RGB with equal red, green and blue (0,0,0, 79,79,79 ...), CMYK with only black ink
 *    (0,0,0,K), or a plain grey level, including greyscale images
 *  - colour: anything on it has any colour in it (RGB values that differ, any cyan, magenta or yellow ink)
 * White ink is not ink: a white box or white text on the white page is not counted as a mark.
 */
export type PageInk = 'blank' | 'mono' | 'colour';
export interface InkCounts { colour: number; mono: number; blank: number }

type Ink = 'black' | 'white' | 'other';
interface Space { kind: 'gray' | 'rgb' | 'cmyk' | 'pattern' | 'separation' | 'other'; n: number; name?: string }
interface State { fill: Ink; stroke: Ink; fillSpace: Space; strokeSpace: Space; textMode: number }

const GRAY: Space = { kind: 'gray', n: 1 };
const RGB: Space = { kind: 'rgb', n: 3 };
const CMYK: Space = { kind: 'cmyk', n: 4 };
const OTHER: Space = { kind: 'other', n: 0 };
const initial = (): State => ({ fill: 'black', stroke: 'black', fillSpace: GRAY, strokeSpace: GRAY, textMode: 0 });

/** Black, white or something else, for the components of a colour in a colour space. */
function classify(space: Space, v: number[]): Ink {
  const allZero = v.every((x) => x === 0);
  switch (space.kind) {
    case 'gray': return v[0] === 1 ? 'white' : 'black'; // any grey level is mono
    case 'rgb': return v.every((x) => x === v[0]) ? (v[0] === 1 ? 'white' : 'black') : 'other'; // equal R, G and B is a grey
    case 'cmyk': return v[0] === 0 && v[1] === 0 && v[2] === 0 ? (v[3] === 0 ? 'white' : 'black') : 'other'; // black ink only
    case 'separation':
      if (v[0] === 0 || space.name === 'None') return 'white'; // no ink
      return space.name === 'Black' ? 'black' : 'other';
    case 'other': return space.n > 0 && allZero ? 'white' : 'other';
    default: return 'other'; // patterns
  }
}

/** The colour a colour space starts with when it is selected (the PDF specification's initial colours). */
function initialInk(space: Space): Ink {
  switch (space.kind) {
    case 'gray': case 'rgb': case 'cmyk': return 'black';
    case 'separation': return space.name === 'Black' ? 'black' : space.name === 'None' ? 'white' : 'other';
    default: return 'other';
  }
}

// ---- content stream lexer ----------------------------------------------------------------------------------------------------------------

type Tok = { t: 'num'; v: number } | { t: 'name'; v: string } | { t: 'str'; v: Uint8Array } | { t: 'op'; v: string } | { t: 'open' } | { t: 'close' } | { t: 'dopen' } | { t: 'dclose' };
const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);
const isReg = (c: number): boolean => !WS.has(c) && !DELIM.has(c);

class Lexer {
  pos = 0;
  constructor(readonly b: Uint8Array) {}
  private skipWs(): void {
    for (;;) {
      while (this.pos < this.b.length && WS.has(this.b[this.pos]!)) this.pos++;
      if (this.b[this.pos] === 0x25) { while (this.pos < this.b.length && this.b[this.pos] !== 10 && this.b[this.pos] !== 13) this.pos++; } else return;
    }
  }
  next(): Tok | null {
    this.skipWs();
    const b = this.b; const c = b[this.pos];
    if (c === undefined) return null;
    if (c === 0x2f) { // /Name
      let s = ''; this.pos++;
      while (this.pos < b.length && isReg(b[this.pos]!)) {
        let ch = b[this.pos]!;
        if (ch === 0x23 && this.pos + 2 < b.length) { const h = parseInt(String.fromCharCode(b[this.pos + 1]!, b[this.pos + 2]!), 16); if (!Number.isNaN(h)) { ch = h; this.pos += 2; } }
        s += String.fromCharCode(ch); this.pos++;
      }
      return { t: 'name', v: s };
    }
    if (c === 0x28) { // (string)
      let depth = 1; this.pos++; const out: number[] = [];
      while (this.pos < b.length && depth > 0) {
        const ch = b[this.pos++]!;
        if (ch === 0x5c) { const e = b[this.pos++]; if (e === 0x6e) out.push(10); else if (e === 0x72) out.push(13); else if (e === 0x74) out.push(9); else if (e !== undefined && e >= 0x30 && e <= 0x37) { let o = e - 0x30; for (let i = 0; i < 2 && b[this.pos]! >= 0x30 && b[this.pos]! <= 0x37; i++) o = o * 8 + (b[this.pos++]! - 0x30); out.push(o & 255); } else if (e !== undefined && e !== 10 && e !== 13) out.push(e); }
        else if (ch === 0x28) { depth++; out.push(ch); } else if (ch === 0x29) { depth--; if (depth > 0) out.push(ch); } else out.push(ch);
      }
      return { t: 'str', v: Uint8Array.from(out) };
    }
    if (c === 0x3c) {
      if (b[this.pos + 1] === 0x3c) { this.pos += 2; return { t: 'dopen' }; }
      this.pos++; const out: number[] = []; let hi = -1;
      while (this.pos < b.length && b[this.pos] !== 0x3e) {
        const h = parseInt(String.fromCharCode(b[this.pos]!), 16); this.pos++;
        if (Number.isNaN(h)) continue;
        if (hi < 0) hi = h; else { out.push(hi * 16 + h); hi = -1; }
      }
      if (hi >= 0) out.push(hi * 16);
      this.pos++; return { t: 'str', v: Uint8Array.from(out) };
    }
    if (c === 0x3e) { if (b[this.pos + 1] === 0x3e) { this.pos += 2; return { t: 'dclose' }; } this.pos++; return this.next(); }
    if (c === 0x5b) { this.pos++; return { t: 'open' }; }
    if (c === 0x5d) { this.pos++; return { t: 'close' }; }
    if (c === 0x7b || c === 0x7d || c === 0x29) { this.pos++; return this.next(); }
    const start = this.pos;
    while (this.pos < b.length && isReg(b[this.pos]!)) this.pos++;
    const word = String.fromCharCode(...b.subarray(start, this.pos));
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { t: 'num', v: Number(word) };
    return { t: 'op', v: word };
  }
  /** After "ID": skip the image data up to the "EI" that ends it. */
  skipInlineData(): void {
    if (WS.has(this.b[this.pos] ?? 0)) this.pos++;
    for (let i = this.pos; i < this.b.length - 1; i++) {
      if (this.b[i] === 0x45 && this.b[i + 1] === 0x49 && WS.has(this.b[i - 1] ?? 32) && (i + 2 >= this.b.length || WS.has(this.b[i + 2]!))) { this.pos = i + 2; return; }
    }
    this.pos = this.b.length;
  }
}

// ---- interpreter -------------------------------------------------------------------------------------------------------------------------

type Operand = number | string | Uint8Array | Operand[] | { dict: Record<string, Operand> };

class PageScan {
  marks = { black: false, other: false };
  private visited = new Set<PDFObject>();
  constructor(private readonly ctx: PDFContext) {}

  private lookup<T extends PDFObject>(o: PDFObject | undefined, type: { prototype: T }): T | undefined { return o === undefined ? undefined : this.ctx.lookupMaybe(o, type as never) as T | undefined; }
  private streamBytes(s: PDFStream): Uint8Array { return s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : s.getContents(); }

  private contentBytes(contents: PDFObject | undefined): Uint8Array {
    const parts: Uint8Array[] = [];
    const one = (o: PDFObject | undefined): void => {
      const v = o === undefined ? undefined : this.ctx.lookup(o);
      if (v instanceof PDFArray) for (let i = 0; i < v.size(); i++) one(v.get(i));
      else if (v instanceof PDFStream) { try { parts.push(this.streamBytes(v), Uint8Array.of(10)); } catch { /* an unreadable stream marks nothing */ } }
    };
    one(contents);
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  private space(name: string, res: PDFDict | undefined): Space {
    if (name === 'DeviceGray' || name === 'G' || name === 'CalGray') return GRAY;
    if (name === 'DeviceRGB' || name === 'RGB' || name === 'CalRGB') return RGB;
    if (name === 'DeviceCMYK' || name === 'CMYK') return CMYK;
    if (name === 'Pattern') return { kind: 'pattern', n: 0 };
    const spaces = this.lookup(res?.get(PDFName.of('ColorSpace')), PDFDict);
    const def = spaces ? this.ctx.lookup(spaces.get(PDFName.of(name))) : undefined;
    return def ? this.spaceOf(def) : OTHER;
  }
  private spaceOf(def: PDFObject): Space {
    if (def instanceof PDFName) return this.space(def.decodeText(), undefined);
    if (!(def instanceof PDFArray) || def.size() === 0) return OTHER;
    const kind = (this.ctx.lookup(def.get(0)) as PDFName).decodeText?.();
    if (kind === 'ICCBased') {
      const s = this.lookup(def.get(1), PDFStream);
      const n = s ? (this.lookup(s.dict.get(PDFName.of('N')), PDFNumber)?.asNumber() ?? 0) : 0;
      return n === 1 ? GRAY : n === 3 ? RGB : n === 4 ? CMYK : OTHER;
    }
    if (kind === 'CalGray') return GRAY;
    if (kind === 'CalRGB') return RGB;
    if (kind === 'Separation') return { kind: 'separation', n: 1, name: this.lookup(def.get(1), PDFName)?.decodeText() };
    if (kind === 'DeviceN') return { kind: 'other', n: (this.lookup(def.get(1), PDFArray)?.size()) ?? 0 };
    return OTHER; // Indexed, Lab, Pattern with an underlying space
  }

  private mark(ink: Ink): void { if (ink === 'black') this.marks.black = true; else if (ink === 'other') this.marks.other = true; }

  run(bytes: Uint8Array, res: PDFDict | undefined, state: State, depth: number): void {
    const lx = new Lexer(bytes); const stack: State[] = [];
    let s = state; let ops: Operand[] = [];
    const stackOfArrays: Operand[][] = [];
    const num = (i: number): number => (typeof ops[i] === 'number' ? (ops[i] as number) : NaN);
    const nums = (): number[] => ops.filter((o): o is number => typeof o === 'number');
    for (let tok = lx.next(); tok; tok = lx.next()) {
      switch (tok.t) {
        case 'num': (stackOfArrays.at(-1) ?? ops).push(tok.v); continue;
        case 'name': (stackOfArrays.at(-1) ?? ops).push(tok.v); continue;
        case 'str': (stackOfArrays.at(-1) ?? ops).push(tok.v); continue;
        case 'open': stackOfArrays.push([]); continue;
        case 'close': { const a = stackOfArrays.pop(); if (a) (stackOfArrays.at(-1) ?? ops).push(a); continue; }
        case 'dopen': case 'dclose': continue;
        default: break;
      }
      const op = tok.v;
      switch (op) {
        case 'q': stack.push({ ...s }); break;
        case 'Q': if (stack.length) s = stack.pop()!; break;
        case 'g': s.fill = classify(GRAY, nums()); s.fillSpace = GRAY; break;
        case 'G': s.stroke = classify(GRAY, nums()); s.strokeSpace = GRAY; break;
        case 'rg': s.fill = classify(RGB, nums()); s.fillSpace = RGB; break;
        case 'RG': s.stroke = classify(RGB, nums()); s.strokeSpace = RGB; break;
        case 'k': s.fill = classify(CMYK, nums()); s.fillSpace = CMYK; break;
        case 'K': s.stroke = classify(CMYK, nums()); s.strokeSpace = CMYK; break;
        case 'cs': { const sp = this.space(String(ops[0]), res); s.fillSpace = sp; s.fill = initialInk(sp); break; }
        case 'CS': { const sp = this.space(String(ops[0]), res); s.strokeSpace = sp; s.stroke = initialInk(sp); break; }
        case 'sc': case 'scn': s.fill = ops.some((o) => typeof o === 'string') ? 'other' : classify(s.fillSpace, nums()); break;
        case 'SC': case 'SCN': s.stroke = ops.some((o) => typeof o === 'string') ? 'other' : classify(s.strokeSpace, nums()); break;
        case 'Tr': s.textMode = Number.isNaN(num(0)) ? 0 : num(0); break;
        case 'S': case 's': this.mark(s.stroke); break;
        case 'f': case 'F': case 'f*': this.mark(s.fill); break;
        case 'B': case 'B*': case 'b': case 'b*': this.mark(s.fill); this.mark(s.stroke); break;
        case 'sh': this.mark('other'); break;
        case 'Tj': case "'": case '"': case 'TJ': if (this.hasGlyphs(ops)) this.text(s); break;
        case 'BI': { // inline image: read its dictionary, then skip the data
          const dict: Record<string, Operand> = {}; let key: string | null = null;
          for (let t = lx.next(); t && !(t.t === 'op' && t.v === 'ID'); t = lx.next()) {
            if (t.t === 'name' && key === null) key = t.v;
            else if (key !== null && (t.t === 'num' || t.t === 'name' || t.t === 'op')) { dict[key] = t.t === 'op' ? (t.v === 'true' ? 1 : 0) : t.v; key = null; }
            else if (t.t === 'open') { let d = 1; while (d > 0) { const x = lx.next(); if (!x) break; if (x.t === 'open') d++; else if (x.t === 'close') d--; } key = null; }
          }
          lx.skipInlineData();
          const mask = dict['IM'] === 1 || dict['ImageMask'] === 1;
          const cs = String(dict['CS'] ?? dict['ColorSpace'] ?? ''); const bpc = Number(dict['BPC'] ?? dict['BitsPerComponent'] ?? 8);
          if (mask) this.mark(s.fill); else this.mark(cs === 'G' || cs === 'DeviceGray' ? 'black' : 'other');
          break;
        }
        case 'Do': this.xobject(String(ops[0]), res, s, depth); break;
        default: break;
      }
      ops = [];
    }
  }

  private hasGlyphs(ops: Operand[]): boolean {
    const bytes = (o: Operand): boolean => (o instanceof Uint8Array ? o.some((c) => c !== 0x20 && c !== 0) : Array.isArray(o) ? o.some(bytes) : false);
    return ops.some(bytes);
  }
  private text(s: State): void {
    const m = s.textMode;
    if (m === 3 || m === 7) return; // invisible, or only clips
    if (m === 0 || m === 2 || m === 4 || m === 6) this.mark(s.fill);
    if (m === 1 || m === 2 || m === 5 || m === 6) this.mark(s.stroke);
  }

  private xobject(name: string, res: PDFDict | undefined, s: State, depth: number): void {
    const xo = this.lookup(res?.get(PDFName.of('XObject')), PDFDict);
    const ref = xo?.get(PDFName.of(name));
    const obj = ref ? this.lookup(ref, PDFStream) : undefined;
    if (!obj) return;
    const subtype = (this.lookup(obj.dict.get(PDFName.of('Subtype')), PDFName))?.decodeText();
    if (subtype === 'Image') {
      if (this.lookup(obj.dict.get(PDFName.of('ImageMask')), PDFBool)?.asBoolean()) { this.mark(s.fill); return; }
      const bpc = this.lookup(obj.dict.get(PDFName.of('BitsPerComponent')), PDFNumber)?.asNumber() ?? 8;
      const cs = obj.dict.get(PDFName.of('ColorSpace'));
      const csObj = cs ? this.ctx.lookup(cs) : undefined;
      const sp = csObj ? this.spaceOf(csObj) : OTHER;
      this.mark(sp.kind === 'gray' ? 'black' : 'other'); // a greyscale image is mono; any other image may carry colour
    } else if (subtype === 'Form' && depth < 8 && !this.visited.has(obj)) {
      this.visited.add(obj);
      try { this.run(this.streamBytes(obj), this.lookup(obj.dict.get(PDFName.of('Resources')), PDFDict) ?? res, { ...s }, depth + 1); } finally { this.visited.delete(obj); }
    }
  }

  page(contents: PDFObject | undefined, res: PDFDict | undefined): PageInk {
    this.run(this.contentBytes(contents), res, initial(), 0);
    return this.marks.other ? 'colour' : this.marks.black ? 'mono' : 'blank';
  }
}

/** Looks at every page of a PDF. A page that cannot be read is counted as colour (the dearer, safer reading). */
export async function analysePageInk(bytes: Uint8Array): Promise<PageInk[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: false });
  return doc.getPages().map((p) => {
    try { return new PageScan(doc.context).page(p.node.get(PDFName.of('Contents')), p.node.Resources()); } catch { return 'colour' as const; }
  });
}

/** Colour, mono and blank pages for each pack, from the page list of the whole PDF (page numbers are 1-based and inclusive). */
export function inkPerRange(pages: PageInk[], ranges: { startPage: number; endPage: number }[]): InkCounts[] {
  return ranges.map((r) => {
    const c: InkCounts = { colour: 0, mono: 0, blank: 0 };
    for (const k of pages.slice(r.startPage - 1, r.endPage)) c[k]++;
    return c;
  });
}
