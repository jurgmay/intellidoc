import { useEffect, useState } from 'react';
import { Alert, Loader, Table, Text } from '@mantine/core';
import { getAudit, type AuditRow } from '../api/settings';

const when = (iso: string): string => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

export function ChangeLog({ version }: { version: number }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { getAudit().then((r) => setRows(r.rows)).catch((e: Error) => setError(e.message)); }, [version]);
  if (error) return <Alert color="red" title="Could not load the change log">{error}</Alert>;
  if (!rows) return <Loader />;
  if (rows.length === 0) return <Text c="dimmed">No changes have been made yet.</Text>;
  return (
    <Table striped withTableBorder>
      <Table.Thead><Table.Tr><Table.Th>When</Table.Th><Table.Th>Who</Table.Th><Table.Th>Setting</Table.Th><Table.Th>From</Table.Th><Table.Th>To</Table.Th></Table.Tr></Table.Thead>
      <Table.Tbody>
        {rows.map((r) => (
          <Table.Tr key={r.id}><Table.Td>{when(r.changedAt)}</Table.Td><Table.Td>{r.changedBy}</Table.Td><Table.Td>{r.setting}</Table.Td><Table.Td>{r.oldValue ?? ''}</Table.Td><Table.Td>{r.newValue ?? ''}</Table.Td></Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
