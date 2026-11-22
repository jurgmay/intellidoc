import type { FastifyInstance } from 'fastify';
import { NotFoundError } from '../errors.js';
import { userOf } from '../settings/routes.js';
import type { ReferenceStore } from './types.js';
import { parseAnonymous, parseFormat, parsePaper } from './validate.js';

type Body = Record<string, unknown> | null;
type IdParams = { id: string };
function idOf(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new NotFoundError('Not found');
  return n;
}

export function referenceRoutes(app: FastifyInstance, store: ReferenceStore): void {
  app.get('/api/reference/papers', async () => ({ papers: await store.papers() }));
  app.put<{ Params: IdParams }>('/api/reference/papers/:id', async (req, reply) => { await store.updatePaper(idOf(req.params.id), parsePaper(req.body as Body), userOf(req)); return reply.code(204).send(); });
  app.delete<{ Params: IdParams }>('/api/reference/papers/:id', async (req, reply) => { await store.deletePaper(idOf(req.params.id), userOf(req)); return reply.code(204).send(); });

  app.get('/api/reference/postal-formats', async () => ({ formats: await store.formats() }));
  app.put<{ Params: IdParams }>('/api/reference/postal-formats/:id', async (req, reply) => { await store.updateFormat(idOf(req.params.id), parseFormat(req.body as Body), userOf(req)); return reply.code(204).send(); });

  app.get('/api/reference/anonymous', async () => ({ names: await store.anonymous() }));
  app.post('/api/reference/anonymous', async (req, reply) => reply.code(201).send({ text: await store.addAnonymous(parseAnonymous(req.body as Body), userOf(req)) }));
  app.delete<{ Params: { text: string } }>('/api/reference/anonymous/:text', async (req, reply) => { await store.deleteAnonymous(req.params.text, userOf(req)); return reply.code(204).send(); });

  app.get('/api/reference/history', async (req) => {
    const n = Number((req.query as { limit?: string }).limit ?? 50);
    return { rows: await store.history(Number.isInteger(n) && n > 0 ? Math.min(n, 500) : 50) };
  });
}
