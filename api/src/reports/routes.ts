import type { FastifyInstance } from 'fastify';
import { NotFoundError } from '../errors.js';
import { buildMarginReport, buildUsageReport } from './aggregate.js';
import { usagePdf } from './pdf.js';
import type { ReportStore } from './types.js';
import { parseUsageQuery } from './validate.js';

export function reportRoutes(app: FastifyInstance, store: ReportStore, now: () => Date = () => new Date()): void {
  const build = async (raw: unknown) => {
    const q = parseUsageQuery(raw as Record<string, unknown>);
    const found = await store.usageLines(q);
    if (!found) throw new NotFoundError('That invoicing account does not exist.');
    return buildUsageReport(found.account, q.from, q.to, found.lines);
  };
  app.get('/api/reports/invoicing-accounts', async () => ({ rows: await store.invoicingAccounts() }));
  app.get('/api/reports/usage', async (req) => build(req.query));
  // Internal: what it cost and the margin. A separate route (and no PDF) so costs never travel with the customer's usage report.
  app.get('/api/reports/margin', async (req) => {
    const q = parseUsageQuery(req.query as Record<string, unknown>);
    const found = await store.marginLines(q);
    if (!found) throw new NotFoundError('That invoicing account does not exist.');
    return buildMarginReport(found.account, q.from, q.to, found.lines);
  });
  app.get('/api/reports/usage.pdf', async (req, reply) => {
    const r = await build(req.query);
    const file = `usage-${r.account.code}-${r.from}-to-${r.to}.pdf`.replace(/[^A-Za-z0-9._-]/g, '_');
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `inline; filename="${file}"`).send(Buffer.from(await usagePdf(r, now())));
  });
}
