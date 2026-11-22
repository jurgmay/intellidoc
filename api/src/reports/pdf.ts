import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Counts, UsageReport } from './types.js';

const W = 595.28, H = 841.89, M = 40;
const PALETTE = [rgb(0.16, 0.36, 0.64), rgb(0.9, 0.5, 0.13), rgb(0.2, 0.6, 0.4), rgb(0.7, 0.25, 0.45), rgb(0.45, 0.4, 0.75), rgb(0.55, 0.55, 0.2), rgb(0.6, 0.6, 0.6)];
const INK = rgb(0.1, 0.1, 0.12), MUTED = rgb(0.4, 0.4, 0.45), RULE = rgb(0.8, 0.8, 0.85);
const fmtDay = (d: string): string => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const n = (v: number): string => v.toLocaleString('en-GB');
const gbp = (v: number): string => `£${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "Other" collects every brand beyond the first six, so the chart legend stays readable. */
export function chartBrands(r: UsageReport, max = 6): string[] {
  const names = r.brands.map((b) => b.brand);
  return names.length <= max + 1 ? names : [...names.slice(0, max), 'Other'];
}

/** The daily usage report for one invoicing account: a stacked bar chart of mailpieces per day, then the numbers. */
export async function usagePdf(r: UsageReport, generated: Date): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Daily usage - ${r.account.name} - ${r.from} to ${r.to}`);
  doc.setProducer('IntelliDoc');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage; let y = 0;
  const newPage = (): void => { page = doc.addPage([W, H]); y = H - M; };
  const text = (s: string, x: number, yy: number, size = 9, f: PDFFont = font, color = INK): void => { page.drawText(s, { x, y: yy, size, font: f, color }); };
  const right = (s: string, xRight: number, yy: number, size = 9, f: PDFFont = font): void => text(s, xRight - f.widthOfTextAtSize(s, size), yy, size, f);
  const need = (h: number): void => { if (y - h < M + 20) newPage(); };

  newPage();
  text('Daily usage', M, y - 18, 20, bold); y -= 40;
  text(`${r.account.name} (${r.account.code})`, M, y, 12, bold); y -= 16;
  text(`${fmtDay(r.from)} to ${fmtDay(r.to)}  |  by the day the mailpieces were produced  |  produced ${generated.toISOString().slice(0, 16).replace('T', ' ')} UTC`, M, y, 8, font, MUTED); y -= 26;

  // Totals
  const tiles: [string, string][] = [['Mailpieces', n(r.totals.mailpieces)], ['Packs', n(r.totals.packs)], ['Sheets', n(r.totals.sheets)],
    ['Production', gbp(r.totals.productionSell)], ['Postage', gbp(r.totals.postageSell)], ['Total', gbp(r.totals.totalSell)]];
  tiles.forEach(([label, v], i) => { const x = M + i * 86; text(label, x, y, 8, font, MUTED); text(v, x, y - 18, 13, bold); });
  y -= 44;
  if (r.totals.unpriced > 0) { text(`${n(r.totals.unpriced)} of ${n(r.totals.mailpieces)} mailpieces are not priced yet and are not in the amounts.`, M, y, 9, bold, rgb(0.7, 0.35, 0)); y -= 16; }
  text('Amounts are sell prices, excluding VAT.', M, y, 7, font, MUTED); y -= 20;

  // Stacked bars
  const brands = chartBrands(r);
  const group = (b: string): string => (brands.includes(b) ? b : 'Other');
  const chartH = 150, chartW = W - 2 * M - 30, base = y - chartH - 14;
  const stacks = r.days.map((d) => { const m = new Map<string, number>(); for (const [b, v] of Object.entries(d.byBrand)) m.set(group(b), (m.get(group(b)) ?? 0) + v); return m; });
  const peak = Math.max(1, ...r.days.map((d) => d.mailpieces));
  const nice = (() => { const mag = 10 ** Math.floor(Math.log10(peak)); return [1, 2, 5, 10].map((k) => k * mag).find((v) => v >= peak)!; })();
  for (let i = 0; i <= 4; i++) {
    const gy = base + (chartH * i) / 4;
    page!.drawLine({ start: { x: M + 30, y: gy }, end: { x: M + 30 + chartW, y: gy }, thickness: 0.4, color: RULE });
    right(n((nice * i) / 4), M + 26, gy - 3, 7, font);
  }
  const slot = chartW / r.days.length, bw = Math.max(1, Math.min(24, slot * 0.7));
  const every = Math.ceil(r.days.length / 16);
  r.days.forEach((d, i) => {
    const x = M + 30 + i * slot + (slot - bw) / 2;
    let top = base;
    brands.forEach((b, bi) => {
      const v = stacks[i]!.get(b) ?? 0;
      if (!v) return;
      const h = (v / nice) * chartH;
      page!.drawRectangle({ x, y: top, width: bw, height: h, color: PALETTE[Math.min(bi, PALETTE.length - 1)]! });
      top += h;
    });
    if (i % every === 0) text(d.day.slice(8, 10), x + bw / 2 - 4, base - 11, 7, font, MUTED);
  });
  y = base - 28;
  if (r.totals.mailpieces === 0) text('Nothing was produced in this period.', M + 30, base + chartH / 2, 10, font, MUTED);
  let lx = M;
  brands.forEach((b, bi) => {
    const w = font.widthOfTextAtSize(b, 8) + 22;
    if (lx + w > W - M) { lx = M; y -= 13; }
    page!.drawRectangle({ x: lx, y: y - 1, width: 8, height: 8, color: PALETTE[Math.min(bi, PALETTE.length - 1)]! });
    text(b, lx + 12, y, 8); lx += w;
  });
  y -= 28;

  // Tables
  type Col = { head: string; x: number; align: 'l' | 'r' };
  const table = (title: string, cols: Col[], rows: string[][], foot?: string[]): void => {
    need(60); text(title, M, y, 11, bold); y -= 16;
    const head = (): void => { cols.forEach((c) => (c.align === 'r' ? right(c.head, c.x, y, 8, bold) : text(c.head, c.x, y, 8, bold))); y -= 4; page!.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: INK }); y -= 11; };
    head();
    const line = (cells: string[], f: PDFFont): void => { need(14); cells.forEach((v, i) => (cols[i]!.align === 'r' ? right(v, cols[i]!.x, y, 9, f) : text(v, cols[i]!.x, y, 9, f))); y -= 13; };
    if (!rows.length) { text('None', M, y, 9, font, MUTED); y -= 13; }
    for (const row of rows) { if (y - 14 < M + 20) { newPage(); head(); } line(row, font); }
    if (foot) { page!.drawLine({ start: { x: M, y: y + 9 }, end: { x: W - M, y: y + 9 }, thickness: 0.4, color: RULE }); line(foot, bold); }
    y -= 14;
  };
  const num = (c: Counts): string[] => [n(c.mailpieces), n(c.packs), n(c.sheets), gbp(c.productionSell), gbp(c.postageSell), gbp(c.totalSell)];
  const R = W - M;
  const figures = (first: Col[]): Col[] => [...first, { head: 'Mailpieces', x: R - 300, align: 'r' }, { head: 'Packs', x: R - 250, align: 'r' }, { head: 'Sheets', x: R - 205, align: 'r' },
    { head: 'Production', x: R - 122, align: 'r' }, { head: 'Postage', x: R - 61, align: 'r' }, { head: 'Total', x: R, align: 'r' }];
  table('By day', figures([{ head: 'Day', x: M, align: 'l' }]), r.days.filter((d) => d.mailpieces > 0).map((d) => [fmtDay(d.day), ...num(d)]), ['Total', ...num(r.totals)]);
  table('By brand', figures([{ head: 'Brand', x: M, align: 'l' }]), r.brands.map((b) => [b.brand, ...num(b)]));
  table('By postal format and service', figures([{ head: 'Format', x: M, align: 'l' }, { head: 'Service', x: M + 85, align: 'l' }]), r.postage.map((p) => [p.format, p.service, ...num(p)]));

  doc.getPages().forEach((p, i, all) => p.drawText(`Page ${i + 1} of ${all.length}`, { x: W - M - 50, y: M - 14, size: 7, font, color: MUTED }));
  return doc.save();
}
