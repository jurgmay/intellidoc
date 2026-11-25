import { useEffect, useState } from 'react';
import { notifications } from '@mantine/notifications';
import { Link } from 'react-router-dom';
import { ActionIcon, Alert, Anchor, Badge, Group, Loader, Paper, Progress, Stack, Table, Text, Title, Tooltip } from '@mantine/core';
import { IconAlertCircle, IconRefresh } from '@tabler/icons-react';
import { composeJob } from '../api/jobs';
import { dismissActivity, getActivity, retryActivity, type ActivityData } from '../api/activity';
import { buildLines, clock, COLOUR, durationText, ORDER, type ActivityLine, type Stage } from './activityLines';

/** Badges that always show all their text: Mantine's badge shortens its text with an ellipsis when its cell is narrow. */
const BADGE_FULL = { root: { overflow: 'visible', maxWidth: 'none' }, label: { overflow: 'visible', textOverflow: 'clip' } } as const;

/** What the watcher is doing: the inbox, what is being imported or printed, and what has finished. Refreshes itself. */
/** Tries a failed row again: an import or PDF check goes back in the inbox; print files are made again for the job (only the batches that have none). */
async function retryFailed(r: NonNullable<ActivityLine['retry']>): Promise<void> {
  if (r.kind === 'Print files') {
    if (r.jobId === null) throw new Error('This row does not say which job it was for.');
    await composeJob(r.jobId, true);
    await dismissActivity(r.id);
    notifications.show({ color: 'green', title: 'Print files made', message: `Job ${r.jobId}` });
  } else {
    const { restored } = await retryActivity(r.id);
    notifications.show({ color: 'green', title: 'Back in the inbox', message: restored.join(', ') });
  }
}

function RetryButton({ line, onDone }: { line: ActivityLine; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const r = line.retry!;
  const go = async () => {
    setBusy(true);
    try { await retryFailed(r); onDone(); }
    catch (e) { notifications.show({ color: 'red', title: 'Could not retry', message: (e as Error).message, autoClose: false }); }
    finally { setBusy(false); }
  };
  return (
    <Tooltip label={r.kind === 'Print files' ? 'Make the print files again' : 'Put the files back in the inbox'}>
      <ActionIcon variant="subtle" color="red" loading={busy} onClick={() => { void go(); }} aria-label={`Retry ${line.name}`}><IconRefresh size={18} /></ActionIcon>
    </Tooltip>
  );
}

export const ACTIVE_REFRESH_MS = 1500;
export const IDLE_REFRESH_MS = 3000;

/** Active means something is waiting in the inbox or being worked on now. */
export const isBusy = (d: ActivityData | null): boolean => d !== null && (d.inbox.length > 0 || d.running.length > 0);

/** What the watcher is doing: the inbox, what is being imported or printed, and what has finished. Refreshes itself: quicker while busy, slower when idle. `refreshMs` forces one rate (used by tests). */
export function ActivityPage({ refreshMs }: { refreshMs?: number }) {
  const [data, setData] = useState<ActivityData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy = false;
    // The next refresh is booked only when the last one has finished, so slow answers never pile up.
    const load = async () => {
      try { const d = await getActivity(); if (live) { setData(d); setError(null); setNow(Date.now()); busy = isBusy(d); } }
      catch (e) { if (live) setError((e as Error).message); }
      if (live) timer = setTimeout(() => { void load(); }, refreshMs ?? (busy ? ACTIVE_REFRESH_MS : IDLE_REFRESH_MS));
    };
    void load();
    return () => { live = false; clearTimeout(timer); };
  }, [refreshMs]);

  /** One extra refresh now (after a retry), so the failed row goes at once rather than at the next tick. */
  const refresh = async () => { try { setData(await getActivity()); setNow(Date.now()); } catch { /* the next scheduled refresh shows any error */ } };

  const lines = data ? buildLines(data, now) : [];
  const count = (s: Stage) => lines.filter((l) => l.stage === s).length;
  return (
    <Stack>
      <Group justify="space-between"><Title order={2}>Activity</Title></Group>
      <Text size="sm" c="dimmed">Updates every second or two while busy, and every few seconds when idle. The inbox is taken smallest XML first.</Text>
      {error && <Alert color="red" icon={<IconAlertCircle size={16} />}>{error}</Alert>}
      {data && data.autoCompose === false && (
        <Alert color="yellow" icon={<IconAlertCircle size={16} />} title="Print files are not made automatically">
          "Make print files automatically" is off, so jobs wait until someone presses Make print files on the Jobs screen. Turn it on in <Anchor component={Link} to="/settings">Settings</Anchor> (Print production settings).
        </Alert>
      )}
      {data?.inboxUnavailable && <Alert color="yellow" icon={<IconAlertCircle size={16} />} title="The inbox cannot be shown">{data.inboxUnavailable}</Alert>}
      {data && (
        <Group gap="xs">
          {ORDER.map((s) => <Badge key={s} color={COLOUR[s]} variant="light">{count(s)} {s.toLowerCase()}</Badge>)}
        </Group>
      )}
      {(
        <Paper withBorder>
          <Table highlightOnHover>
            <Table.Thead><Table.Tr><Table.Th data-min-width={180} ta="center" style={{ whiteSpace: 'nowrap' }}>Status</Table.Th><Table.Th data-min-width={300}>Account</Table.Th><Table.Th>Progress</Table.Th><Table.Th ta="center" style={{ whiteSpace: 'nowrap' }}>Start time</Table.Th><Table.Th ta="center" style={{ whiteSpace: 'nowrap' }}>End time</Table.Th><Table.Th ta="center">Duration</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {lines.map((l) => (
                <Table.Tr key={l.key}>
                  <Table.Td ta="center" style={{ whiteSpace: 'nowrap' }}><Group gap={6} justify="center" wrap="nowrap"><Badge color={COLOUR[l.stage]} variant={l.stage === 'Completed' ? 'light' : 'filled'} styles={BADGE_FULL}>{l.stage}</Badge>{l.retry && <RetryButton line={l} onDone={() => { void refresh(); }} />}</Group></Table.Td>
                  <Table.Td>{l.account}</Table.Td>
                  <Table.Td miw={260}>
                    {l.progress && <Progress value={l.progress.total ? (l.progress.done / l.progress.total) * 100 : 0} mb={4} animated aria-label={`${l.progress.done} of ${l.progress.total} ${l.progress.unit}`} />}
                    {!l.progress && (l.stage === 'Processing' || l.stage === 'Making print files') && !l.stalled && <Progress value={100} animated mb={4} />}
                    <Text size="sm" c={l.stalled || l.stage === 'Failed' ? 'red' : undefined}>{l.detail}</Text>
                    <Text size="xs" c="dimmed" style={{ overflowWrap: 'anywhere' }}>{l.name}</Text>
                  </Table.Td>
                  <Table.Td ta="center" style={{ whiteSpace: 'nowrap' }}>{clock(l.start)}</Table.Td>
                  <Table.Td ta="center" style={{ whiteSpace: 'nowrap' }}>{clock(l.end)}</Table.Td>
                  <Table.Td ta="center" style={{ whiteSpace: 'nowrap' }}>{durationText(l, now)}</Table.Td>
                </Table.Tr>
              ))}
              {!data && !error && <Table.Tr><Table.Td colSpan={6}><Group justify="center" gap="xs" py="md" role="status"><Loader size="sm" /><Text c="dimmed">Loading…</Text></Group></Table.Td></Table.Tr>}
              {data && lines.length === 0 && <Table.Tr><Table.Td colSpan={6}><Text c="dimmed" ta="center">Nothing in the inbox and nothing running.</Text></Table.Td></Table.Tr>}
            </Table.Tbody>
          </Table>
        </Paper>
      )}
    </Stack>
  );
}
