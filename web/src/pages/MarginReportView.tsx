import { Alert, Paper, SimpleGrid, Stack, Table, Text } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import type { MarginCounts, MarginReport } from '../api/reports';
import { gbp, nf, shortDay } from './reportFormat';

const pct = (v: number | null): string => (v === null ? '–' : `${v.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
const negative = (v: number): string | undefined => (v < 0 ? 'red.7' : undefined);

const HEAD = ['Mailpieces', 'Sell', 'Cost', 'Margin', 'Margin %'];
const Heads = ({ first }: { first: string[] }) => <Table.Thead><Table.Tr>{first.map((h) => <Table.Th key={h}>{h}</Table.Th>)}{HEAD.map((h) => <Table.Th key={h} ta="right">{h}</Table.Th>)}</Table.Tr></Table.Thead>;
const Figures = ({ c }: { c: MarginCounts }) => (
  <>
    <Table.Td ta="right">{nf(c.mailpieces)}</Table.Td><Table.Td ta="right">{gbp(c.sell)}</Table.Td><Table.Td ta="right">{gbp(c.cost)}</Table.Td>
    <Table.Td ta="right" c={negative(c.margin)}>{gbp(c.margin)}</Table.Td><Table.Td ta="right" c={negative(c.margin)}>{pct(c.marginPct)}</Table.Td>
  </>
);

/** The margin report (internal): sell, cost and margin. */
export function MarginReportView({ report }: { report: MarginReport }) {
  const t = report.totals;
  return (
    <Stack>
      <SimpleGrid cols={{ base: 2, md: 4 }}>
        {([['Sell', gbp(t.sell), undefined], ['Cost', gbp(t.cost), undefined], ['Margin', gbp(t.margin), negative(t.margin)], ['Margin %', pct(t.marginPct), negative(t.margin)]] as const).map(([l, v, c]) => (
          <Paper key={l} withBorder p="md"><Text size="sm" c="dimmed">{l}</Text><Text size="xl" fw={700} c={c}>{v}</Text></Paper>
        ))}
      </SimpleGrid>
      {t.unpriced > 0 && (
        <Alert color="yellow" icon={<IconAlertCircle size={16} />} title="Some mail is not priced">
          {nf(t.unpriced)} of {nf(t.mailpieces)} mailpieces have no price, so they are in none of these amounts. Use Price mail again once the price list is in place.
        </Alert>
      )}
      <Table withTableBorder striped aria-label="Production and postage">
        <Heads first={['']} />
        <Table.Tbody>
          {([['Production', t.productionSell, t.productionCost], ['Postage', t.postageSell, t.postageCost]] as const).map(([label, sell, cost]) => (
            <Table.Tr key={label}>
              <Table.Td>{label}</Table.Td><Table.Td ta="right">–</Table.Td><Table.Td ta="right">{gbp(sell)}</Table.Td><Table.Td ta="right">{gbp(cost)}</Table.Td>
              <Table.Td ta="right" c={negative(sell - cost)}>{gbp(Math.round((sell - cost) * 1e4) / 1e4)}</Table.Td><Table.Td ta="right" c={negative(sell - cost)}>{pct(sell > 0 ? Math.round(((sell - cost) / sell) * 1000) / 10 : null)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <SimpleGrid cols={{ base: 1, lg: 2 }} style={{ alignItems: 'start' }}>
        <Table withTableBorder striped aria-label="By day">
          <Heads first={['Day']} />
          <Table.Tbody>
            {report.days.filter((d) => d.mailpieces > 0).map((d) => <Table.Tr key={d.day}><Table.Td>{shortDay(d.day)}</Table.Td><Figures c={d} /></Table.Tr>)}
            {t.mailpieces === 0 && <Table.Tr><Table.Td colSpan={6}><Text c="dimmed">Nothing was produced in this period.</Text></Table.Td></Table.Tr>}
          </Table.Tbody>
        </Table>
        <Stack>
          <Table withTableBorder striped aria-label="By brand">
            <Heads first={['Brand']} />
            <Table.Tbody>{report.brands.map((b) => <Table.Tr key={b.brand}><Table.Td>{b.brand}</Table.Td><Figures c={b} /></Table.Tr>)}</Table.Tbody>
          </Table>
          <Table withTableBorder striped aria-label="By postal format and service">
            <Heads first={['Format', 'Service']} />
            <Table.Tbody>{report.postage.map((p) => <Table.Tr key={`${p.format}|${p.service}`}><Table.Td>{p.format}</Table.Td><Table.Td>{p.service}</Table.Td><Figures c={p} /></Table.Tr>)}</Table.Tbody>
          </Table>
        </Stack>
      </SimpleGrid>
    </Stack>
  );
}
