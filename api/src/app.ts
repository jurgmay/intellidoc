import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { costingRoutes } from './costing/routes.js';
import { repriceRoutes } from './reprice/routes.js';
import type { RepriceStore } from './reprice/types.js';
import { postalRoutes } from './postal/routes.js';
import { referenceRoutes } from './reference/routes.js';
import type { ReferenceStore } from './reference/types.js';
import type { PostalStore } from './postal/types.js';
import type { CostingStore } from './costing/types.js';
import { customerRoutes } from './customers/routes.js';
import type { CustomerStore } from './customers/types.js';
import { ConflictError, NotFoundError, ValidationError } from './errors.js';
import { recipientRoutes } from './recipients/routes.js';
import type { RecipientStore } from './recipients/types.js';
import { jobRoutes } from './jobs/routes.js';
import type { JobDeps } from './jobs/types.js';
import { activityRoutes } from './activity/routes.js';
import type { ActivityDeps } from './activity/types.js';
import { reportRoutes } from './reports/routes.js';
import type { ReportStore } from './reports/types.js';
import { settingsRoutes } from './settings/routes.js';
import type { SettingsStore } from './settings/store.js';
import { drawMarksPreview, type MarksPreviewer } from './settings/preview.js';

export interface AppDeps { activity?: Omit<ActivityDeps, 'jobs' | 'settings'>; settings: SettingsStore; customers: CustomerStore; costing: CostingStore; postal: PostalStore; reference: ReferenceStore; reprice: RepriceStore; recipients: RecipientStore; reports: ReportStore; /** Jobs and making their print files. Optional so a server without print folders can still start. */ jobs?: JobDeps; /** Draws the marks preview (needs Ghostscript); tests pass a fake. */ marksPreview?: MarksPreviewer; /** Folder with the built web app, served at / when it exists. */ webDir?: string }

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.get('/api/health', async () => ({ ok: true }));
  settingsRoutes(app, deps.settings, deps.marksPreview ?? drawMarksPreview);
  customerRoutes(app, deps.customers);
  costingRoutes(app, deps.costing);
  postalRoutes(app, deps.postal);
  referenceRoutes(app, deps.reference);
  repriceRoutes(app, deps.reprice);
  recipientRoutes(app, deps.recipients);
  reportRoutes(app, deps.reports);
  if (deps.jobs) jobRoutes(app, deps.jobs);
  if (deps.activity && deps.jobs) activityRoutes(app, { ...deps.activity, settings: deps.settings, jobs: deps.jobs.store });
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
