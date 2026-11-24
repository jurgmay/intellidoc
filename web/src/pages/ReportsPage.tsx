import { useIsAdmin } from '../auth';
import { useEffect, useState } from 'react';
import { Alert, Button, Group, Loader, Paper, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconAlertCircle, IconFileTypePdf } from '@tabler/icons-react';
import { ApiError } from '../api/client';
import { getMargin, getUsage, listInvoicingAccounts, marginPdfUrl, usagePdfUrl, type InvoicingAccount, type MarginReport, type UsageReport } from '../api/reports';
import { MarginReportView } from './MarginReportView';
import { AuditReportPanel } from './AuditReportPanel';
import { UsageReportView } from './UsageReportView';
import { iso } from './reportFormat';

type Kind = 'usage' | 'margin' | 'audit';
const KINDS = [{ value: 'usage', label: 'Usage report' }, { value: 'margin', label: 'Margin report' }, { value: 'audit', label: 'Mailpiece audit report' }];
const NOTES: Record<Kind, string> = {
  usage: 'Counted on the day the mailpieces were produced (UK time). Cancelled mailpieces and batches are left out. Amounts are the sell price (excluding VAT) of production and postage, as priced when the mail was produced.',
  audit: '',
  margin: 'Internal: shows costs, so do not send it to the customer. Sell is what would be invoiced (excluding VAT); margin is sell minus cost. Counted on the day the mailpieces were produced (UK time), at the prices when they were produced. Cancelled mail is left out.',
};

/** The reports for one invoicing account over a period. The same form drives each report; choose which one. Either can also be a PDF; the margin report is internal (it shows costs). */
export function ReportsPage() {
  const today = new Date();
  const isAdmin = useIsAdmin();
  const kinds = isAdmin ? KINDS : KINDS.filter((k) => k.value !== 'margin');   // the margin report shows costs
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
    try { setShown(kind === 'usage' ? { kind: 'usage', report: await getUsage(q) } : { kind: 'margin', report: await getMargin(q) }); }
    catch (err) { setShown(null); if (err instanceof ApiError && err.fieldErrors) setErrors(err.fieldErrors); else setError((err as Error).message); }
    finally { setBusy(false); }
  }

  const kindSelect = <Select label="Report" allowDeselect={false} data={kinds} value={kind} onChange={(v) => { setKind((v as Kind) ?? 'usage'); setShown(null); setErrors({}); }} w={220} />;
  if (kind === 'audit') return <Stack><Title order={2}>Reports</Title><AuditReportPanel header={kindSelect} /></Stack>;
  return (
    <Stack>
      <Title order={2}>Reports</Title>
      <Paper withBorder p="md">
        <form onSubmit={show}>
          <Group align="flex-end">
            {kindSelect}
            <Select label="Invoicing account" placeholder="Choose an account" searchable style={{ flex: 1 }} data={(accounts ?? []).map((a) => ({ value: String(a.id), label: `${a.name} (${a.code})` }))}
              value={account} onChange={setAccount} error={errors['invoicingAccountId']} disabled={!accounts} withAsterisk />
            <TextInput label="From" type="date" value={from} onChange={(e) => setFrom(e.currentTarget.value)} error={errors['from']} />
            <TextInput label="To" type="date" value={to} onChange={(e) => setTo(e.currentTarget.value)} error={errors['to']} />
            <Button type="submit" loading={busy}>Show report</Button>
            <Button component="a" variant="default" leftSection={<IconFileTypePdf size={16} />} target="_blank" rel="noreferrer"
              href={account ? (kind === 'usage' ? usagePdfUrl : marginPdfUrl)({ invoicingAccountId: Number(account), from, to }) : undefined} disabled={!account}>PDF</Button>
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
