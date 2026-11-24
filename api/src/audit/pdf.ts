import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import type { AuditMailpiece } from './types.js';

const W = 595.28, H = 841.89, M = 40;
const INK = rgb(0.1, 0.1, 0.12), MUTED = rgb(0.4, 0.4, 0.45), RULE = rgb(0.8, 0.8, 0.85), AMBER = rgb(0.7, 0.35, 0), RED = rgb(0.75, 0.15, 0.15);

/** dd/mm/yyyy hh:mm:ss GMT or BST: the time as it was on the wall in the UK. */
export function ukStamp(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', timeZoneName: 'short' }).formatToParts(new Date(iso));
  const p = (t: string): string => parts.find((x) => x.type === t)?.value ?? '';
  return `${p('day')}/${p('month')}/${p('year')} ${p('hour')}:${p('minute')}:${p('second')} ${p('timeZoneName')}`;
}

export type Thumb = { kind: 'image'; jpeg: Uint8Array } | { kind: 'missing' } | { kind: 'off' };

/** Cuts text to a width, adding "..." when it does not fit. */
function fit(s: string, font: PDFFont, size: number, width: number): string {
  if (font.widthOfTextAtSize(s, size) <= width) return s;
  let t = s;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > width) t = t.slice(0, -1);
  return `${t}...`;
}

/**
 * The mailpiece audit report: a summary page, then one page for each mailpiece with the first page of the letter (when the PDF is still kept),
 * the address, who submitted it, the packs inside it and the times recorded as it was produced and sent. It holds no prices or costs.
 */
export async function auditPdf(o: { scopeLabel: string; criteria: string; rows: AuditMailpiece[]; thumbs: Map<number, Thumb>; generated: Date; requested: number }): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Mailpiece audit report - ${o.scopeLabel}`);
  doc.setProducer('IntelliDoc');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage; let y = 0;
  const newPage = (): void => { page = doc.addPage([W, H]); y = H - M; };
  const text = (s: string, x: number, yy: number, size = 9, f: PDFFont = font, color = INK): void => { page.drawText(s, { x, y: yy, size, font: f, color }); };
  const wrap = (s: string, width: number, size: number, f: PDFFont): string[] => {
    const out: string[] = []; let line = '';
    for (const word of s.split(/\s+/).filter(Boolean)) { const t = line ? `${line} ${word}` : word; if (f.widthOfTextAtSize(t, size) > width && line) { out.push(line); line = word; } else line = t; }
    if (line) out.push(line); return out;
  };
  const para = (s: string, size = 9, f: PDFFont = font, color = INK, x = M, width = W - 2 * M): void => { for (const l of wrap(s, width, size, f)) { text(l, x, y, size, f, color); y -= size + 4; } };
  const rule = (): void => { page.drawLine({ start: { x: M, y: y + 6 }, end: { x: W - M, y: y + 6 }, thickness: 0.4, color: RULE }); };

  // Summary
  newPage();
  text('Mailpiece audit report', M, y - 18, 20, bold); y -= 44;
  text(o.scopeLabel, M, y, 12, bold); y -= 16;
  text(`produced ${ukStamp(o.generated.toISOString())}`, M, y, 8, font, MUTED); y -= 24;
  text('Selection', M, y, 11, bold); y -= 16;
  para(o.criteria || 'Mailpieces chosen by hand.', 9);
  y -= 6;
  const tracked = o.rows.filter((r) => r.service?.tracked).length;
  const despatched = o.rows.filter((r) => r.batch?.events.some((e) => e.type === 'Despatched')).length;
  const times = o.rows.map((r) => r.producedAt).sort();
  const stats: [string, string][] = [['Mailpieces in this report', String(o.rows.length)], ['Letters (packs)', String(o.rows.reduce((n, r) => n + r.packs.length, 0))],
    ['Recorded as despatched', String(despatched)], ['On a tracked service', String(tracked)], ['Cancelled', String(o.rows.filter((r) => r.isCancelled).length)],
    ['First produced', times.length ? ukStamp(times[0]!) : '-'], ['Last produced', times.length ? ukStamp(times[times.length - 1]!) : '-']];
  stats.forEach(([k, v]) => { text(k, M, y, 9, font, MUTED); text(v, M + 170, y, 9, bold); y -= 14; });
  if (o.rows.length < o.requested) { y -= 4; para(`${o.requested - o.rows.length} of the ${o.requested} selected mailpieces could not be included: they are not in ${o.scopeLabel} or below.`, 9, bold, AMBER); }
  y -= 10;
  text('About this report', M, y, 11, bold); y -= 16;
  para('Everything here is what IntelliDoc recorded about each mailpiece: when it was received, produced, printed, enclosed and despatched, the letters inside it and who submitted them. All times are UK time (GMT or BST). "Despatched" is the time production recorded the batch as handed to the carrier. For tracked or signed-for services, delivery evidence is held by the carrier, not by IntelliDoc. The page images are taken from the customer\'s PDF while it is still kept (90 days).', 8.5, font, MUTED);

  // One page for each mailpiece
  const need = (h: number): void => { if (y - h < M + 20) { newPage(); } };
  for (const [idx, r] of o.rows.entries()) {
    newPage();
    const who = r.addressLines[0] ?? 'Recipient';
    const idText = `id ${r.mailpieceId}`;
    text(`Mailpiece ${idx + 1} of ${o.rows.length}`, M, y, 8, font, MUTED);
    text(idText, W - M - font.widthOfTextAtSize(idText, 8), y, 8, font, MUTED); y -= 20;
    text(fit(who, bold, 15, W - 2 * M), M, y, 15, bold); y -= 16;
    const rest = [...r.addressLines.slice(1), ...(r.postcode && !r.addressLines.includes(r.postcode) ? [r.postcode] : [])].join(', ');
    para(rest, 9, font, MUTED);
    if (r.isCancelled) { text('CANCELLED', M, y, 9, bold, RED); y -= 14; }
    y -= 6;

    // the first page of the letter on the left
    const th = o.thumbs.get(r.mailpieceId) ?? { kind: 'off' as const };
    const boxW = 150, boxH = 212, top = y, first = r.packs[0];
    page!.drawRectangle({ x: M, y: top - boxH, width: boxW, height: boxH, borderColor: RULE, borderWidth: 0.6 });
    if (th.kind === 'image') {
      let img: PDFImage | null = null;
      try { img = await doc.embedJpg(th.jpeg); } catch { img = null; }
      if (img) { const k = Math.min((boxW - 4) / img.width, (boxH - 4) / img.height); page!.drawImage(img, { x: M + 2 + (boxW - 4 - img.width * k) / 2, y: top - 2 - img.height * k, width: img.width * k, height: img.height * k }); }
      else text('Image not available', M + 8, top - boxH / 2, 8, font, MUTED);
    } else if (th.kind === 'missing') { para('The customer\'s PDF is no longer kept, so the page cannot be shown.', 8, font, MUTED, M + 8, boxW - 16); y = top; }
    else text('Page image not requested', M + 8, top - boxH / 2, 8, font, MUTED);
    text(first ? `First page of the letter (PDF page ${first.startPage})` : 'First page of the letter', M, top - boxH - 11, 7, font, MUTED);

    // the facts on the right
    const x0 = M + 168, wv = W - M - x0 - 100;
    y = top;
    const fact = (k: string, v: string, color = INK): void => { text(k, x0, y, 8, font, MUTED); const lines = wrap(v, wv + 100 - 95, 9, font); for (const l of lines) { text(l, x0 + 95, y, 9, font, color); y -= 12; } if (!lines.length) y -= 12; };
    fact('Produced', ukStamp(r.producedAt));
    fact('Job', r.job.name);
    fact('Submitted by', `${r.submittedBy.path}${r.brand ? ` (${r.brand})` : ''}`);
    const owners = [...new Set(r.packs.map((k) => `${k.ownerUser} (${k.ownerAccount})`))];
    if (owners.length) fact('Submitted as', owners.join('; '));
    if (r.service) fact('Service', `${r.service.provider} ${r.service.name} (${r.service.format})${r.service.tracked ? ' - tracked' : ''}`);
    else fact('Service', 'Not recorded');
    fact('Contents', `${r.packs.length} ${r.packs.length === 1 ? 'letter' : 'letters'}, ${r.pageCount} pages, ${r.sheetCount} sheets${r.weightG != null ? `, ${r.weightG} g` : ''}${r.envelope ? `, envelope ${r.envelope}` : ''}`);
    if (r.batch) fact('Batch', `${r.batch.batchCode} (${r.batch.status}), ${r.batch.department}${r.batch.sequenceNumber != null ? `, no. ${r.batch.sequenceNumber} in the print order` : ''}`);
    else fact('Batch', 'Not in a batch yet', AMBER);
    y = Math.min(y, top - boxH - 24) - 6;

    // the timeline
    need(40); text('Timeline', M, y, 11, bold); y -= 14;
    const tl: { at: string; what: string; by: string }[] = [
      { at: r.job.receivedAt, what: 'Job received (XML)', by: r.job.xmlFile },
      ...(r.job.pdfReceivedAt ? [{ at: r.job.pdfReceivedAt, what: 'PDF received', by: r.job.pdfFile }] : []),
      { at: r.producedAt, what: 'Mailpiece produced', by: '' },
      ...(r.batch?.files.map((f) => ({ at: f.createdAt, what: 'Print file made', by: f.fileName })) ?? []),
      ...(r.batch?.events.map((e) => ({ at: e.at, what: `Batch ${e.type.toLowerCase()}`, by: [e.by ? `by ${e.by}` : '', e.note ?? ''].filter(Boolean).join(' - ') })) ?? []),
    ].sort((a, b) => a.at.localeCompare(b.at));
    for (const e of tl) { need(14); text(ukStamp(e.at), M, y, 9); text(e.what, M + 130, y, 9, bold); if (e.by) text(fit(e.by, font, 8, W - M - (M + 270)), M + 270, y, 8, font, MUTED); y -= 13; }
    y -= 8;

    // the packs
    need(40); text('Letters in the envelope', M, y, 11, bold); y -= 15;
    for (const k of r.packs) {
      need(52);
      rule();
      text(`Letter ${k.position}`, M, y - 6, 9, bold);
      text(`${k.sequence === null ? 'not in the sequence' : `sequence ${k.sequence}`}  |  ${k.pageCount} ${k.pageCount === 1 ? 'page' : 'pages'} from page ${k.startPage}  |  released ${ukStamp(k.releaseDate)}  |  received ${ukStamp(k.receivedAt)}`, M + 52, y - 6, 8, font, MUTED); y -= 18;
      text(`Pack ${k.packGuid}   Job ${k.jobGuid}`, M + 52, y, 7.5, font, INK); y -= 11;
      const refs = Object.entries(k.references).map(([key, v]) => `${key}: ${v}`).join('   ');
      if (refs) { for (const l of wrap(refs, W - 2 * M - 52, 8, font)) { need(12); text(l, M + 52, y, 8); y -= 11; } }
      y -= 4;
    }
  }

  doc.getPages().forEach((p, i, all) => p.drawText(`Page ${i + 1} of ${all.length}`, { x: W - M - 50, y: M - 14, size: 7, font, color: MUTED }));
  return doc.save();
}
