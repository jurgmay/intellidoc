import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Badge, Button, Checkbox, Group, Loader, Modal, Paper, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconAlertCircle, IconPlus, IconSearch } from '@tabler/icons-react';
import { createCustomer, listCustomers, type CustomerRow } from '../api/customers';
import { run } from './customer/shared';

/** Puts each child directly under its parent. A row whose parent is not in the list (filtered out) stays at the top level. */
function inHierarchy(rows: CustomerRow[]): { row: CustomerRow; depth: number }[] {
  const ids = new Set(rows.map((r) => r.id));
  const kids = new Map<number, CustomerRow[]>();
  for (const r of rows) if (r.parentId !== null && ids.has(r.parentId) && r.parentId !== r.id) kids.set(r.parentId, [...(kids.get(r.parentId) ?? []), r]);
  const out: { row: CustomerRow; depth: number }[] = [];
  const seen = new Set<number>();
  const walk = (r: CustomerRow, depth: number) => {
    if (seen.has(r.id)) return; // guards against a loop in the data
    seen.add(r.id); out.push({ row: r, depth });
    for (const k of kids.get(r.id) ?? []) walk(k, depth + 1);
  };
  for (const r of rows) if (r.parentId === null || !ids.has(r.parentId) || r.parentId === r.id) walk(r, 0);
  for (const r of rows) walk(r, 0); // anything left over is part of a loop
  return out;
}

export function CustomersPage() {
  const nav = useNavigate();
  const [search, setSearch] = useState('');
  const [debounced] = useDebouncedValue(search, 250);
  const [deleted, setDeleted] = useState(false);
  const [rows, setRows] = useState<CustomerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    let current = true;
    listCustomers(debounced, deleted).then((r) => { if (current) { setRows(r.rows); setError(null); } }).catch((e: Error) => { if (current) setError(e.message); });
    return () => { current = false; };
  }, [debounced, deleted]);

  const create = async () => {
    let id = 0;
    const res = await run(async () => { id = (await createCustomer(code.trim(), name.trim())).id; }, `Customer ${code.trim()} created`);
    if (res.ok) nav(`/customers/${id}`);
    else setErrors(res.fieldErrors ?? {});
  };

  return (
    <Stack gap="lg" maw={1100}>
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>Customers</Title>
          <Text c="dimmed" size="sm">Everything that decides how a customer&apos;s files are imported: accounts, brands, envelopes, address matching, batching and notifications.</Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={() => { setAdding(true); setCode(''); setName(''); setErrors({}); }}>New customer</Button>
      </Group>
      <Group>
        <TextInput placeholder="Search by name, account code or MIS job number" leftSection={<IconSearch size={16} />} value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={420} aria-label="Search customers" />
        <Checkbox label="Show deleted" checked={deleted} onChange={(e) => setDeleted(e.currentTarget.checked)} />
      </Group>
      {error && <Alert color="red" icon={<IconAlertCircle />} title="Could not load the customers">{error}</Alert>}
      {!rows && !error && <Loader />}
      {rows && (
        <Paper withBorder>
          <Table highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th><Table.Th>Account code</Table.Th><Table.Th>MIS job</Table.Th>
                <Table.Th ta="right">Accounts</Table.Th><Table.Th ta="right">Brands</Table.Th><Table.Th ta="right">Envelopes</Table.Th><Table.Th>Flags</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {inHierarchy(rows).map(({ row: r, depth }) => (
                <Table.Tr key={r.id} onClick={() => nav(`/customers/${r.id}`)} style={{ cursor: 'pointer' }}>
                  <Table.Td fw={500} pl={depth * 24 + 12}>{depth > 0 && <Text span c="dimmed" fw={400}>└ </Text>}{r.name}{depth === 0 && r.parentCode && <Text span size="xs" c="dimmed" fw={400}> · part of {r.parentCode}</Text>}</Table.Td>
                  <Table.Td>{r.code}</Table.Td>
                  <Table.Td>{r.misJobNumber ?? <Text span c="dimmed">–</Text>}</Table.Td>
                  <Table.Td ta="right">{r.accountCount}</Table.Td>
                  <Table.Td ta="right">{r.brandCount}</Table.Td>
                  <Table.Td ta="right">{r.envelopeCount}</Table.Td>
                  <Table.Td>
                    <Group gap={6}>
                      {r.isAddressMatching && <Badge variant="light">Matching</Badge>}
                      {r.isTesting && <Badge color="orange" variant="light">Testing</Badge>}
                      {r.isDeleted && <Badge color="gray">Deleted</Badge>}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
              {rows.length === 0 && <Table.Tr><Table.Td colSpan={7}><Text c="dimmed" ta="center" py="md">No customers match.</Text></Table.Td></Table.Tr>}
            </Table.Tbody>
          </Table>
        </Paper>
      )}
      <Modal opened={adding} onClose={() => setAdding(false)} title="New customer">
        <Stack>
          <TextInput label="Account code" description="Unique across all customers and sub-accounts." value={code} onChange={(e) => setCode(e.currentTarget.value)} error={errors['code']} data-autofocus />
          <TextInput label="Name" value={name} onChange={(e) => setName(e.currentTarget.value)} error={errors['name']} />
          <Group justify="flex-end"><Button variant="default" onClick={() => setAdding(false)}>Cancel</Button><Button onClick={create}>Create</Button></Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
