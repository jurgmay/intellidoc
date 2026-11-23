import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Anchor, Badge, Group, Loader, Paper, Progress, Stack, Table, Text, Title } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { getActivity, type ActivityData } from '../api/activity';

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

const ORDER: Stage[] = ['Making print files', 'Processing', 'Waiting', 'Awaiting PDF', 'Failed', 'Completed'];
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

const COLOUR: Record<Stage, string> = { 'Making print files': 'blue', Processing: 'blue', Waiting: 'gray', 'Awaiting PDF': 'yellow', Failed: 'red', Completed: 'green' };
export const size = (n: number | null): string => (n === null ? '' : n < 1024 ? `${n} B` : n < 1_048_576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1_048_576).toFixed(1)} MB`);
const clock = (iso: string | null): string => (iso ? new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');
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

/** What the watcher is doing: the inbox, what is being imported or printed, and what has finished. Refreshes itself. */
export function ActivityPage({ refreshMs = 3000 }: { refreshMs?: number }) {
  const [data, setData] = useState<ActivityData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let live = true;
    let inFlight = false;   // per effect run: React's development double-run must not leave the second run waiting on the first's discarded request
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try { const d = await getActivity(); if (live) { setData(d); setError(null); setNow(Date.now()); } }
      catch (e) { if (live) setError((e as Error).message); }
      finally { inFlight = false; }
    };
    void load();
    const t = setInterval(() => { void load(); }, refreshMs);
    return () => { live = false; clearInterval(t); };
  }, [refreshMs]);

  const lines = data ? buildLines(data, now) : [];
  const count = (s: Stage) => lines.filter((l) => l.stage === s).length;
  return (
    <Stack>
      <Group justify="space-between"><Title order={2}>Activity</Title></Group>
      <Text size="sm" c="dimmed">Updates every few seconds. The inbox is taken smallest XML first.</Text>
      {error && <Alert color="red" icon={<IconAlertCircle size={16} />}>{error}</Alert>}
      {data && data.autoCompose === false && (
        <Alert color="yellow" icon={<IconAlertCircle size={16} />} title="Print files are not made automatically">
          "Make print files automatically" is off, so jobs wait until someone presses Make print files on the Jobs screen. Turn it on in <Anchor component={Link} to="/settings">Settings</Anchor> (Print file marks).
        </Alert>
      )}
      {data?.inboxUnavailable && <Alert color="yellow" icon={<IconAlertCircle size={16} />} title="The inbox cannot be shown">{data.inboxUnavailable}</Alert>}
      {data && data.queue.seconds !== null && data.queue.seconds > 0 && (
        <Alert color="blue" variant="light">
          {data.queue.partial ? 'At least ' : 'About '}<b>{duration(data.queue.seconds)}</b> to clear the inbox
          <Text span size="xs" c="dimmed"> (from the last {data.queue.basedOn} imports and PDF checks{data.queue.partial ? '; some files are too new to estimate' : ''})</Text>
        </Alert>
      )}
      {data && (
        <Group gap="xs">
          {ORDER.map((s) => <Badge key={s} color={COLOUR[s]} variant="light">{count(s)} {s.toLowerCase()}</Badge>)}
        </Group>
      )}
      {(
        <Paper withBorder>
          <Table highlightOnHover>
            <Table.Thead><Table.Tr><Table.Th>Status</Table.Th><Table.Th>File</Table.Th><Table.Th ta="right">Size</Table.Th><Table.Th>PDF</Table.Th><Table.Th>Progress</Table.Th><Table.Th>Start time</Table.Th><Table.Th>End time</Table.Th><Table.Th>Duration</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {lines.map((l) => (
                <Table.Tr key={l.key}>
                  <Table.Td><Badge color={COLOUR[l.stage]} variant={l.stage === 'Completed' ? 'light' : 'filled'}>{l.stage}</Badge></Table.Td>
                  <Table.Td>{l.name}</Table.Td>
                  <Table.Td ta="right">{size(l.bytes)}</Table.Td>
                  <Table.Td>{l.pdf === 'arrived' ? <Badge color="green" variant="light">Arrived</Badge> : l.pdf === 'waiting' ? <Badge color="yellow" variant="light">Not yet</Badge> : ''}</Table.Td>
                  <Table.Td miw={260}>
                    {l.progress && <Progress value={l.progress.total ? (l.progress.done / l.progress.total) * 100 : 0} mb={4} animated aria-label={`${l.progress.done} of ${l.progress.total} ${l.progress.unit}`} />}
                    {!l.progress && (l.stage === 'Processing' || l.stage === 'Making print files') && !l.stalled && <Progress value={100} animated mb={4} />}
                    <Text size="xs" c={l.stalled || l.stage === 'Failed' ? 'red' : 'dimmed'}>{l.detail}{l.stage === 'Waiting' && l.seconds !== null ? ` (about ${duration(l.seconds)})` : ''}</Text>
                  </Table.Td>
                  <Table.Td>{clock(l.start)}</Table.Td>
                  <Table.Td>{clock(l.end)}</Table.Td>
                  <Table.Td>{durationText(l, now)}</Table.Td>
                </Table.Tr>
              ))}
              {!data && !error && <Table.Tr><Table.Td colSpan={8}><Group justify="center" gap="xs" py="md" role="status"><Loader size="sm" /><Text c="dimmed">Loading…</Text></Group></Table.Td></Table.Tr>}
              {data && lines.length === 0 && <Table.Tr><Table.Td colSpan={8}><Text c="dimmed" ta="center">Nothing in the inbox and nothing running.</Text></Table.Td></Table.Tr>}
            </Table.Tbody>
          </Table>
        </Paper>
      )}
    </Stack>
  );
}
