import type { FastifyInstance } from 'fastify';
import { NotFoundError } from '../errors.js';
import { userOf } from '../settings/routes.js';
import { FLAG_LABELS } from './describe.js';
import type { CustomerStore } from './types.js';
import { parseAccountUpdate, parseBrandName, parseDetails, parseEmailList, parseEnvelope, parseEnvelopesMode, parseMatchRules, parseNewAccount, parseSequenceRules } from './validate.js';

type Body = Record<string, unknown> | null;
type IdParams = { id: string };

function idOf(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new NotFoundError('Not found');
  return n;
}

export function customerRoutes(app: FastifyInstance, store: CustomerStore): void {
  app.get('/api/customers', async (req) => {
    const q = req.query as { search?: string; deleted?: string };
    return { rows: await store.list(q.search ?? '', q.deleted === '1') };
  });

  app.get('/api/customers/lookups', async () => ({ ...(await store.lookups()), flagLabels: FLAG_LABELS }));

  app.post('/api/customers', async (req, reply) => {
    const input = parseNewAccount(req.body as Body);
    const id = await store.create(input, userOf(req));
    return reply.code(201).send({ id });
  });

  app.get<{ Params: IdParams }>('/api/customers/:id', async (req) => store.get(idOf(req.params.id)));

  app.put<{ Params: IdParams }>('/api/customers/:id', async (req) => {
    const id = idOf(req.params.id);
    await store.updateDetails(id, parseDetails(req.body as Body), userOf(req));
    return store.get(id);
  });

  app.get<{ Params: IdParams }>('/api/customers/:id/history', async (req) => {
    const n = Number((req.query as { limit?: string }).limit ?? 50);
    return { rows: await store.history(idOf(req.params.id), Number.isInteger(n) && n > 0 ? Math.min(n, 500) : 50) };
  });

  // Sub-accounts
  app.post<{ Params: IdParams }>('/api/customers/:id/accounts', async (req, reply) => {
    const id = idOf(req.params.id);
    return reply.code(201).send({ id: await store.addAccount(id, parseNewAccount(req.body as Body), userOf(req)) });
  });
  app.put<{ Params: IdParams }>('/api/accounts/:id', async (req, reply) => {
    await store.updateAccount(idOf(req.params.id), parseAccountUpdate(req.body as Body), userOf(req));
    return reply.code(204).send();
  });

  // Between customer and sub-account: a customer takes everything from its parent, or a sub-account holds its own settings again
  app.post<{ Params: IdParams }>('/api/customers/:id/make-sub-account', async (req, reply) => {
    await store.makeSubAccount(idOf(req.params.id), userOf(req));
    return reply.code(204).send();
  });
  app.post<{ Params: IdParams }>('/api/accounts/:id/make-customer', async (req, reply) => {
    await store.makeCustomer(idOf(req.params.id), userOf(req));
    return reply.code(204).send();
  });

  // Brands
  app.post<{ Params: IdParams }>('/api/customers/:id/brands', async (req, reply) => {
    const id = idOf(req.params.id);
    return reply.code(201).send({ id: await store.addBrand(id, parseBrandName(req.body as Body), userOf(req)) });
  });
  app.put<{ Params: IdParams }>('/api/brands/:id', async (req, reply) => {
    await store.renameBrand(idOf(req.params.id), parseBrandName(req.body as Body), userOf(req));
    return reply.code(204).send();
  });
  app.delete<{ Params: IdParams }>('/api/brands/:id', async (req, reply) => {
    await store.deleteBrand(idOf(req.params.id), userOf(req));
    return reply.code(204).send();
  });

  // Envelopes
  app.post<{ Params: IdParams }>('/api/customers/:id/envelopes', async (req, reply) => {
    const id = idOf(req.params.id);
    return reply.code(201).send({ id: await store.addEnvelope(id, parseEnvelope(req.body as Body), userOf(req)) });
  });
  app.put<{ Params: IdParams }>('/api/envelopes/:id', async (req, reply) => {
    await store.updateEnvelope(idOf(req.params.id), parseEnvelope(req.body as Body), userOf(req));
    return reply.code(204).send();
  });
  app.delete<{ Params: IdParams }>('/api/envelopes/:id', async (req, reply) => {
    await store.deleteEnvelope(idOf(req.params.id), userOf(req));
    return reply.code(204).send();
  });

  app.put<{ Params: IdParams }>('/api/customers/:id/envelopes-mode', async (req, reply) => {
    await store.setEnvelopesMode(idOf(req.params.id), parseEnvelopesMode(req.body as Body), userOf(req));
    return reply.code(204).send();
  });

  // Matching, sequencing, notifications: each replaces the whole list
  app.put<{ Params: IdParams }>('/api/customers/:id/match-rules', async (req, reply) => {
    await store.setMatchRules(idOf(req.params.id), parseMatchRules(req.body as Body), userOf(req));
    return reply.code(204).send();
  });
  app.put<{ Params: IdParams }>('/api/customers/:id/sequence-rules', async (req, reply) => {
    await store.setSequenceRules(idOf(req.params.id), parseSequenceRules(req.body as Body), userOf(req));
    return reply.code(204).send();
  });
  app.put<{ Params: IdParams }>('/api/customers/:id/emails', async (req, reply) => {
    await store.setEmails(idOf(req.params.id), parseEmailList(req.body as Body), userOf(req));
    return reply.code(204).send();
  });
}
