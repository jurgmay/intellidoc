import type { FastifyInstance } from 'fastify';
import { estimator, itemSeconds, queueEstimate, remainingSeconds } from './estimate.js';
import type { ActivityDeps, ActivityResponse } from './types.js';

const RECENT_POOL = 500; // most finished rows looked at to find the times of the listed jobs

/** What the Activity screen shows: the inbox, what is running now, what finished lately, the newest jobs and how long the queue should take. Cheap enough to ask every few seconds. */
export function activityRoutes(app: FastifyInstance, { store, inbox, jobs, settings }: ActivityDeps): void {
  app.get('/api/activity', async (): Promise<ActivityResponse> => {
    const setting = await settings.read();
    const shown = typeof setting.activityRowsShown === 'number' && setting.activityRowsShown >= 1 ? Math.min(500, Math.floor(setting.activityRowsShown)) : 30;
    const [files, running, pool, jobRows, samples] = await Promise.all([inbox.list(), store.running(), store.recent(RECENT_POOL), jobs.list({ search: null, status: null, limit: 40 }), store.samples(40)]);
    // A finished job's start and duration come from the import and PDF check rows that made it, so keep those for every job listed
    // even when they are older than the rows shown (a batch of imports pushes them past the limit).
    const stem = (name: string): string => name.replace(/\.[^.]+$/, '').toLowerCase();
    const jobIds = new Set(jobRows.map((j) => j.id)), jobStems = new Set(jobRows.map((j) => j.baseName.toLowerCase()));
    const recent = [...pool.slice(0, shown), ...pool.slice(shown).filter((r) => r.state === 'Done' && (r.jobId !== null ? jobIds.has(r.jobId) : jobStems.has(stem(r.label))))];
    const e = estimator(samples);
    const now = Date.now();
    const filesWithEstimate = files.map((f) => ({ ...f, estimateSeconds: itemSeconds(e, f) }));
    const runningWithEstimate = running.map((r) => ({ ...r, remainingSeconds: remainingSeconds(e, r, now) }));
    // Print files are made in parallel with the imports (and by another program), so only imports and PDF checks are in the queue.
    const queue = queueEstimate(e, filesWithEstimate.map((f) => f.estimateSeconds), runningWithEstimate.filter((r) => r.kind !== 'Print files').map((r) => r.remainingSeconds ?? null));
    return { inbox: filesWithEstimate, inboxUnavailable: inbox.unavailable(), running: runningWithEstimate, recent, jobs: jobRows, queue, autoCompose: setting.autoCompose === true };
  });
}
