import type { FastifyInstance } from 'fastify';
import { NotFoundError } from '../errors.js';
import { userOf } from '../settings/routes.js';
import type { RepriceStore } from './types.js';
import { parseReprice } from './validate.js';

type Body = Record<string, unknown> | null;
function idOf(raw: string): number { const n = Number(raw); if (!Number.isInteger(n) || n < 1) throw new NotFoundError('Not found'); return n; }

export function repriceRoutes(app: FastifyInstance, store: RepriceStore): void {
  app.post<{ Params: { id: string } }>('/api/customers/:id/reprice/preview', async (req) => store.preview(idOf(req.params.id), parseReprice(req.body as Body)));
  app.post<{ Params: { id: string } }>('/api/customers/:id/reprice', async (req) => store.run(idOf(req.params.id), parseReprice(req.body as Body), userOf(req)));
}
