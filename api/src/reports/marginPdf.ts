import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { MarginCounts, MarginReport } from './types.js';

// The same page, fonts, colours and table style as the usage report (pdf.ts).
const W = 595.28, H = 841.89, M = 40;
const BLUE = rgb(0.16, 0.36, 0.64), ORANGE = rgb(0.9, 0.5, 0.13), RED = rgb(0.75, 0.15, 0.15);
const INK = rgb(0.1, 0.1, 0.12), MUTED = rgb(0.4, 0.4, 0.45), RULE = rgb(0.8, 0.8, 0.85);
const fmtDay = (d: string): string => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const n = (v: number): string => v.toLocaleString('en-GB');
const gbp = (v: number): string => `${v < 0 ? '-' : ''}£${Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (v: number | null): string => (v === null ? '-' : `${v.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);

/** The margin report for one invoicing account, styled like the usage report: a chart of sell against cost for each day, then the numbers. Internal: it shows costs. */
export async function marginPdf(r: MarginReport, generated: Date): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Margin report - ${r.account.name} - ${r.from} to ${r.to}`);
  doc.setProducer('IntelliDoc');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage; let y = 0;
  const newPage = (): void => { page = doc.addPage([W, H]); y = H - M; };
  const text = (s: string, x: number, yy: number, size = 9, f: PDFFont = font, color = INK): void => { page.drawText(s, { x, y: yy, size, font: f, color }); };
  const right = (s: string, xRight: number, yy: number, size = 9, f: PDFFont = font, color = INK): void => text(s, xRight - f.widthOfTextAtSize(s, size), yy, size, f, color);
  const need = (h: number): void => { if (y - h < M + 20) newPage(); };
  const t = r.totals;

  newPage();
  text('Margin report', M, y - 18, 20, bold); y -= 40;
  text(`${r.account.name} (${r.account.code})`, M, y, 12, bold); y -= 16;
  text(`${fmtDay(r.from)} to ${fmtDay(r.to)}  |  by the day the mailpieces were produced  |  produced ${generated.toISOString().slice(0, 16).replace('T', ' ')} UTC`, M, y, 8, font, MUTED); y -= 14;
  text('INTERNAL - shows costs. Do not send to the customer.', M, y, 8, bold, RED); y -= 22;

  // Totals
  const tiles: [string, string, boolean][] = [['Sell', gbp(t.sell), false], ['Cost', gbp(t.cost), false], ['Margin', gbp(t.margin), t.margin < 0], ['Margin %', pct(t.marginPct), t.margin < 0]];
  tiles.forEach(([label, v, neg], i) => { const x = M + i * 110; text(label, x, y, 8, font, MUTED); text(v, x, y - 18, 13, bold, neg ? RED : INK); });
  y -= 44;
  if (t.unpriced > 0) { text(`${n(t.unpriced)} of ${n(t.mailpieces)} mailpieces are not priced yet and are not in the amounts.`, M, y, 9, bold, rgb(0.7, 0.35, 0)); y -= 16; }
  text('Sell is what would be invoiced, excluding VAT. Margin is sell minus cost.', M, y, 7, font, MUTED); y -= 20;

  // Sell and cost for each day, side by side
  const chartH = 150, chartW = W - 2 * M - 30, base = y - chartH - 14;
  const peak = Math.max(1, ...r.days.map((d) => Math.max(d.sell, d.cost)));
  const nice = (() => { const mag = 10 ** Math.floor(Math.log10(peak)); return [1, 2, 5, 10].map((k) => k * mag).find((v) => v >= peak)!; })();
  for (let i = 0; i <= 4; i++) {
    const gy = base + (chartH * i) / 4;
    page!.drawLine({ start: { x: M + 30, y: gy }, end: { x: M + 30 + chartW, y: gy }, thickness: 0.4, color: RULE });
    right(`£${n((nice * i) / 4)}`, M + 26, gy - 3, 7);
  }
  const slot = chartW / r.days.length, bw = Math.max(1, Math.min(12, slot * 0.35));
  const every = Math.ceil(r.days.length / 16);
  r.days.forEach((d, i) => {
    const x = M + 30 + i * slot + (slot - 2 * bw) / 2;
    if (d.sell > 0) page!.drawRectangle({ x, y: base, width: bw, height: (d.sell / nice) * chartH, color: BLUE });
    if (d.cost > 0) page!.drawRectangle({ x: x + bw, y: base, width: bw, height: (d.cost / nice) * chartH, color: ORANGE });
    if (i % every === 0) text(d.day.slice(8, 10), x + bw - 4, base - 11, 7, font, MUTED);
  });
  y = base - 28;
  if (t.mailpieces === 0) text('Nothing was produced in this period.', M + 30, base + chartH / 2, 10, font, MUTED);
  [['Sell', BLUE], ['Cost', ORANGE]].forEach(([label, color], i) => {
    const lx = M + i * 60;
    page!.drawRectangle({ x: lx, y: y - 1, width: 8, height: 8, color: color as ReturnType<typeof rgb> });
    text(label as string, lx + 12, y, 8);
  });
  y -= 28;

  // Tables
  type Col = { head: string; x: number; align: 'l' | 'r' };
  const table = (title: string, cols: Col[], rows: { cells: string[]; negative: boolean }[], foot?: { cells: string[]; negative: boolean }): void => {
    need(60); text(title, M, y, 11, bold); y -= 16;
    const head = (): void => { cols.forEach((c) => (c.align === 'r' ? right(c.head, c.x, y, 8, bold) : text(c.head, c.x, y, 8, bold))); y -= 4; page!.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: INK }); y -= 11; };
    head();
    // a negative margin has its margin figures in red
    const line = (row: { cells: string[]; negative: boolean }, f: PDFFont): void => {
      need(14);
      row.cells.forEach((v, i) => { const red = row.negative && i >= cols.length - 2; if (cols[i]!.align === 'r') right(v, cols[i]!.x, y, 9, f, red ? RED : INK); else text(v, cols[i]!.x, y, 9, f, INK); });
      y -= 13;
    };
    if (!rows.length) { text('None', M, y, 9, font, MUTED); y -= 13; }
    for (const row of rows) { if (y - 14 < M + 20) { newPage(); head(); } line(row, font); }
    if (foot) { page!.drawLine({ start: { x: M, y: y + 9 }, end: { x: W - M, y: y + 9 }, thickness: 0.4, color: RULE }); line(foot, bold); }
    y -= 14;
  };
  const row = (first: string[], c: MarginCounts) => ({ cells: [...first, n(c.mailpieces), gbp(c.sell), gbp(c.cost), gbp(c.margin), pct(c.marginPct)], negative: c.margin < 0 });
  const R = W - M;
  const figures = (first: Col[]): Col[] => [...first, { head: 'Mailpieces', x: R - 255, align: 'r' }, { head: 'Sell', x: R - 190, align: 'r' }, { head: 'Cost', x: R - 130, align: 'r' }, { head: 'Margin', x: R - 70, align: 'r' }, { head: 'Margin %', x: R, align: 'r' }];
  const split = (label: string, sell: number, cost: number) => {
    const margin = Math.round((sell - cost) * 1e4) / 1e4;
    return { cells: [label, '-', gbp(sell), gbp(cost), gbp(margin), pct(sell > 0 ? Math.round((margin / sell) * 1000) / 10 : null)], negative: margin < 0 };
  };
  table('Production and postage', figures([{ head: '', x: M, align: 'l' }]), [split('Production', t.productionSell, t.productionCost), split('Postage', t.postageSell, t.postageCost)]);
  table('By day', figures([{ head: 'Day', x: M, align: 'l' }]), r.days.filter((d) => d.mailpieces > 0).map((d) => row([fmtDay(d.day)], d)), row(['Total'], t));
  table('By brand', figures([{ head: 'Brand', x: M, align: 'l' }]), r.brands.map((b) => row([b.brand], b)));
  table('By postal format and service', figures([{ head: 'Format', x: M, align: 'l' }, { head: 'Service', x: M + 85, align: 'l' }]), r.postage.map((p) => row([p.format, p.service], p)));

  doc.getPages().forEach((p, i, all) => p.drawText(`Page ${i + 1} of ${all.length}`, { x: W - M - 50, y: M - 14, size: 7, font, color: MUTED }));
  return doc.save();
}
