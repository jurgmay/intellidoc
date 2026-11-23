import { Alert, Paper, SimpleGrid, Stack, Table, Text } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import type { UsageReport } from '../api/reports';
import { gbp, nf, shortDay } from './reportFormat';

/** Bars for the days of the report. Plain HTML so it also prints. */
function Bars({ report }: { report: UsageReport }) {
  const peak = Math.max(1, ...report.days.map((d) => d.mailpieces));
  return (
    <div role="img" aria-label="Mailpieces per day" style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 140, borderBottom: '1px solid var(--mantine-color-gray-4)' }}>
      {report.days.map((d) => (
        <div key={d.day} title={`${shortDay(d.day)}: ${nf(d.mailpieces)} mailpieces`} style={{ flex: 1, minWidth: 2, background: 'var(--mantine-primary-color-filled)', height: `${(d.mailpieces / peak) * 100}%`, borderRadius: '2px 2px 0 0' }} />
      ))}
    </div>
  );
}

/** The usage report: what the customer is invoiced, in counts and amounts. */
export function UsageReportView({ report }: { report: UsageReport }) {
  return (
    <Stack>
      <SimpleGrid cols={{ base: 2, md: 3, lg: 6 }}>
        {([['Mailpieces', nf(report.totals.mailpieces)], ['Packs', nf(report.totals.packs)], ['Sheets', nf(report.totals.sheets)],
          ['Production', gbp(report.totals.productionSell)], ['Postage', gbp(report.totals.postageSell)], ['Total', gbp(report.totals.totalSell)]] as const).map(([l, v]) => (
          <Paper key={l} withBorder p="md"><Text size="sm" c="dimmed">{l}</Text><Text size="xl" fw={700}>{v}</Text></Paper>
        ))}
      </SimpleGrid>
      {report.totals.unpriced > 0 && (
        <Alert color="yellow" icon={<IconAlertCircle size={16} />} title="Some mail is not priced">
          {nf(report.totals.unpriced)} of {nf(report.totals.mailpieces)} mailpieces have no price, so they add nothing to the amounts. Use Price mail again once the price list is in place.
        </Alert>
      )}
      <Paper withBorder p="md"><Text fw={600} mb="xs">Mailpieces per day</Text><Bars report={report} /></Paper>
      <SimpleGrid cols={{ base: 1, lg: 2 }} style={{ alignItems: 'start' }}>
        <Table withTableBorder striped>
          <Table.Thead><Table.Tr><Table.Th>Day</Table.Th><Table.Th ta="right">Mailpieces</Table.Th><Table.Th ta="right">Packs</Table.Th><Table.Th ta="right">Sheets</Table.Th><Table.Th ta="right">Production</Table.Th><Table.Th ta="right">Postage</Table.Th><Table.Th ta="right">Total</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {report.days.filter((d) => d.mailpieces > 0).map((d) => <Table.Tr key={d.day}><Table.Td>{shortDay(d.day)}</Table.Td><Table.Td ta="right">{nf(d.mailpieces)}</Table.Td><Table.Td ta="right">{nf(d.packs)}</Table.Td><Table.Td ta="right">{nf(d.sheets)}</Table.Td><Table.Td ta="right">{gbp(d.productionSell)}</Table.Td><Table.Td ta="right">{gbp(d.postageSell)}</Table.Td><Table.Td ta="right">{gbp(d.totalSell)}</Table.Td></Table.Tr>)}
            {report.totals.mailpieces === 0 && <Table.Tr><Table.Td colSpan={7}><Text c="dimmed">Nothing was produced in this period.</Text></Table.Td></Table.Tr>}
          </Table.Tbody>
        </Table>
        <Stack>
          <Table withTableBorder striped>
            <Table.Thead><Table.Tr><Table.Th>Brand</Table.Th><Table.Th ta="right">Mailpieces</Table.Th><Table.Th ta="right">Packs</Table.Th><Table.Th ta="right">Sheets</Table.Th><Table.Th ta="right">Production</Table.Th><Table.Th ta="right">Postage</Table.Th><Table.Th ta="right">Total</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{report.brands.map((b) => <Table.Tr key={b.brand}><Table.Td>{b.brand}</Table.Td><Table.Td ta="right">{nf(b.mailpieces)}</Table.Td><Table.Td ta="right">{nf(b.packs)}</Table.Td><Table.Td ta="right">{nf(b.sheets)}</Table.Td><Table.Td ta="right">{gbp(b.productionSell)}</Table.Td><Table.Td ta="right">{gbp(b.postageSell)}</Table.Td><Table.Td ta="right">{gbp(b.totalSell)}</Table.Td></Table.Tr>)}</Table.Tbody>
          </Table>
          <Table withTableBorder striped>
            <Table.Thead><Table.Tr><Table.Th>Format</Table.Th><Table.Th>Service</Table.Th><Table.Th ta="right">Mailpieces</Table.Th><Table.Th ta="right">Total</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{report.postage.map((p) => <Table.Tr key={`${p.format}|${p.service}`}><Table.Td>{p.format}</Table.Td><Table.Td>{p.service}</Table.Td><Table.Td ta="right">{nf(p.mailpieces)}</Table.Td><Table.Td ta="right">{gbp(p.totalSell)}</Table.Td></Table.Tr>)}</Table.Tbody>
          </Table>
        </Stack>
      </SimpleGrid>
    </Stack>
  );
}
