import { useState } from 'react';
import { Button, Divider, Group, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import type { HpodResult } from '../../api/hpod';
import { ConfirmModal, ErrorAlert, ResultPanel, useAction, type Run } from './shared';

const STATUSES = ['printed', 'rejected', 'posted', 'delivered', 'returned', 'userActionRequired', 'failed', 'confirmedDownloadedForPrinting'];

/** The packs (letters) of a job: look a job or pack up, and set a pack's status. */
export function TrackTab({ run, jobGuid, setJobGuid }: { run: Run; jobGuid: string; setJobGuid: (v: string) => void }) {
  const [packGuid, setPackGuid] = useState('');
  const [status, setStatus] = useState<string | null>('printed');
  const [context, setContext] = useState('');
  const [confirming, setConfirming] = useState(false);
  const act = useAction<HpodResult>();

  const packsOf = (r: HpodResult | null): string[] => {
    const packs = (r?.body as { packs?: Array<{ guid?: string; packGuid?: string; packGUID?: string }> } | null)?.packs;
    return Array.isArray(packs) ? packs.map((p) => p.guid ?? p.packGuid ?? p.packGUID ?? '').filter(Boolean) : [];
  };
  const found = packsOf(act.value);

  return (
    <Stack>
      <Title order={4}>Job</Title>
      <Group align="flex-end">
        <TextInput label="Job GUID" style={{ flex: 1 }} value={jobGuid} onChange={(e) => setJobGuid(e.currentTarget.value)} />
        <Button loading={act.busy} disabled={!jobGuid.trim()} onClick={() => void act.run(() => run({ operation: 'jobStatus', path: { jobGuid: jobGuid.trim() } }))}>Get job status</Button>
      </Group>
      {found.length > 0 && (
        <Group gap="xs"><Text size="sm">Packs in this job:</Text>{found.map((g) => <Button key={g} size="compact-xs" variant="light" onClick={() => setPackGuid(g)}>{g}</Button>)}</Group>
      )}
      <Divider />
      <Title order={4}>Pack</Title>
      <Group align="flex-end">
        <TextInput label="Pack GUID" style={{ flex: 1 }} value={packGuid} onChange={(e) => setPackGuid(e.currentTarget.value)} />
        <Button variant="light" loading={act.busy} disabled={!packGuid.trim()} onClick={() => void act.run(() => run({ operation: 'packGet', path: { packGuid: packGuid.trim() } }))}>Get pack</Button>
      </Group>
      <Group align="flex-end">
        <Select label="New status" data={STATUSES} value={status} onChange={setStatus} allowDeselect={false} w={260} />
        <TextInput label="Context (a reason, or a tracking number)" style={{ flex: 1 }} value={context} onChange={(e) => setContext(e.currentTarget.value)} />
        <Button color="orange" disabled={!packGuid.trim() || !status} onClick={() => setConfirming(true)}>Set status</Button>
      </Group>
      {act.error && <ErrorAlert message={act.error} />}
      {act.value && <ResultPanel result={act.value} />}
      <ConfirmModal opened={confirming} title="Change the status of a live pack?" confirmLabel="Yes, change it" onCancel={() => setConfirming(false)}
        onConfirm={() => { setConfirming(false); void act.run(() => run({ operation: 'packBatch', confirm: true, body: { permitPartialUpdate: false, packs: [{ packGUID: packGuid.trim(), status, ...(context.trim() ? { context: context.trim() } : {}) }] } })); }}>
        <Text size="sm">This sets pack {packGuid.trim()} to "{status}" in H-POD, which the sender sees and which can set off notifications.</Text>
      </ConfirmModal>
    </Stack>
  );
}
