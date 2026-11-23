import { api } from './client';

export interface HpodStatus {
  configured: boolean; missing: string[]; endpoint: string; instance: string; accountLogin: string; username: string;
  signedIn: boolean; expiresAt: string | null; claims: Record<string, unknown> | null;
}
export interface HpodParam { name: string; label: string; required?: boolean; example?: string; fromSettings?: 'instance' }
export interface HpodOperation {
  id: string; group: string; method: string; path: string; summary: string; description: string; auth: 'bearer' | 'none' | 'settings';
  pathParams?: HpodParam[]; query?: HpodParam[]; body?: { kind: 'json' | 'form'; sample: Record<string, unknown> };
  live?: string; deprecated?: boolean; filePicker?: boolean; throttle?: string;
}
export interface HpodRequestEcho { method: string; url: string; headers: Record<string, string>; body?: unknown }
export interface HpodResult {
  status: number; statusText: string; ok: boolean; durationMs: number; headers: Record<string, string>; bodyKind: 'json' | 'text' | 'empty'; body: unknown;
  request: HpodRequestEcho; idempotencyKey?: string;
}
export interface HpodCall { result: HpodResult; status: HpodStatus }
export interface CallInput {
  operation: string; path?: Record<string, string>; query?: Record<string, string>; body?: unknown; idempotencyKey?: string; bearerOverride?: string; confirm?: boolean;
}
export interface SubmitStep { step: 'init' | 'docpart' | 'commit'; label: string; ok: boolean; status: number; durationMs: number; message?: string }
export interface SubmitOutcome { ok: boolean; jobGuid: string | null; steps: SubmitStep[]; message: string; commit: unknown }
export interface SubmitInput {
  options: Record<string, unknown>; fileName: string; data: string; commit: { extractAddress?: boolean; abortOnValidationFailure?: boolean; exportReady?: boolean; recipients?: unknown[] }; confirm?: boolean;
}

export const getOperations = (): Promise<{ groups: string[]; operations: HpodOperation[] }> => api('/api/hpod/operations');
export const getSession = (): Promise<HpodStatus> => api('/api/hpod/session');
export const signIn = (): Promise<HpodCall> => api('/api/hpod/session', { method: 'POST' });
export const signOut = (): Promise<HpodStatus> => api('/api/hpod/session', { method: 'DELETE' });
export const callOperation = (input: CallInput): Promise<HpodCall> => api('/api/hpod/call', { method: 'POST', body: input });
export const submitDocument = (input: SubmitInput): Promise<SubmitOutcome> => api('/api/hpod/submit', { method: 'POST', body: input });

/** A file's bytes, base-64 encoded (in pieces, as a big file would overflow the argument limit of String.fromCharCode). */
export async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
