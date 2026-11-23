import type { FastifyInstance } from 'fastify';
import { estimator, itemSeconds, queueEstimate, remainingSeconds } from './estimate.js';
import type { ActivityDeps, ActivityResponse } from './types.js';

/** What the Activity screen shows: the inbox, what is running now, what finished lately, the newest jobs and how long the queue should take. Cheap enough to ask every few seconds. */
export function activityRoutes(app: FastifyInstance, { store, inbox, jobs, settings }: ActivityDeps): void {
  app.get('/api/activity', async (): Promise<ActivityResponse> => {
    const [files, running, recent, jobRows, samples, setting] = await Promise.all([inbox.list(), store.running(), store.recent(30), jobs.list({ search: null, status: null, limit: 40 }), store.samples(40), settings.read()]);
    const e = estimator(samples);
    const now = Date.now();
    const filesWithEstimate = files.map((f) => ({ ...f, estimateSeconds: itemSeconds(e, f) }));
    const runningWithEstimate = running.map((r) => ({ ...r, remainingSeconds: remainingSeconds(e, r, now) }));
    // Print files are made in parallel with the imports (and by another program), so only imports and PDF checks are in the queue.
    const queue = queueEstimate(e, filesWithEstimate.map((f) => f.estimateSeconds), runningWithEstimate.filter((r) => r.kind !== 'Print files').map((r) => r.remainingSeconds ?? null));
    return { inbox: filesWithEstimate, inboxUnavailable: inbox.unavailable(), running: runningWithEstimate, recent, jobs: jobRows, queue, autoCompose: setting.autoCompose === true };
  });
}
