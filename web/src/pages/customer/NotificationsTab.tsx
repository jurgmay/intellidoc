import { useState } from 'react';
import { Alert, Button, Group, Paper, Stack, Text, Textarea, Title } from '@mantine/core';
import { saveEmails } from '../../api/customers';
import { FromParent, ModeSelect } from './ModeSelect';
import { run, type TabProps } from './shared';

export function NotificationsTab({ detail, reload }: TabProps) {
  const mode = detail.modes.emails;
  const [text, setText] = useState(detail.emails.join('\n'));
  const [error, setError] = useState<string | undefined>();
  const dirty = text.split(/[;,\s]+/).filter(Boolean).join('\n') !== detail.emails.join('\n');
  const save = async () => {
    const res = await run(() => saveEmails(detail.id, text.split('\n')), 'Notification e-mails saved');
    if (res.ok) { setError(undefined); await reload(); } else setError(res.fieldErrors?.['emails'] ?? res.message);
  };
  return (
    <Stack>
      <ModeSelect detail={detail} setting="emails" label="Where the notification addresses come from" noun="list" reload={reload}
        hint="With the parent's list plus its own, everyone on either list is e-mailed once.">
        {mode === 'INHERIT' && detail.emails.length > 0 && <Alert color="yellow" variant="light" mt="sm">This customer's own addresses are kept but not used while it takes the parent's list.</Alert>}
      </ModeSelect>
      <Paper withBorder p="lg">
        <Title order={4} mb={4} c="brand.6">Notification e-mails</Title>
        <Text size="sm" c="dimmed" mb="md">Who is e-mailed about this customer&apos;s jobs. One address per line (commas and semicolons also work).</Text>
        <Textarea aria-label="Notification e-mail addresses" autosize minRows={4} disabled={mode === 'INHERIT'} value={text} onChange={(e) => setText(e.currentTarget.value)} error={error} />
      </Paper>
      <Group justify="flex-end"><Button onClick={save} disabled={!dirty || mode === 'INHERIT'}>Save</Button></Group>
      <FromParent head={['E-mail address']} rows={detail.inherited.emails.map((e) => ({ key: e.email, cells: [e.email], from: e.from.name }))} />
    </Stack>
  );
}
