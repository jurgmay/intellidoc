import { useEffect, useState } from 'react';
import { Alert, Badge, Group, Loader, Modal, SimpleGrid, Stack, Table, Text } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { getMailpiecePrice, type MailpiecePrice } from '../api/recipients';
import { ukDateTime } from '../dates';

const gbp = (n: number): string => `£${n.toFixed(4)}`;
const gbp2 = (n: number): string => `£${n.toFixed(2)}`;

/** How one mailpiece was priced at production: what it cost, what the customer pays, and every line. */
export function MailpiecePriceModal({ mailpieceId, onClose }: { mailpieceId: number | null; onClose: () => void }) {
  const [p, setP] = useState<MailpiecePrice | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setP(null); setError(null);
    if (mailpieceId !== null) getMailpiecePrice(mailpieceId).then(setP).catch((e: Error) => setError(e.message));
  }, [mailpieceId]);

  const margin = p && p.priced ? p.totalSell - p.totalCost : 0;
  return (
    <Modal opened={mailpieceId !== null} onClose={onClose} size="xl" title={p?.batchCode ? `Price of the mailpiece in batch ${p.batchCode}` : 'Price of the mailpiece'}>
      {error && <Alert color="red" icon={<IconAlertCircle size={16} />}>{error}</Alert>}
      {!p && !error && <Loader size="sm" />}
      {p && !p.priced && <Alert color="yellow" icon={<IconAlertCircle size={16} />} title="Not priced">{p.reason}</Alert>}
      {p && p.priced && (
        <Stack>
          <Group gap="xs">
            <Badge variant="light">{p.model?.name ?? 'No model'}</Badge>
            <Text size="sm" c="dimmed">
              {p.packs} pack{p.packs === 1 ? '' : 's'}: {p.colourPages} colour, {p.monoPages} mono and {p.blankPages} blank page{p.colourPages + p.monoPages + p.blankPages === 1 ? '' : 's'}. Priced {p.pricedAt ? ukDateTime(p.pricedAt) : ''}.
            </Text>
          </Group>
          {p.warnings && <Alert color="yellow" icon={<IconAlertCircle size={16} />} title="The price is incomplete">{p.warnings}</Alert>}
          <SimpleGrid cols={3}>
            <div><Text size="xs" c="dimmed">Customer pays</Text><Text fw={700} size="xl">{gbp2(p.totalSell)}</Text><Text size="xs" c="dimmed">production {gbp(p.productionSell)}, postage {gbp(p.postageSell)}</Text></div>
            <div><Text size="xs" c="dimmed">Costs Latcham</Text><Text fw={700} size="xl">{gbp2(p.totalCost)}</Text><Text size="xs" c="dimmed">production {gbp(p.productionCost)}, postage {gbp(p.postageCost)}</Text></div>
            <div><Text size="xs" c="dimmed">Difference</Text><Text fw={700} size="xl" c={margin < 0 ? 'red' : undefined}>{gbp2(margin)}</Text></div>
          </SimpleGrid>
          <Table verticalSpacing="xs" withTableBorder>
            <Table.Thead><Table.Tr><Table.Th>Charge</Table.Th><Table.Th ta="right">Quantity</Table.Th><Table.Th ta="right">Unit cost</Table.Th><Table.Th ta="right">Unit sell</Table.Th><Table.Th ta="right">Cost</Table.Th><Table.Th ta="right">Sell</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {p.lines.map((l, i) => (
                <Table.Tr key={`${l.code}-${i}`}>
                  <Table.Td>{l.label}</Table.Td><Table.Td ta="right">{l.quantity}</Table.Td>
                  <Table.Td ta="right">{l.unitCost.toFixed(4)}</Table.Td><Table.Td ta="right">{l.unitSell.toFixed(4)}</Table.Td>
                  <Table.Td ta="right">{l.cost.toFixed(4)}</Table.Td><Table.Td ta="right">{l.sell.toFixed(4)}</Table.Td>
                </Table.Tr>
              ))}
              <Table.Tr fw={600}><Table.Td>Production</Table.Td><Table.Td /><Table.Td /><Table.Td /><Table.Td ta="right">{p.productionCost.toFixed(4)}</Table.Td><Table.Td ta="right">{p.productionSell.toFixed(4)}</Table.Td></Table.Tr>
              <Table.Tr fw={600}><Table.Td>Postage</Table.Td><Table.Td /><Table.Td /><Table.Td /><Table.Td ta="right">{p.postageCost.toFixed(4)}</Table.Td><Table.Td ta="right">{p.postageSell.toFixed(4)}</Table.Td></Table.Tr>
              <Table.Tr fw={700}><Table.Td>Total</Table.Td><Table.Td /><Table.Td /><Table.Td /><Table.Td ta="right">{p.totalCost.toFixed(4)}</Table.Td><Table.Td ta="right">{p.totalSell.toFixed(4)}</Table.Td></Table.Tr>
            </Table.Tbody>
          </Table>
        </Stack>
      )}
    </Modal>
  );
}
