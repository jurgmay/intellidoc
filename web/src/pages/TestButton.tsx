import { useState } from 'react';
import { Alert, Button, Group, Stack, Text } from '@mantine/core';
import { IconCircleCheck, IconAlertCircle } from '@tabler/icons-react';
import type { TestResult } from '../api/settings';

/** A button that runs a test and shows what came back under it. The result stays until the test is run again. */
export function TestButton({ label, hint, run }: { label: string; hint?: string; run: () => Promise<TestResult> }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const go = async () => {
    setBusy(true); setResult(null);
    try { setResult(await run()); } catch (e) { setResult({ ok: false, message: (e as Error).message }); } finally { setBusy(false); }
  };
  return (
    <Stack gap="xs" mt="lg">
      <Group><Button variant="light" loading={busy} onClick={go}>{label}</Button>{hint && <Text size="xs" c="dimmed">{hint}</Text>}</Group>
      {result && (
        <Alert color={result.ok ? 'teal' : 'red'} icon={result.ok ? <IconCircleCheck /> : <IconAlertCircle />} role="status">{result.message}</Alert>
      )}
    </Stack>
  );
}
