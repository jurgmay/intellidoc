import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Badge, Button, Checkbox, Group, Loader, Modal, Paper, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconAlertCircle, IconPlus, IconSearch } from '@tabler/icons-react';
import { createCustomer, listCustomers, type CustomerRow } from '../api/customers';
import { useColumnWidths, type ColumnSpec } from '../components/useColumnWidths';
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

const CELL = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const;
type Item = { row: CustomerRow; depth: number };
const flagLabels = (r: CustomerRow): string[] => [r.isAddressMatching && 'Address matching', r.isUseMrdf && 'MRDF', r.isSso && 'SSO', r.isTesting && 'Testing', r.isDeleted && 'Deleted'].filter((x): x is string => !!x);
const dash = (v: string | null): string => v ?? '–';

/** The columns, with the text each one has to fit. The list keeps one line per customer, so a column is as wide as its longest value. */
const COLUMNS: (ColumnSpec<Item> & { align?: 'center' })[] = [
  { key: 'name', header: 'Name', cell: ({ row, depth }) => `${depth > 0 ? '└ ' : ''}${row.name}${depth === 0 && row.parentCode ? ` · part of ${row.parentCode}` : ''}`, extra: ({ depth }) => depth * 24 },
  { key: 'code', header: 'Account code', cell: ({ row }) => row.code },
  { key: 'job', header: 'Job number', cell: ({ row }) => dash(row.misJobNumber), align: 'center' },
  { key: 'pending', header: 'Pending job number', cell: ({ row }) => dash(row.pendingJobNumber), align: 'center' },
  { key: 'accounts', header: 'Accounts', cell: ({ row }) => String(row.accountCount), align: 'center' },
  { key: 'brands', header: 'Brands', cell: ({ row }) => String(row.brandCount), align: 'center' },
  { key: 'envelopes', header: 'Envelopes', cell: ({ row }) => String(row.envelopeCount), align: 'center' },
  { key: 'flags', header: 'Flags', cell: ({ row }) => flagLabels(row).join(' '), extra: ({ row }) => flagLabels(row).length * 24 },
];

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
  const items = useMemo(() => (rows ? inHierarchy(rows) : []), [rows]);
  const cols = useColumnWidths('intellidoc.customers.columns', COLUMNS, items);

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
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={2}>Customers</Title>
          <Text c="dimmed" size="sm">Everything that decides how a customer&apos;s files are imported: accounts, brands, envelopes, address matching, batching and notifications.</Text>
        </div>
        <Button leftSection={<IconPlus size={16} />} onClick={() => { setAdding(true); setCode(''); setName(''); setErrors({}); }}>New customer</Button>
      </Group>
      <Group>
        <TextInput placeholder="Search by name, account code or job number" leftSection={<IconSearch size={16} />} value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={420} aria-label="Search customers" />
        <Checkbox label="Show deleted" checked={deleted} onChange={(e) => setDeleted(e.currentTarget.checked)} />
      </Group>
      {error && <Alert color="red" icon={<IconAlertCircle />} title="Could not load the customers">{error}</Alert>}
      {!rows && !error && <Loader />}
      {rows && (
        <Paper withBorder style={{ overflowX: 'auto' }}>
          <Table highlightOnHover verticalSpacing="sm" style={{ tableLayout: 'fixed', width: cols.total, minWidth: '100%' }}>
            <colgroup>{COLUMNS.map((c) => <col key={c.key} style={{ width: cols.widthOf(c.key) }} />)}</colgroup>
            <Table.Thead>
              <Table.Tr>
                {COLUMNS.map((c) => (
                  <Table.Th key={c.key} ta={c.align} style={{ position: 'relative', whiteSpace: 'nowrap', overflow: 'hidden' }}>
                    {c.header}
                    <div role="separator" aria-orientation="vertical" aria-label={`Resize ${c.header} column`} title="Drag to resize, double-click to fit"
                      onMouseDown={cols.startResize(c.key)} onDoubleClick={() => cols.fit(c.key)}
                      style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 8, cursor: 'col-resize', borderRight: `2px solid ${cols.dragging === c.key ? 'var(--mantine-color-brand-6)' : 'transparent'}` }} />
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {items.map(({ row: r, depth }) => (
                <Table.Tr key={r.id} onClick={() => nav(`/customers/${r.id}`)} style={{ cursor: 'pointer' }}>
                  <Table.Td fw={500} pl={depth * 24 + 12} style={CELL}>{depth > 0 && <Text span c="dimmed" fw={400}>└ </Text>}{r.name}{depth === 0 && r.parentCode && <Text span size="xs" c="dimmed" fw={400}> · part of {r.parentCode}</Text>}</Table.Td>
                  <Table.Td style={CELL}>{r.code}</Table.Td>
                  <Table.Td ta="center" style={CELL}>{r.misJobNumber ?? <Text span c="dimmed">–</Text>}</Table.Td>
                  <Table.Td ta="center" style={CELL}>{r.pendingJobNumber ?? <Text span c="dimmed">–</Text>}</Table.Td>
                  <Table.Td ta="center" style={CELL}>{r.accountCount}</Table.Td>
                  <Table.Td ta="center" style={CELL}>{r.brandCount}</Table.Td>
                  <Table.Td ta="center" style={CELL}>{r.envelopeCount}</Table.Td>
                  <Table.Td style={CELL}>
                    <Group gap={6} wrap="nowrap">
                      {r.isAddressMatching && <Badge variant="light">Address matching</Badge>}
                      {r.isUseMrdf && <Badge color="green" variant="light">MRDF</Badge>}
                      {r.isSso && <Badge color="violet" variant="light">SSO</Badge>}
                      {r.isTesting && <Badge color="orange" variant="light">Testing</Badge>}
                      {r.isDeleted && <Badge color="gray">Deleted</Badge>}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
              {items.length === 0 && <Table.Tr><Table.Td colSpan={COLUMNS.length}><Text c="dimmed" ta="center" py="md">No customers match.</Text></Table.Td></Table.Tr>}
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
