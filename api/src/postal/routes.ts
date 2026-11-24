import type { FastifyInstance } from 'fastify';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { planEnd } from './endPrices.js';
import { readRatesFile } from './importFile.js';
import { planImport } from './importPlan.js';
import { userOf } from '../settings/routes.js';
import type { PostalStore } from './types.js';
import { parseName, parsePriceChange, parseRate, parseService } from './validate.js';

type Body = Record<string, unknown> | null;
type IdParams = { id: string };
function idOf(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new NotFoundError('Not found');
  return n;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function postalRoutes(app: FastifyInstance, store: PostalStore): void {
  // The price list file arrives as the raw request body (.xlsx or .csv).
  for (const type of ['application/octet-stream', 'text/csv']) app.addContentTypeParser(type, { parseAs: 'buffer', bodyLimit: 8 * 1024 * 1024 }, (_req, body, done) => done(null, body));

  /** Checks a price list file and, with apply=1, imports it. The check is always redone from the file, so what is applied is what the database holds now. */
  app.post<{ Querystring: { start?: string; end?: string; apply?: string; name?: string } }>('/api/postal/import', { bodyLimit: 8 * 1024 * 1024 }, async (req, reply) => {
    const { start = '', end = '', apply = '0', name = 'prices' } = req.query;
    if (!Buffer.isBuffer(req.body)) throw new ValidationError({ file: 'Send the .xlsx or .csv file as the request body.' });
    if (start && !DATE.test(start)) throw new ValidationError({ start: 'The start date must be a date.' });
    if (end && !DATE.test(end)) throw new ValidationError({ end: 'The end date must be a date.' });
    const file = await readRatesFile(req.body, name);
    const overview = await store.overview();
    const plan = planImport(file, overview, { startDate: start, endDate: end || null, today: overview.today });
    if (apply !== '1') return { plan, result: null };
    if (!plan.canImport) throw new ConflictError('The file cannot be imported yet. Fix the problems listed and check it again.');
    return reply.send({ plan, result: await store.applyImport(plan, userOf(req), name) });
  });

  app.get('/api/postal', async () => store.overview());
  app.get('/api/postal/history', async (req) => {
    const n = Number((req.query as { limit?: string }).limit ?? 50);
    return { rows: await store.history(Number.isInteger(n) && n > 0 ? Math.min(n, 500) : 50) };
  });

  /** Sets the last day of every price that runs past it. Without apply, only says what would end. */
  app.post('/api/postal/end-prices', async (req) => {
    const b = (req.body ?? {}) as { lastDay?: unknown; apply?: unknown };
    const plan = planEnd(await store.overview(), typeof b.lastDay === 'string' ? b.lastDay : '');
    if (b.apply !== true) return { plan, ended: null };
    return { plan, ended: await store.endPrices(plan, userOf(req)) };
  });

  app.post('/api/postal/providers', async (req, reply) => reply.code(201).send({ id: await store.createProvider(parseName(req.body as Body), userOf(req)) }));
  app.put<{ Params: IdParams }>('/api/postal/providers/:id', async (req, reply) => { await store.updateProvider(idOf(req.params.id), parseName(req.body as Body), userOf(req)); return reply.code(204).send(); });
  app.delete<{ Params: IdParams }>('/api/postal/providers/:id', async (req, reply) => { await store.deleteProvider(idOf(req.params.id), userOf(req)); return reply.code(204).send(); });

  app.post<{ Params: IdParams }>('/api/postal/providers/:id/services', async (req, reply) =>
    reply.code(201).send({ id: await store.createService(idOf(req.params.id), parseService(req.body as Body), userOf(req)) }));
  app.put<{ Params: IdParams }>('/api/postal/services/:id', async (req, reply) => { await store.updateService(idOf(req.params.id), parseService(req.body as Body), userOf(req)); return reply.code(204).send(); });
  app.delete<{ Params: IdParams }>('/api/postal/services/:id', async (req, reply) => { await store.deleteService(idOf(req.params.id), userOf(req)); return reply.code(204).send(); });

  app.post<{ Params: IdParams }>('/api/postal/services/:id/rates', async (req, reply) =>
    reply.code(201).send({ id: await store.createRate(idOf(req.params.id), parseRate(req.body as Body), userOf(req)) }));
  app.post<{ Params: IdParams }>('/api/postal/services/:id/price-change', async (req) =>
    ({ changed: await store.priceChange(idOf(req.params.id), parsePriceChange(req.body as Body), userOf(req)) }));
  app.put<{ Params: IdParams }>('/api/postal/rates/:id', async (req, reply) => { await store.updateRate(idOf(req.params.id), parseRate(req.body as Body), userOf(req)); return reply.code(204).send(); });
  app.delete<{ Params: IdParams }>('/api/postal/rates/:id', async (req, reply) => { await store.deleteRate(idOf(req.params.id), userOf(req)); return reply.code(204).send(); });
}
