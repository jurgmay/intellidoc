import type { FastifyInstance } from 'fastify';
import type { BatchStore } from './types.js';
import { parseBatchQuery } from './validate.js';

/** The mailpieces of a batch come from the mailpiece search (`/api/recipients/search?accountId=...&batchId=...`), so both pages show them the same way. */
export function batchRoutes(app: FastifyInstance, store: BatchStore): void {
  app.get('/api/batches/search', async (req) => store.search(parseBatchQuery(req.query as Record<string, unknown>)));
}
