import type { FastifyInstance } from 'fastify';
import { ConflictError, NotFoundError } from '../errors.js';
import type { JobDeps } from './types.js';
import { parseCompose, parseJobQuery } from './validate.js';

function idOf(raw: string): number { const n = Number(raw); if (!Number.isInteger(n) || n < 1) throw new NotFoundError('Job not found'); return n; }

export function jobRoutes(app: FastifyInstance, { store, composer }: JobDeps): void {
  const running = new Set<number>(); // a job is composed by one request at a time
  app.get('/api/jobs', async (req) => ({ rows: await store.list(parseJobQuery(req.query as Record<string, string | undefined>)), canCompose: composer.unavailable() === null, composeUnavailable: composer.unavailable() }));
  app.get<{ Params: { id: string } }>('/api/jobs/:id', async (req) => store.get(idOf(req.params.id)));
  app.post<{ Params: { id: string } }>('/api/jobs/:id/compose', async (req) => {
    const id = idOf(req.params.id);
    const { onlyNew } = parseCompose(req.body);
    const why = composer.unavailable();
    if (why) throw new ConflictError(why);
    const job = await store.get(id);
    if (job.status !== 'Received') throw new ConflictError(`Job ${id} is "${job.status}". Only a Received job (its PDF checked) can have print files made.`);
    if (running.has(id)) throw new ConflictError(`Print files for job ${id} are already being made. Wait for that to finish.`);
    running.add(id);
    try {
      return { batches: await composer.compose(id, onlyNew).catch((e: Error) => { throw new ConflictError(`Could not make the print files for job ${id}: ${e.message}`); }) };
    } finally { running.delete(id); }
  });
}
