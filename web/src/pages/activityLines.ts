import type { ActivityData } from '../api/activity';

export type Stage = 'Making print files' | 'Processing' | 'Waiting' | 'Awaiting PDF' | 'Failed' | 'Completed';
export type PdfState = 'arrived' | 'waiting' | 'none';
export interface ActivityLine {
  key: string; stage: Stage; name: string; bytes: number | null; pdf: PdfState; detail: string | null; progress: { done: number; total: number; unit: 'mailpieces' | 'pages' } | null;
  /** About how long it should take (waiting) or how long is left (running), in seconds. */
  seconds: number | null;
  /** When the work started and, once it has, ended (ISO); null when it has not started or the time is not known. */
  start: string | null; end: string | null;
  /** When a file arrived or a job started waiting (ISO), for how long it has been waiting; null when it is not waiting. */
  waitingSince: string | null;
  stalled: boolean;
}

export const ORDER: Stage[] = ['Making print files', 'Processing', 'Waiting', 'Awaiting PDF', 'Failed', 'Completed'];
const FAILED_SHOWN_FOR_MS = 6 * 3_600_000;

/**
 * One list, in the order the work happens: what is running now, what is waiting in the inbox (in the order the watcher takes it), jobs whose XML
 * is in but whose PDF has not arrived, recent failures, and finished jobs at the bottom, newest first.
 */
const stemOf = (name: string): string => name.replace(/\.[^.]+$/, '').toLowerCase();

export function buildLines(d: ActivityData, now: number = Date.now()): ActivityLine[] {
  const lines: ActivityLine[] = [];
  // A finished job's own times are those of the import and PDF check that made it, found by the name they share.
  const doneByStem = new Map<string, { start: string; end: string }>();
  for (const r of d.recent.filter((x) => x.state === 'Done' && x.kind !== 'Print files' && x.finishedAt)) {
    const k = stemOf(r.label), seen = doneByStem.get(k);
    doneByStem.set(k, { start: seen && seen.start < r.startedAt ? seen.start : r.startedAt, end: seen && seen.end > r.finishedAt! ? seen.end : r.finishedAt! });
  }
  const busy = new Set<string>();
  for (const r of d.running) {
    busy.add(r.label.toLowerCase());
    const printing = r.kind === 'Print files';
    lines.push({ key: `r${r.id}`, stage: printing ? 'Making print files' : 'Processing', name: r.label, bytes: null, pdf: 'none', detail: r.stalled ? 'No progress for a while; the program doing this may have stopped' : r.detail ?? (printing ? 'Starting' : r.kind === 'PDF check' ? 'Checking the PDF' : 'Importing the XML'),
      progress: r.total ? { done: r.done ?? 0, total: r.total, unit: printing ? 'mailpieces' : 'pages' } : null, seconds: r.remainingSeconds ?? null, start: r.startedAt, end: null, waitingSince: null, stalled: r.stalled });
  }
  for (const f of d.inbox) {
    if ((f.xmlName && busy.has(f.xmlName.toLowerCase())) || (f.pdfName && busy.has(f.pdfName.toLowerCase()))) continue;
    lines.push({ key: `i${f.stem}`, stage: 'Waiting', name: f.xmlName ?? f.pdfName ?? f.stem, bytes: f.xmlBytes ?? f.pdfBytes, pdf: f.pdfName ? 'arrived' : 'waiting',
      detail: f.xmlName ? (f.pdfName ? 'Both files are here' : 'XML will be imported; the PDF has not arrived yet') : 'PDF is here; its XML has not arrived yet', progress: null, seconds: f.estimateSeconds ?? null, start: null, end: null, waitingSince: f.modifiedAt, stalled: false });
  }
  for (const j of d.jobs.filter((x) => x.status === 'Awaiting PDF')) {
    lines.push({ key: `j${j.id}`, stage: 'Awaiting PDF', name: j.pdfFileName, bytes: null, pdf: 'waiting', detail: `Job ${j.id} (${j.customerName}): XML imported, waiting for the PDF`, progress: null, seconds: null, start: null, end: null, waitingSince: j.receivedAt, stalled: false });
  }
  for (const r of d.recent.filter((x) => x.state === 'Failed' && now - Date.parse(x.finishedAt ?? x.updatedAt) < FAILED_SHOWN_FOR_MS)) {
    lines.push({ key: `f${r.id}`, stage: 'Failed', name: r.label, bytes: null, pdf: 'none', detail: r.detail, progress: null, seconds: null, start: r.startedAt, end: r.finishedAt ?? r.updatedAt, waitingSince: null, stalled: false });
  }
  for (const j of d.jobs.filter((x) => x.status !== 'Awaiting PDF').sort((a, b) => b.id - a.id)) {
    const made = j.batchCount > 0 && j.composedBatchCount === j.batchCount;
    lines.push({ key: `c${j.id}`, stage: j.status === 'PDF Rejected' ? 'Failed' : 'Completed', name: j.pdfFileName, bytes: null, pdf: 'arrived',
      detail: j.status === 'PDF Rejected' ? `Job ${j.id}: PDF rejected: ${j.pdfError ?? ''}` : `Job ${j.id} (${j.customerName}): ${made ? 'print files made' : j.composedBatchCount > 0 ? `print files made for ${j.composedBatchCount} of ${j.batchCount} batches` : 'ready; print files not made yet'}`,
      progress: null, seconds: null, ...(doneByStem.get(j.baseName.toLowerCase()) ?? { start: null, end: j.receivedAt }), waitingSince: null, stalled: false });
  }
  // Making the print files is work of its own, with its own times.
  for (const r of d.recent.filter((x) => x.state === 'Done' && x.kind === 'Print files')) {
    lines.push({ key: `p${r.id}`, stage: 'Completed', name: r.label, bytes: null, pdf: 'arrived', detail: r.detail, progress: null, seconds: null, start: r.startedAt, end: r.finishedAt ?? r.updatedAt, waitingSince: null, stalled: false });
  }
  // Stable: keep the order built above within a stage (the inbox is already in the watcher's order), and show the stages in ORDER.
  return lines.map((l, i) => ({ l, i })).sort((a, b) => ORDER.indexOf(a.l.stage) - ORDER.indexOf(b.l.stage) || a.i - b.i).map((x) => x.l);
}

export const COLOUR: Record<Stage, string> = { 'Making print files': 'blue', Processing: 'blue', Waiting: 'gray', 'Awaiting PDF': 'yellow', Failed: 'red', Completed: 'green' };
export const size = (n: number | null): string => (n === null ? '' : n < 1024 ? `${n} B` : n < 1_048_576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1_048_576).toFixed(1)} MB`);
export const clock = (iso: string | null): string => (iso ? new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');
/** "45 s", "14 min", "1 h 20 min": a rough length of time. */
export function duration(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`;
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}
/** The Duration column: how long it has been running or waiting, or how long it took. */
export function durationText(l: ActivityLine, now: number): string {
  if (l.stage === 'Making print files' || l.stage === 'Processing') return l.start ? `${elapsed(l.start, now)}${l.seconds !== null ? `, about ${duration(l.seconds)} left` : ''}` : '';
  if (l.waitingSince) return `waiting ${elapsed(l.waitingSince, now)}`;
  return l.start && l.end ? elapsed(l.start, Date.parse(l.end)) : '';
}
export function elapsed(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
