/**
 * Submits one document to H-POD the way the API documents it: POST /print/init (the print options, which return a job GUID), one POST /print/docpart for
 * each part of the file (a part may not be over 500 KB, so the file goes in 300 KB pieces, base-64 encoded), then POST /print/commit. Stops at the first
 * step that fails and says which. /print is limited to 10 calls a second, so the calls are paced.
 */
import { HpodError, type HpodApi, type HpodResult } from './client.js';

export interface GuidOption { name?: string; guid: string }
export interface PrintOptions {
  name: string; clientId: string;
  paper: GuidOption; envelope: GuidOption; ink: GuidOption; duplex: GuidOption; packMode: GuidOption; delivery: GuidOption;
  stationery?: GuidOption;
  /** Anything else PublicPrintOptions allows (delayUntil, inserts, passthrough, copyTo, splitSettings...), sent as it is. */
  extra?: Record<string, unknown>;
}
export interface Recipient { address?: string[]; addressType?: 'Postal' | 'Email' | 'SMS' | 'Kivra'; postcode?: string; countryCode?: string; forename?: string; surname?: string }
export interface CommitOptions { extractAddress?: boolean; abortOnValidationFailure?: boolean; exportReady?: boolean; recipients?: Recipient[] }

export interface SubmitInput { options: PrintOptions; file: { name: string; data: Buffer }; commit: CommitOptions }
export interface SubmitStep { step: 'init' | 'docpart' | 'commit'; label: string; ok: boolean; status: number; durationMs: number; message?: string }
export interface SubmitOutcome { ok: boolean; jobGuid: string | null; steps: SubmitStep[]; message: string; commit: unknown }

export const CHUNK_BYTES = 300_000;
const PRINT_PACE_MS = 120;

export interface SubmitDeps { sleep?: (ms: number) => Promise<void>; chunkBytes?: number; paceMs?: number }

const fileType = (name: string): string => (/\.([A-Za-z0-9]{1,10})$/.exec(name)?.[1] ?? 'pdf').toLowerCase();

function why(r: HpodResult): string {
  const b = r.body as { message?: unknown; title?: unknown; error?: unknown; detail?: unknown; errors?: unknown } | string | null;
  if (typeof b === 'string') return b.slice(0, 300);
  if (b && typeof b === 'object') {
    const t = [b.title, b.message, b.error, b.detail].find((x) => typeof x === 'string');
    if (typeof t === 'string') return t.slice(0, 300);
    if (b.errors) return JSON.stringify(b.errors).slice(0, 300);
  }
  return r.statusText;
}

export async function submitDocument(api: HpodApi, input: SubmitInput, deps: SubmitDeps = {}): Promise<SubmitOutcome> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const chunk = deps.chunkBytes ?? CHUNK_BYTES, pace = deps.paceMs ?? PRINT_PACE_MS;
  const steps: SubmitStep[] = [];
  let jobGuid: string | null = null, commitBody: unknown = null;
  const fail = (message: string): SubmitOutcome => ({ ok: false, jobGuid, steps, message, commit: commitBody });
  if (input.file.data.length === 0) return fail('The file is empty.');

  /** One call; records the step; null when it failed (the step says why). */
  const call = async (step: SubmitStep['step'], label: string, path: string, json: unknown): Promise<HpodResult | null> => {
    try {
      const r = await api.send({ method: 'POST', path, auth: 'bearer', json });
      steps.push({ step, label, ok: r.ok, status: r.status, durationMs: r.durationMs, message: r.ok ? undefined : r.status === 429 ? 'Throttled by H-POD (HTTP 429): wait a moment and try again.' : why(r) });
      return r.ok ? r : null;
    } catch (e) {
      if (!(e instanceof HpodError)) throw e;
      steps.push({ step, label, ok: false, status: 0, durationMs: 0, message: e.message });
      return null;
    }
  };

  const { extra, ...options } = input.options;
  const init = await call('init', 'Start the submission', '/print/init', { ...extra, ...options });
  if (!init) return fail(`Could not start the submission: ${steps[steps.length - 1]!.message}`);
  jobGuid = (init.body as { jobGuid?: string } | null)?.jobGuid ?? null;
  if (!jobGuid) return fail('H-POD accepted the start of the submission but sent no job GUID back.');

  const parts = Math.ceil(input.file.data.length / chunk);
  for (let i = 0; i < parts; i++) {
    await sleep(pace);
    const start = i * chunk;
    const part = input.file.data.subarray(start, start + chunk);
    const r = await call('docpart', `Send part ${i + 1} of ${parts}`, '/print/docpart', {
      jobGUID: jobGuid, fileIndex: 0, partIndex: i, fileType: fileType(input.file.name), filename: input.file.name.slice(0, 255), data: part.toString('base64'), startByteIndex: start,
    });
    if (!r) return fail(`Part ${i + 1} of ${parts} was not accepted: ${steps[steps.length - 1]!.message}`);
  }

  await sleep(pace);
  const { extractAddress, abortOnValidationFailure, exportReady, recipients } = input.commit;
  const commit = await call('commit', 'Commit the submission', '/print/commit', { jobGUID: jobGuid, extractAddress, abortOnValidationFailure, exportReady, recipients });
  if (!commit) return fail(`The submission was not committed: ${steps[steps.length - 1]!.message}`);
  commitBody = commit.body;
  const verdict = (commit.body as { addressValidationResult?: string } | null)?.addressValidationResult;
  return { ok: true, jobGuid, steps, commit: commitBody, message: `Submitted as job ${jobGuid}${verdict ? ` (address check: ${verdict})` : ''}.` };
}
