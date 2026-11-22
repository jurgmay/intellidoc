import type { ActivityRow, InboxItem } from './types.js';

/** One finished piece of watcher work: how big its file was, whether a PDF was read, and how long it took. */
export interface Sample { withPdf: boolean; bytes: number; seconds: number }
export const MIN_SAMPLES = 3;

export interface Estimator {
  /** Number of finished jobs the estimate is based on. */
  basedOn: number;
  /** Seconds to process a pair (or a PDF arriving), by size; null until there are enough samples. */
  secondsPerByte: number | null;
  /** Seconds for an XML on its own (no PDF); null until there are enough samples. */
  xmlOnlySeconds: number | null;
}

export function estimator(samples: Sample[]): Estimator {
  const heavy = samples.filter((s) => s.withPdf && s.bytes > 0), light = samples.filter((s) => !s.withPdf);
  const bytes = heavy.reduce((t, s) => t + s.bytes, 0);
  return {
    basedOn: samples.length,
    secondsPerByte: heavy.length >= MIN_SAMPLES && bytes > 0 ? heavy.reduce((t, s) => t + s.seconds, 0) / bytes : null,
    xmlOnlySeconds: light.length >= MIN_SAMPLES ? light.reduce((t, s) => t + s.seconds, 0) / light.length : null,
  };
}

/** Seconds a waiting inbox file will take, or null when there is nothing to base it on. */
export function itemSeconds(e: Estimator, f: InboxItem): number | null {
  if (f.pdfName) return e.secondsPerByte === null || f.pdfBytes === null ? null : Math.round(e.secondsPerByte * f.pdfBytes);
  return e.xmlOnlySeconds === null ? null : Math.round(e.xmlOnlySeconds);
}

/** Seconds left for work that is running now: from its progress when it has some, else from its size, never negative. */
export function remainingSeconds(e: Estimator, r: ActivityRow, now: number): number | null {
  if (r.kind === 'Print files' || r.stalled) return null;
  const elapsed = Math.max(0, (now - Date.parse(r.startedAt)) / 1000);
  if (r.total && r.done && r.done > 0 && r.total >= r.done) return Math.round((elapsed * (r.total - r.done)) / r.done);
  const whole = r.bytes && r.withPdf && e.secondsPerByte !== null ? e.secondsPerByte * r.bytes : !r.withPdf ? e.xmlOnlySeconds : null;
  return whole === null ? null : Math.max(0, Math.round(whole - elapsed));
}

export interface QueueEstimate {
  basedOn: number;
  /** Seconds until the inbox is clear, or null when nothing can be said. */
  seconds: number | null;
  /** Some waiting files could not be estimated (not enough history), so the total is a minimum. */
  partial: boolean;
}

export function queueEstimate(e: Estimator, files: (number | null)[], running: (number | null)[]): QueueEstimate {
  const all = [...files, ...running];
  const known = all.filter((x): x is number => x !== null);
  return { basedOn: e.basedOn, seconds: known.length === 0 && all.length > 0 ? null : known.reduce((t, x) => t + x, 0), partial: known.length < all.length };
}
