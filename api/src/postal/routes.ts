import type { FastifyInstance } from 'fastify';
import { NotFoundError } from '../errors.js';
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

export function postalRoutes(app: FastifyInstance, store: PostalStore): void {
  app.get('/api/postal', async () => store.overview());
  app.get('/api/postal/history', async (req) => {
    const n = Number((req.query as { limit?: string }).limit ?? 50);
    return { rows: await store.history(Number.isInteger(n) && n > 0 ? Math.min(n, 500) : 50) };
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
