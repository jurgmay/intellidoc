import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { customerRoutes } from './customers/routes.js';
import type { CustomerStore } from './customers/types.js';
import { ConflictError, NotFoundError, ValidationError } from './errors.js';
import { settingsRoutes } from './settings/routes.js';
import type { SettingsStore } from './settings/store.js';

export interface AppDeps { settings: SettingsStore; customers: CustomerStore; /** Folder with the built web app, served at / when it exists. */ webDir?: string }

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.get('/api/health', async () => ({ ok: true }));
  settingsRoutes(app, deps.settings);
  customerRoutes(app, deps.customers);
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ValidationError) return reply.code(422).send({ errors: err.fieldErrors });
    if (err instanceof ConflictError) return reply.code(409).send({ error: err.message });
    if (err instanceof NotFoundError) return reply.code(404).send({ error: err.message });
    const e = err as Error & { statusCode?: number };
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.message });
    console.error(err);
    return reply.code(500).send({ error: 'Something went wrong on the server. See the API log.' });
  });
  if (deps.webDir && existsSync(deps.webDir)) {
    await app.register(fastifyStatic, { root: deps.webDir });
    app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api/') ? reply.code(404).send({ error: 'Not found' }) : reply.sendFile('index.html')));
  }
  return app;
}
