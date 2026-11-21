import type { FastifyInstance } from 'fastify';
import { NotFoundError } from '../errors.js';
import { userOf } from '../settings/routes.js';
import type { CostingStore } from './types.js';
import { parseMode, parseModel, parseNewModel } from './validate.js';

type Body = Record<string, unknown> | null;
type IdParams = { id: string };
function idOf(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new NotFoundError('Not found');
  return n;
}

export function costingRoutes(app: FastifyInstance, store: CostingStore): void {
  app.get('/api/costing/lookups', async () => store.lookups());
  app.get<{ Params: IdParams }>('/api/customers/:id/costing', async (req) => store.overview(idOf(req.params.id)));
  app.put<{ Params: IdParams }>('/api/customers/:id/costing-mode', async (req) => {
    const id = idOf(req.params.id);
    await store.setMode(id, parseMode(req.body as Body), userOf(req));
    return store.overview(id);
  });
  app.post<{ Params: IdParams }>('/api/customers/:id/costing-models', async (req, reply) =>
    reply.code(201).send({ id: await store.create(idOf(req.params.id), parseNewModel(req.body as Body), userOf(req)) }));
  app.get<{ Params: IdParams }>('/api/costing-models/:id', async (req) => store.model(idOf(req.params.id)));
  app.put<{ Params: IdParams }>('/api/costing-models/:id', async (req) => {
    const id = idOf(req.params.id);
    await store.update(id, parseModel(req.body as Body), userOf(req));
    return store.model(id);
  });
  app.delete<{ Params: IdParams }>('/api/costing-models/:id', async (req, reply) => {
    await store.remove(idOf(req.params.id), userOf(req));
    return reply.code(204).send();
  });
}
