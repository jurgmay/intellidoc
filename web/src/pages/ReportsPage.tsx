import { useEffect, useState } from 'react';
import { Alert, Button, Group, Loader, Paper, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconAlertCircle, IconFileTypePdf } from '@tabler/icons-react';
import { ApiError } from '../api/client';
import { getMargin, getUsage, listInvoicingAccounts, usagePdfUrl, type InvoicingAccount, type MarginReport, type UsageReport } from '../api/reports';
import { MarginReportView } from './MarginReportView';
import { UsageReportView } from './UsageReportView';
import { iso } from './reportFormat';

type Kind = 'usage' | 'margin';
const KINDS = [{ value: 'usage', label: 'Usage report' }, { value: 'margin', label: 'Margin report' }];
const NOTES: Record<Kind, string> = {
  usage: 'Counted on the day the mailpieces were produced (UK time). Cancelled mailpieces and batches are left out. Amounts are the sell price (excluding VAT) of production and postage, as priced when the mail was produced.',
  margin: 'Internal: shows costs, screen only. Sell is what would be invoiced (excluding VAT); margin is sell minus cost. Counted on the day the mailpieces were produced (UK time), at the prices when they were produced. Cancelled mail is left out.',
};

/** The reports for one invoicing account over a period. The same form drives each report; choose which one. Usage can also be a PDF; margin is internal and screen only. */
export function ReportsPage() {
  const today = new Date();
  const [kind, setKind] = useState<Kind>('usage');
  const [accounts, setAccounts] = useState<InvoicingAccount[] | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [from, setFrom] = useState(iso(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [to, setTo] = useState(iso(today));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<{ kind: 'usage'; report: UsageReport } | { kind: 'margin'; report: MarginReport } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { listInvoicingAccounts().then((r) => setAccounts(r.rows)).catch((e: Error) => setError(e.message)); }, []);

  async function show(e: { preventDefault: () => void }) {
    e.preventDefault();
    setError(null); setErrors({});
    if (!account) { setErrors({ invoicingAccountId: 'Choose the invoicing account to report on.' }); return; }
    setBusy(true);
    const q = { invoicingAccountId: Number(account), from, to };
    try { setShown(kind === 'usage' ? { kind, report: await getUsage(q) } : { kind, report: await getMargin(q) }); }
    catch (err) { setShown(null); if (err instanceof ApiError && err.fieldErrors) setErrors(err.fieldErrors); else setError((err as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Stack>
      <Title order={2}>Reports</Title>
      <Paper withBorder p="md">
        <form onSubmit={show}>
          <Group align="flex-end">
            <Select label="Report" allowDeselect={false} data={KINDS} value={kind} onChange={(v) => { setKind((v as Kind) ?? 'usage'); setShown(null); setErrors({}); }} w={180} />
            <Select label="Invoicing account" placeholder="Choose an account" searchable style={{ flex: 1 }} data={(accounts ?? []).map((a) => ({ value: String(a.id), label: `${a.name} (${a.code})` }))}
              value={account} onChange={setAccount} error={errors['invoicingAccountId']} disabled={!accounts} withAsterisk />
            <TextInput label="From" type="date" value={from} onChange={(e) => setFrom(e.currentTarget.value)} error={errors['from']} />
            <TextInput label="To" type="date" value={to} onChange={(e) => setTo(e.currentTarget.value)} error={errors['to']} />
            <Button type="submit" loading={busy}>Show report</Button>
            {kind === 'usage' && <Button component="a" variant="default" leftSection={<IconFileTypePdf size={16} />} target="_blank" rel="noreferrer"
              href={account ? usagePdfUrl({ invoicingAccountId: Number(account), from, to }) : undefined} disabled={!account}>PDF</Button>}
          </Group>
        </form>
        <Text size="xs" c="dimmed" mt="xs">{NOTES[kind]}</Text>
      </Paper>

      {error && <Alert color="red" icon={<IconAlertCircle size={16} />}>{error}</Alert>}
      {!accounts && !error && <Loader size="sm" />}

      {shown?.kind === 'usage' && <UsageReportView report={shown.report} />}
      {shown?.kind === 'margin' && <MarginReportView report={shown.report} />}
    </Stack>
  );
}
