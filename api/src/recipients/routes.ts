import type { FastifyInstance } from 'fastify';
import { NotFoundError } from '../errors.js';
import type { RecipientStore } from './types.js';
import { parseRecipientQuery } from './validate.js';

export function recipientRoutes(app: FastifyInstance, store: RecipientStore): void {
  app.get('/api/recipients/scopes', async () => ({ rows: await store.scopes() }));
  app.get('/api/recipients/search', async (req) => store.search(parseRecipientQuery(req.query as Record<string, unknown>)));
  app.get<{ Params: { id: string } }>('/api/mailpieces/:id/price', async (req) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw new NotFoundError('Not found');
    return store.price(id);
  });
}
