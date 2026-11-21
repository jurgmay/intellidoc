import { useEffect, useState } from 'react';
import { Alert, Loader, Paper, Table, Text } from '@mantine/core';
import { getHistory, type HistoryRow } from '../../api/customers';

export function HistoryTab({ customerId }: { customerId: number }) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { getHistory(customerId).then((r) => setRows(r.rows)).catch((e: Error) => setError(e.message)); }, [customerId]);
  if (error) return <Alert color="red">{error}</Alert>;
  if (!rows) return <Loader />;
  if (rows.length === 0) return <Text c="dimmed">No changes have been made from the web app yet.</Text>;
  return (
    <Paper withBorder>
      <Table verticalSpacing="xs">
        <Table.Thead><Table.Tr><Table.Th>When</Table.Th><Table.Th>Who</Table.Th><Table.Th>Change</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {rows.map((r) => (
            <Table.Tr key={r.id}><Table.Td style={{ whiteSpace: 'nowrap' }}>{new Date(r.changedAt).toLocaleString('en-GB')}</Table.Td><Table.Td>{r.changedBy}</Table.Td><Table.Td>{r.summary}</Table.Td></Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}
