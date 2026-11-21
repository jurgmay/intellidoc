import { useState } from 'react';
import { Button, Group, Modal, Paper, Stack, Table, Text, TextInput } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { addBrand, deleteBrand, renameBrand, type BrandView } from '../../api/customers';
import { run, type TabProps } from './shared';

export function BrandsTab({ detail, reload }: TabProps) {
  const [editing, setEditing] = useState<BrandView | 'new' | null>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [confirm, setConfirm] = useState<BrandView | null>(null);

  const open = (b: BrandView | 'new') => { setEditing(b); setName(b === 'new' ? '' : b.name); setError(undefined); };
  const save = async () => {
    const res = await run(() => (editing === 'new' ? addBrand(detail.id, name.trim()) : renameBrand((editing as BrandView).id, name.trim())), 'Brand saved');
    if (res.ok) { setEditing(null); await reload(); } else setError(res.fieldErrors?.['name'] ?? res.message);
  };
  const remove = async () => {
    const b = confirm!;
    setConfirm(null);
    const res = await run(() => deleteBrand(b.id), `Brand "${b.name}" deleted`);
    if (res.ok) await reload();
  };

  return (
    <Stack>
      <Group justify="space-between">
        <Text size="sm" c="dimmed" maw={700}>
          A brand is matched by name from the XML. Batches never combine across brands. Envelopes can be set for a brand, and a brand in use cannot be deleted.
        </Text>
        <Button leftSection={<IconPlus size={16} />} onClick={() => open('new')}>Add brand</Button>
      </Group>
      <Paper withBorder>
        <Table verticalSpacing="sm">
          <Table.Thead><Table.Tr><Table.Th>Brand</Table.Th><Table.Th>In use</Table.Th><Table.Th /></Table.Tr></Table.Thead>
          <Table.Tbody>
            {detail.brands.map((b) => (
              <Table.Tr key={b.id}>
                <Table.Td fw={500}>{b.name}</Table.Td>
                <Table.Td>{b.usage === 0 ? <Text span c="dimmed">Not used</Text> : `${b.usage} record${b.usage === 1 ? '' : 's'}`}</Table.Td>
                <Table.Td>
                  <Group justify="flex-end" gap="xs">
                    <Button size="xs" variant="default" onClick={() => open(b)}>Rename</Button>
                    <Button size="xs" variant="subtle" color="red" disabled={b.usage > 0} onClick={() => setConfirm(b)}>Delete</Button>
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
            {detail.brands.length === 0 && <Table.Tr><Table.Td colSpan={3}><Text c="dimmed" ta="center" py="md">No brands.</Text></Table.Td></Table.Tr>}
          </Table.Tbody>
        </Table>
      </Paper>
      <Modal opened={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add brand' : 'Rename brand'}>
        <Stack>
          <TextInput label="Brand name" value={name} onChange={(e) => setName(e.currentTarget.value)} error={error} data-autofocus />
          <Group justify="flex-end"><Button variant="default" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save}>Save</Button></Group>
        </Stack>
      </Modal>
      <Modal opened={confirm !== null} onClose={() => setConfirm(null)} title="Delete brand">
        <Stack>
          <Text>Delete the brand &quot;{confirm?.name}&quot;? This cannot be undone.</Text>
          <Group justify="flex-end"><Button variant="default" onClick={() => setConfirm(null)}>Cancel</Button><Button color="red" onClick={remove}>Delete</Button></Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
