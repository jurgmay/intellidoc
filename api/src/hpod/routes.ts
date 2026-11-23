import type { FastifyInstance } from 'fastify';
import { HpodError } from '../../../ingest/src/hpod/client.js';
import { GROUPS, OPERATIONS } from './operations.js';
import type { CallInput, HpodService, SubmitRequest } from './service.js';

const BIG = { bodyLimit: 60 * 1024 * 1024 };

/** The H-POD module: /api/hpod/*. The sign-in details come from Settings; the token stays on the server. */
export function hpodRoutes(app: FastifyInstance, hpod: HpodService): void {
  app.get('/api/hpod/operations', async () => ({ groups: GROUPS, operations: OPERATIONS }));
  app.get('/api/hpod/session', async () => hpod.status());
  app.post('/api/hpod/session', async () => { const { result, status } = await hpod.signIn(); return { status, result }; });
  app.delete('/api/hpod/session', async () => hpod.status().then(() => hpod.signOut()));
  app.post('/api/hpod/call', BIG, async (req, reply) => {
    const body = req.body as CallInput | null;
    if (!body || typeof body.operation !== 'string') return reply.code(400).send({ error: 'Expected { "operation": "...", ... }' });
    return hpod.call(body);
  });
  app.post('/api/hpod/submit', BIG, async (req, reply) => {
    const b = req.body as SubmitRequest | null;
    if (!b || typeof b.data !== 'string' || typeof b.fileName !== 'string' || typeof b.options !== 'object' || b.options === null) return reply.code(400).send({ error: 'Expected { "options": {...}, "fileName": "...", "data": "<base-64>", "commit": {...} }' });
    return hpod.submit({ ...b, commit: b.commit ?? {} });
  });
}

/** 422 for what is missing from the settings, 502 for H-POD (or the network to it) not giving an answer, 429 when throttled. */
export function hpodErrorStatus(e: HpodError): number { return e.kind === 'config' ? 422 : e.kind === 'throttled' ? 429 : 502; }
