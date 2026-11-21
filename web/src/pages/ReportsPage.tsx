import { useEffect, useState } from 'react';
import { Alert, Button, Group, Loader, Paper, Select, SimpleGrid, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconAlertCircle, IconFileTypePdf } from '@tabler/icons-react';
import { ApiError } from '../api/client';
import { getUsage, listInvoicingAccounts, usagePdfUrl, type InvoicingAccount, type UsageReport } from '../api/reports';

const iso = (d: Date): string => d.toISOString().slice(0, 10);
const nf = (v: number): string => v.toLocaleString('en-GB');
const shortDay = (d: string): string => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

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

/** Daily usage for one invoicing account: counts on screen, and the same report as a PDF. */
export function ReportsPage() {
  const today = new Date();
  const [accounts, setAccounts] = useState<InvoicingAccount[] | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [from, setFrom] = useState(iso(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(iso(today));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<UsageReport | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { listInvoicingAccounts().then((r) => setAccounts(r.rows)).catch((e: Error) => setError(e.message)); }, []);

  async function show(e: { preventDefault: () => void }) {
    e.preventDefault();
    setError(null); setErrors({});
    if (!account) { setErrors({ invoicingAccountId: 'Choose the invoicing account to report on.' }); return; }
    setBusy(true);
    try { setReport(await getUsage({ invoicingAccountId: Number(account), from, to })); }
    catch (err) { setReport(null); if (err instanceof ApiError && err.fieldErrors) setErrors(err.fieldErrors); else setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Stack>
      <Title order={2}>Usage report</Title>
      <Paper withBorder p="md">
        <form onSubmit={show}>
          <Group align="flex-end">
            <Select label="Invoicing account" placeholder="Choose an account" searchable style={{ flex: 1 }} data={(accounts ?? []).map((a) => ({ value: String(a.id), label: `${a.name} (${a.code})` }))}
              value={account} onChange={setAccount} error={errors['invoicingAccountId']} disabled={!accounts} withAsterisk />
            <TextInput label="From" type="date" value={from} onChange={(e) => setFrom(e.currentTarget.value)} error={errors['from']} />
            <TextInput label="To" type="date" value={to} onChange={(e) => setTo(e.currentTarget.value)} error={errors['to']} />
            <Button type="submit" loading={busy}>Show report</Button>
            <Button component="a" variant="default" leftSection={<IconFileTypePdf size={16} />} target="_blank" rel="noreferrer"
              href={account ? usagePdfUrl({ invoicingAccountId: Number(account), from, to }) : undefined} disabled={!account}>PDF</Button>
          </Group>
        </form>
        <Text size="xs" c="dimmed" mt="xs">Counted on the day the mailpieces were produced (UK time). Cancelled mailpieces and batches are left out.</Text>
      </Paper>

      {error && <Alert color="red" icon={<IconAlertCircle size={16} />}>{error}</Alert>}
      {!accounts && !error && <Loader size="sm" />}

      {report && (
        <Stack>
          <SimpleGrid cols={3}>
            {([['Mailpieces', report.totals.mailpieces], ['Packs', report.totals.packs], ['Sheets', report.totals.sheets]] as const).map(([l, v]) => (
              <Paper key={l} withBorder p="md"><Text size="sm" c="dimmed">{l}</Text><Text size="xl" fw={700}>{nf(v)}</Text></Paper>
            ))}
          </SimpleGrid>
          <Paper withBorder p="md"><Text fw={600} mb="xs">Mailpieces per day</Text><Bars report={report} /></Paper>
          <SimpleGrid cols={{ base: 1, lg: 2 }} style={{ alignItems: 'start' }}>
            <Table withTableBorder striped>
              <Table.Thead><Table.Tr><Table.Th>Day</Table.Th><Table.Th ta="right">Mailpieces</Table.Th><Table.Th ta="right">Packs</Table.Th><Table.Th ta="right">Sheets</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {report.days.filter((d) => d.mailpieces > 0).map((d) => <Table.Tr key={d.day}><Table.Td>{shortDay(d.day)}</Table.Td><Table.Td ta="right">{nf(d.mailpieces)}</Table.Td><Table.Td ta="right">{nf(d.packs)}</Table.Td><Table.Td ta="right">{nf(d.sheets)}</Table.Td></Table.Tr>)}
                {report.totals.mailpieces === 0 && <Table.Tr><Table.Td colSpan={4}><Text c="dimmed">Nothing was produced in this period.</Text></Table.Td></Table.Tr>}
              </Table.Tbody>
            </Table>
            <Stack>
              <Table withTableBorder striped>
                <Table.Thead><Table.Tr><Table.Th>Brand</Table.Th><Table.Th ta="right">Mailpieces</Table.Th><Table.Th ta="right">Packs</Table.Th><Table.Th ta="right">Sheets</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>{report.brands.map((b) => <Table.Tr key={b.brand}><Table.Td>{b.brand}</Table.Td><Table.Td ta="right">{nf(b.mailpieces)}</Table.Td><Table.Td ta="right">{nf(b.packs)}</Table.Td><Table.Td ta="right">{nf(b.sheets)}</Table.Td></Table.Tr>)}</Table.Tbody>
              </Table>
              <Table withTableBorder striped>
                <Table.Thead><Table.Tr><Table.Th>Format</Table.Th><Table.Th>Service</Table.Th><Table.Th ta="right">Mailpieces</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>{report.postage.map((p) => <Table.Tr key={`${p.format}|${p.service}`}><Table.Td>{p.format}</Table.Td><Table.Td>{p.service}</Table.Td><Table.Td ta="right">{nf(p.mailpieces)}</Table.Td></Table.Tr>)}</Table.Tbody>
              </Table>
            </Stack>
          </SimpleGrid>
        </Stack>
      )}
    </Stack>
  );
}
