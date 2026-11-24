import type { FastifyInstance } from 'fastify';
import { userOf } from '../settings/routes.js';
import { ValidationError } from '../errors.js';
import { auditPdf, type Thumb } from './pdf.js';
import type { AuditStore, PageRenderer } from './types.js';
import { parseAuditRequest } from './validate.js';

/** Runs `fn` over the items with at most `n` running at once. */
async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) await fn(items[next++]!); }));
}

/**
 * The mailpiece audit report (proof of postage). The mailpieces are chosen first, with the mailpiece search, and sent here by id; only those in the
 * account searched or below are included. It carries no prices or costs.
 */
export function auditRoutes(app: FastifyInstance, store: AuditStore, renderer: PageRenderer | undefined, now: () => Date = () => new Date()): void {
  app.post('/api/reports/audit.pdf', async (req, reply) => {
    const q = parseAuditRequest(req.body);
    const { scopeLabel, rows } = await store.details(q.accountId, q.mailpieceIds);
    if (!rows.length) throw new ValidationError({ mailpieceIds: 'None of those mailpieces are in the account searched or below.' });
    rows.sort((a, b) => a.producedAt.localeCompare(b.producedAt) || a.mailpieceId - b.mailpieceId);
    const thumbs = new Map<number, Thumb>();
    if (!q.thumbnails) rows.forEach((r) => thumbs.set(r.mailpieceId, { kind: 'off' }));
    else await pool(rows, 4, async (r) => {
      const first = r.packs[0];
      const jpeg = renderer && first ? await renderer.firstPage(r.job.pdfFile, first.startPage) : null;
      thumbs.set(r.mailpieceId, jpeg ? { kind: 'image', jpeg } : { kind: 'missing' });
    });
    const generated = now();
    const file = `mailpiece-audit-${generated.toISOString().slice(0, 10)}.pdf`;
    const pdf = await auditPdf({ scopeLabel, criteria: q.criteria, rows, thumbs, generated, requested: q.mailpieceIds.length });
    await store.logReport(userOf(req), q.accountId, `Mailpiece audit report: ${rows.length} mailpiece${rows.length === 1 ? '' : 's'} in ${scopeLabel}. ${q.criteria}`);
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `inline; filename="${file}"`).send(Buffer.from(pdf));
  });
}
