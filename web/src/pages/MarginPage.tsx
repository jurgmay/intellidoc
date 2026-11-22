import { useEffect, useState } from 'react';
import { Alert, Button, Group, Loader, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { ApiError } from '../api/client';
import { getMargin, listInvoicingAccounts, type InvoicingAccount, type MarginCounts, type MarginReport } from '../api/reports';

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const nf = (v: number): string => v.toLocaleString('en-GB');
const gbp = (v: number): string => v.toLocaleString('en-GB', { style: 'currency', currency: 'GBP' });
const pct = (v: number | null): string => (v === null ? '–' : `${v.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`);
const shortDay = (d: string): string => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const negative = (v: number): string | undefined => (v < 0 ? 'red.7' : undefined);

const HEAD = ['Mailpieces', 'Sell', 'Cost', 'Margin', 'Margin %'];
const Heads = ({ first }: { first: string[] }) => <Table.Thead><Table.Tr>{first.map((h) => <Table.Th key={h}>{h}</Table.Th>)}{HEAD.map((h) => <Table.Th key={h} ta="right">{h}</Table.Th>)}</Table.Tr></Table.Thead>;
const Figures = ({ c }: { c: MarginCounts }) => (
  <>
    <Table.Td ta="right">{nf(c.mailpieces)}</Table.Td><Table.Td ta="right">{gbp(c.sell)}</Table.Td><Table.Td ta="right">{gbp(c.cost)}</Table.Td>
    <Table.Td ta="right" c={negative(c.margin)}>{gbp(c.margin)}</Table.Td><Table.Td ta="right" c={negative(c.margin)}>{pct(c.marginPct)}</Table.Td>
  </>
);

/** Internal: what the mail would be invoiced at, what it cost and the margin, for one invoicing account. Screen only; it has no PDF, so costs do not travel with the customer's usage report. */
export function MarginPage() {
  const today = new Date();
  const [accounts, setAccounts] = useState<InvoicingAccount[] | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [from, setFrom] = useState(iso(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(iso(today));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<MarginReport | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { listInvoicingAccounts().then((r) => setAccounts(r.rows)).catch((e: Error) => setError(e.message)); }, []);

  async function show(e: { preventDefault: () => void }) {
    e.preventDefault();
    setError(null); setErrors({});
    if (!account) { setErrors({ invoicingAccountId: 'Choose the invoicing account to report on.' }); return; }
    setBusy(true);
    try { setReport(await getMargin({ invoicingAccountId: Number(account), from, to })); }
    catch (err) { setReport(null); if (err instanceof ApiError && err.fieldErrors) setErrors(err.fieldErrors); else setError((err as Error).message); }
    finally { setBusy(false); }
  }

  const t = report?.totals;
  return (
    <Stack>
      <Title order={2}>Margin report</Title>
      <Paper withBorder p="md">
        <form onSubmit={show}>
          <Group align="flex-end">
            <Select label="Invoicing account" placeholder="Choose an account" searchable style={{ flex: 1 }} data={(accounts ?? []).map((a) => ({ value: String(a.id), label: `${a.name} (${a.code})` }))}
              value={account} onChange={setAccount} error={errors['invoicingAccountId']} disabled={!accounts} withAsterisk />
            <TextInput label="From" type="date" value={from} onChange={(e) => setFrom(e.currentTarget.value)} error={errors['from']} />
            <TextInput label="To" type="date" value={to} onChange={(e) => setTo(e.currentTarget.value)} error={errors['to']} />
            <Button type="submit" loading={busy}>Show report</Button>
          </Group>
        </form>
        <Text size="xs" c="dimmed" mt="xs">Internal: shows costs. Sell is what would be invoiced (excluding VAT); margin is sell minus cost. Counted on the day the mailpieces were produced (UK time), at the prices when they were produced. Cancelled mail is left out.</Text>
      </Paper>

      {error && <Alert color="red" icon={<IconAlertCircle size={16} />}>{error}</Alert>}
      {!accounts && !error && <Loader size="sm" />}

      {report && t && (
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
      )}
    </Stack>
  );
}
