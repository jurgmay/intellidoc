import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Anchor, Badge, Group, Loader, Paper, Progress, Stack, Table, Text, Title } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { getActivity, type ActivityData } from '../api/activity';
import { buildLines, clock, COLOUR, duration, durationText, ORDER, type Stage } from './activityLines';

/** Badges that always show all their text: Mantine's badge shortens its text with an ellipsis when its cell is narrow. */
const BADGE_FULL = { root: { overflow: 'visible', maxWidth: 'none' }, label: { overflow: 'visible', textOverflow: 'clip' } } as const;

/** What the watcher is doing: the inbox, what is being imported or printed, and what has finished. Refreshes itself. */
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
            <Table.Thead><Table.Tr><Table.Th data-min-width={180} ta="center" style={{ whiteSpace: 'nowrap' }}>Status</Table.Th><Table.Th data-min-width={300}>Account</Table.Th><Table.Th data-min-width={128} ta="center" style={{ whiteSpace: 'nowrap' }}>PDF</Table.Th><Table.Th>Progress</Table.Th><Table.Th ta="center" style={{ whiteSpace: 'nowrap' }}>Start time</Table.Th><Table.Th ta="center" style={{ whiteSpace: 'nowrap' }}>End time</Table.Th><Table.Th ta="center">Duration</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {lines.map((l) => (
                <Table.Tr key={l.key}>
                  <Table.Td ta="center" style={{ whiteSpace: 'nowrap' }}><Badge color={COLOUR[l.stage]} variant={l.stage === 'Completed' ? 'light' : 'filled'} styles={BADGE_FULL}>{l.stage}</Badge></Table.Td>
                  <Table.Td>{l.account}</Table.Td>
                  <Table.Td ta="center" style={{ whiteSpace: 'nowrap' }}>{l.pdf === 'arrived' ? <Badge color="green" variant="light" styles={BADGE_FULL}>Arrived</Badge> : l.pdf === 'waiting' ? <Badge color="yellow" variant="light" styles={BADGE_FULL}>Not yet</Badge> : ''}</Table.Td>
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
              {!data && !error && <Table.Tr><Table.Td colSpan={7}><Group justify="center" gap="xs" py="md" role="status"><Loader size="sm" /><Text c="dimmed">Loading…</Text></Group></Table.Td></Table.Tr>}
              {data && lines.length === 0 && <Table.Tr><Table.Td colSpan={7}><Text c="dimmed" ta="center">Nothing in the inbox and nothing running.</Text></Table.Td></Table.Tr>}
            </Table.Tbody>
          </Table>
        </Paper>
      )}
    </Stack>
  );
}
