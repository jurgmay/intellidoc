import type { FastifyInstance } from 'fastify';
import type { RecipientStore } from './types.js';
import { parseRecipientQuery } from './validate.js';

export function recipientRoutes(app: FastifyInstance, store: RecipientStore): void {
  app.get('/api/recipients/scopes', async () => ({ rows: await store.scopes() }));
  app.get('/api/recipients/search', async (req) => store.search(parseRecipientQuery(req.query as Record<string, unknown>)));
}
