import type { FastifyInstance } from 'fastify';
import type { ActivityDeps, ActivityResponse } from './types.js';

/** What the Activity screen shows: the inbox, what is running now, what finished lately and the newest jobs. Cheap enough to ask every few seconds. */
export function activityRoutes(app: FastifyInstance, { store, inbox, jobs }: ActivityDeps): void {
  app.get('/api/activity', async (): Promise<ActivityResponse> => {
    const [files, running, recent, jobRows] = await Promise.all([inbox.list(), store.running(), store.recent(30), jobs.list({ search: null, status: null, limit: 40 })]);
    return { inbox: files, inboxUnavailable: inbox.unavailable(), running, recent, jobs: jobRows };
  });
}
