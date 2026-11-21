import { useState } from 'react';
import { Button, Grid, Group, NumberInput, Paper, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { setNextBatchCode, type BatchCodeInfo } from '../api/settings';

/** The batch code is one running number shared by every batch. It is set separately because it is a counter, not a preference. */
export function BatchCodeCard({ info, onChanged }: { info: BatchCodeInfo; onChanged: (b: BatchCodeInfo) => void }) {
  const [next, setNext] = useState<number | string>(info.next);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const set = async () => {
    setBusy(true); setError(undefined);
    try {
      const res = await setNextBatchCode(Number(next));
      onChanged(res);
      setNext(res.next);
      notifications.show({ color: 'teal', title: 'Next batch code set', message: `The next batch will be ${res.next}` });
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Paper withBorder p="lg">
      <Title order={4} mb="md" c="brand.6">Batch code</Title>
      <Grid gap="xl" align="flex-start">
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Stack gap="xs">
            <Text size="sm">Highest batch code used so far: <b>{info.highestUsed ?? 'none yet'}</b></Text>
            <Group align="flex-end">
              <NumberInput label="Next batch code" value={next} onChange={setNext} min={1} allowDecimal={false} allowNegative={false} error={error} thousandSeparator="" style={{ flex: 1 }} />
              <Button loading={busy} onClick={set} disabled={Number(next) === info.next}>Set</Button>
            </Group>
          </Stack>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Stack gap={4}>
            <Text size="sm">One running number shared by every batch. It names the run sheet and print file and is the barcode on the run sheet.</Text>
            <Text size="xs" c="dimmed"><b>Used by:</b> Import: each new batch takes the next number. Set it to continue from FileMaker's current number.</Text>
            <Text size="xs" c="dimmed"><b>Takes effect:</b> Immediately. It can only be moved up: a number already used cannot be issued again.</Text>
          </Stack>
        </Grid.Col>
      </Grid>
    </Paper>
  );
}
