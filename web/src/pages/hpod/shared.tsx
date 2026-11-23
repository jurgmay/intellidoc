import { useState } from 'react';
import { Alert, Badge, Button, Code, Group, Modal, ScrollArea, SegmentedControl, Stack, Text } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import type { CallInput, HpodResult } from '../../api/hpod';

/** Runs one H-POD operation and gives back what H-POD said. Throws when the server refused the call (a missing field, no sign-in details, H-POD unreachable). */
export type Run = (input: CallInput) => Promise<HpodResult>;

export const pretty = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));

/** What H-POD answered: status, time, call limits, and the response, the request that was sent or the headers. */
export function ResultPanel({ result }: { result: HpodResult }) {
  const [view, setView] = useState('response');
  const limits = Object.entries(result.headers).filter(([k]) => /^(x-rate-limit|ratelimit|retry-after)/i.test(k));
  return (
    <Stack gap="xs" data-testid="hpod-result">
      <Group gap="sm">
        <Badge color={result.ok ? 'teal' : 'red'} size="lg">{result.status} {result.statusText}</Badge>
        <Text size="sm">{result.durationMs} ms</Text>
        {limits.map(([k, v]) => <Badge key={k} variant="light" color="gray">{k}: {v}</Badge>)}
      </Group>
      <SegmentedControl size="xs" value={view} onChange={setView} data={[{ value: 'response', label: 'Response' }, { value: 'request', label: 'Request sent' }, { value: 'headers', label: 'Response headers' }]} />
      <ScrollArea.Autosize mah={420}>
        <Code block>{view === 'response' ? (result.body === null ? '(empty)' : pretty(result.body)) : view === 'request' ? pretty(result.request) : pretty(result.headers)}</Code>
      </ScrollArea.Autosize>
    </Stack>
  );
}

export function ErrorAlert({ message }: { message: string }) {
  return <Alert color="red" icon={<IconAlertCircle />} role="alert">{message}</Alert>;
}

/** Asks before anything that changes live data in H-POD or sends mail. */
export function ConfirmModal({ opened, title, children, confirmLabel, onConfirm, onCancel }: { opened: boolean; title: string; children: React.ReactNode; confirmLabel: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Modal opened={opened} onClose={onCancel} title={title} centered>
      <Stack>
        {children}
        <Group justify="flex-end"><Button variant="default" onClick={onCancel}>Cancel</Button><Button color="red" onClick={onConfirm}>{confirmLabel}</Button></Group>
      </Stack>
    </Modal>
  );
}

/** Runs `fn`, keeping the busy flag, the error message and the result for the panel under the form. */
export function useAction<T>(): { busy: boolean; error: string | null; value: T | null; run: (fn: () => Promise<T>) => Promise<void>; clear: () => void } {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [value, setValue] = useState<T | null>(null);
  return {
    busy, error, value,
    clear: () => { setError(null); setValue(null); },
    run: async (fn) => { setBusy(true); setError(null); try { setValue(await fn()); } catch (e) { setValue(null); setError((e as Error).message); } finally { setBusy(false); } },
  };
}
