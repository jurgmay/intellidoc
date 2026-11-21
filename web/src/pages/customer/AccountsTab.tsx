import { useState } from 'react';
import { Badge, Button, Group, Modal, Paper, Stack, Table, Text, TextInput } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { addAccount, updateAccount, type AccountView } from '../../api/customers';
import { run, type TabProps } from './shared';

export function AccountsTab({ detail, reload }: TabProps) {
  const [editing, setEditing] = useState<AccountView | 'new' | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const open = (a: AccountView | 'new') => { setEditing(a); setCode(a === 'new' ? '' : a.code); setName(a === 'new' ? '' : a.name); setErrors({}); };
  const save = async () => {
    const res = await run(() => (editing === 'new' ? addAccount(detail.id, code.trim(), name.trim()) : updateAccount((editing as AccountView).id, code.trim(), name.trim(), false)), 'Account saved');
    if (res.ok) { setEditing(null); await reload(); } else setErrors(res.fieldErrors ?? {});
  };
  const setDeleted = async (a: AccountView, isDeleted: boolean) => {
    const res = await run(() => updateAccount(a.id, a.code, a.name, isDeleted), isDeleted ? `${a.code} removed` : `${a.code} restored`);
    if (res.ok) await reload();
  };

  return (
    <Stack>
      <Group justify="space-between">
        <Text size="sm" c="dimmed" maw={700}>
          Sub-accounts are the account codes that appear as the owner in this customer&apos;s XML files. Settings (brands, envelopes, matching) are read from the customer, not the sub-account.
        </Text>
        <Button leftSection={<IconPlus size={16} />} onClick={() => open('new')}>Add account</Button>
      </Group>
      <Paper withBorder>
        <Table verticalSpacing="sm">
          <Table.Thead><Table.Tr><Table.Th>Account code</Table.Th><Table.Th>Name</Table.Th><Table.Th /></Table.Tr></Table.Thead>
          <Table.Tbody>
            {detail.accounts.map((a) => (
              <Table.Tr key={a.id}>
                <Table.Td>{a.code} {a.isDeleted && <Badge color="gray" ml="xs">Removed</Badge>}</Table.Td>
                <Table.Td c={a.isDeleted ? 'dimmed' : undefined}>{a.name}</Table.Td>
                <Table.Td>
                  <Group justify="flex-end" gap="xs">
                    {!a.isDeleted && <Button size="xs" variant="default" onClick={() => open(a)}>Edit</Button>}
                    <Button size="xs" variant="subtle" color={a.isDeleted ? 'brand' : 'red'} onClick={() => setDeleted(a, !a.isDeleted)}>{a.isDeleted ? 'Restore' : 'Remove'}</Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
            {detail.accounts.length === 0 && <Table.Tr><Table.Td colSpan={3}><Text c="dimmed" ta="center" py="md">No sub-accounts.</Text></Table.Td></Table.Tr>}
          </Table.Tbody>
        </Table>
      </Paper>
      <Modal opened={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add account' : 'Edit account'}>
        <Stack>
          <TextInput label="Account code" value={code} onChange={(e) => setCode(e.currentTarget.value)} error={errors['code']} data-autofocus />
          <TextInput label="Name" value={name} onChange={(e) => setName(e.currentTarget.value)} error={errors['name']} />
          <Group justify="flex-end"><Button variant="default" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save}>Save</Button></Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
