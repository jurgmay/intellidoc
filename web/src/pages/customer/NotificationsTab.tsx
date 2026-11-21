import { useState } from 'react';
import { Button, Group, Paper, Stack, Text, Textarea, Title } from '@mantine/core';
import { saveEmails } from '../../api/customers';
import { run, type TabProps } from './shared';

export function NotificationsTab({ detail, reload }: TabProps) {
  const [text, setText] = useState(detail.emails.join('\n'));
  const [error, setError] = useState<string | undefined>();
  const dirty = text.split(/[;,\s]+/).filter(Boolean).join('\n') !== detail.emails.join('\n');
  const save = async () => {
    const res = await run(() => saveEmails(detail.id, text.split('\n')), 'Notification e-mails saved');
    if (res.ok) { setError(undefined); await reload(); } else setError(res.fieldErrors?.['emails'] ?? res.message);
  };
  return (
    <Stack>
      <Paper withBorder p="lg">
        <Title order={4} mb={4} c="brand.6">Notification e-mails</Title>
        <Text size="sm" c="dimmed" mb="md">Who is e-mailed about this customer&apos;s jobs. One address per line (commas and semicolons also work).</Text>
        <Textarea aria-label="Notification e-mail addresses" autosize minRows={4} value={text} onChange={(e) => setText(e.currentTarget.value)} error={error} />
      </Paper>
      <Group justify="flex-end"><Button onClick={save} disabled={!dirty}>Save</Button></Group>
    </Stack>
  );
}
