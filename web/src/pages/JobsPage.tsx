import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Group, Loader, Modal, Paper, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle } from '@tabler/icons-react';
import { composeJob, emailRunSheets, getJob, JOB_STATUSES, listJobs, runSheetsUrl, type JobDetail, type JobRow, type RunSheetEmail } from '../api/jobs';

const STATUS_COLOUR: Record<string, string> = { Received: 'green', 'Awaiting PDF': 'yellow', 'PDF Rejected': 'red' };
const when = (iso: string): string => new Date(iso).toLocaleString('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Who the run sheets went to, for a notification. */
export function emailSummary(r: RunSheetEmail): string {
  return `${r.testMode ? 'Test mode: ' : ''}${[...r.to, ...r.cc].join(', ')}`;
}

/** The notification for the e-mail sent as the print files were made, or null when none was attempted. */
function batches_email(res: { runSheetEmail: RunSheetEmail | null }): { color: string; title: string; message: string; autoClose?: false } | null {
  const r = res.runSheetEmail;
  if (!r) return null;
  return r.sent ? { color: 'green', title: 'Run sheets e-mailed', message: emailSummary(r) } : { color: 'orange', title: 'Run sheets not e-mailed', message: r.error ?? 'Unknown problem', autoClose: false };
}

/** What a job's print files look like in the list: none yet, all made, or some. */
export function printFilesLabel(j: JobRow): string {
  if (j.batchCount === 0) return 'No batches';
  if (j.composedBatchCount === 0) return 'Not made';
  return j.composedBatchCount === j.batchCount ? `Made (${plural(j.batchCount, 'batch', 'batches')})` : `${j.composedBatchCount} of ${plural(j.batchCount, 'batch', 'batches')}`;
}

/** Jobs received from the customers' exports, and the button that makes their print files. */
export function JobsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [rows, setRows] = useState<JobRow[] | null>(null);
  const [can, setCan] = useState<{ ok: boolean; why: string | null }>({ ok: true, why: null });
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState<number | null>(null);
  const [open, setOpen] = useState<JobDetail | null>(null);
  const [confirm, setConfirm] = useState<JobRow | null>(null);

  const load = useCallback(async () => {
    try { const r = await listJobs(search, status); setRows(r.rows); setCan({ ok: r.canCompose, why: r.composeUnavailable }); setError(null); }
    catch (e) { setError((e as Error).message); }
  }, [search, status]);
  useEffect(() => { const t = setTimeout(() => { void load(); }, 250); return () => clearTimeout(t); }, [load]);

  async function make(j: JobRow, onlyNew: boolean) {
    setConfirm(null); setWorking(j.id);
    try {
      const res = await composeJob(j.id, onlyNew); const { batches } = res;
      const made = batches.filter((b) => b.files.length > 0);
      notifications.show({ color: 'green', title: `Print files made for job ${j.id}`, message: `${plural(made.length, 'batch', 'batches')}, ${plural(made.flatMap((b) => b.files).length, 'file', 'files')}${batches.some((b) => b.skipped) ? `; ${batches.filter((b) => b.skipped).length} left alone` : ''}.` });
      if (batches_email(res)) notifications.show(batches_email(res)!);
      await load();
      if (open?.id === j.id) setOpen(await getJob(j.id));
    } catch (e) { notifications.show({ color: 'red', title: 'Print files not made', message: (e as Error).message, autoClose: false }); }
    finally { setWorking(null); }
  }

  async function sendRunSheets(j: JobRow) {
    setWorking(j.id);
    try {
      const r = await emailRunSheets(j.id);
      notifications.show({ color: 'green', title: `Run sheets e-mailed for job ${j.id}`, message: emailSummary(r) });
      await load();
      if (open?.id === j.id) setOpen(await getJob(j.id));
    } catch (e) { notifications.show({ color: 'red', title: 'Run sheets not e-mailed', message: (e as Error).message, autoClose: false }); }
    finally { setWorking(null); }
  }

  async function show(j: JobRow) {
    try { setOpen(await getJob(j.id)); } catch (e) { notifications.show({ color: 'red', message: (e as Error).message }); }
  }

  return (
    <Stack>
      <Title order={2}>Jobs</Title>
      <Paper withBorder p="md">
        <Group align="flex-end">
          <TextInput label="Search" placeholder="Customer or file name" style={{ flex: 1 }} value={search} onChange={(e) => setSearch(e.currentTarget.value)} />
          <Select label="Status" placeholder="All" clearable data={JOB_STATUSES} value={status} onChange={setStatus} w={200} />
        </Group>
        <Text size="xs" c="dimmed" mt="xs">The newest 100 jobs. Print files are made automatically when that is switched on in Settings; use the button to make them now, or to make them again after a change to the customer.</Text>
      </Paper>
      {error && <Alert color="red" icon={<IconAlertCircle size={16} />}>{error}</Alert>}
      {!can.ok && <Alert color="yellow" icon={<IconAlertCircle size={16} />} title="Print files cannot be made from here">{can.why}</Alert>}
      {!rows && !error && <Loader size="sm" />}
      {rows && (
        <Table withTableBorder highlightOnHover>
          <Table.Thead><Table.Tr>
            <Table.Th ta="center">Job</Table.Th><Table.Th>Customer</Table.Th><Table.Th>File</Table.Th><Table.Th>Received</Table.Th><Table.Th>Status</Table.Th>
            <Table.Th ta="right">Packs</Table.Th><Table.Th ta="right">Pages</Table.Th><Table.Th>Print files</Table.Th><Table.Th />
          </Table.Tr></Table.Thead>
          <Table.Tbody>
            {rows.map((j) => (
              <Table.Tr key={j.id}>
                <Table.Td ta="center">{j.id}</Table.Td>
                <Table.Td>{j.customerName} <Text span c="dimmed" size="xs">({j.customerCode})</Text></Table.Td>
                <Table.Td>{j.pdfFileName}</Table.Td>
                <Table.Td>{when(j.receivedAt)}</Table.Td>
                <Table.Td><Badge color={STATUS_COLOUR[j.status] ?? 'gray'} variant="light" title={j.pdfError ?? undefined}>{j.status}</Badge></Table.Td>
                <Table.Td ta="right">{j.packCount ?? ''}</Table.Td>
                <Table.Td ta="right">{j.pageCount ?? ''}</Table.Td>
                <Table.Td>{printFilesLabel(j)}</Table.Td>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap" justify="flex-end">
                    <Button size="xs" variant="subtle" onClick={() => { void show(j); }}>Details</Button>
                    {j.status === 'Received' && j.batchCount > 0 && (
                      <Button size="xs" loading={working === j.id} disabled={!can.ok || working !== null} variant={j.composedBatchCount === 0 ? 'filled' : 'default'}
                        onClick={() => (j.composedBatchCount === 0 ? void make(j, false) : setConfirm(j))}>
                        {j.composedBatchCount === 0 ? 'Make print files' : 'Make again'}
                      </Button>
                    )}
                  </Group>
                </Table.Td>
              </Table.Tr>
            ))}
            {rows.length === 0 && <Table.Tr><Table.Td colSpan={9}><Text c="dimmed" ta="center">No jobs match.</Text></Table.Td></Table.Tr>}
          </Table.Tbody>
        </Table>
      )}

      <Modal opened={confirm !== null} onClose={() => setConfirm(null)} title={`Make the print files for job ${confirm?.id} again?`}>
        <Stack>
          <Text size="sm">This replaces the print files already made for every batch of this job that is still Created. Batches that have moved on (printed or later) are left alone. Mailpiece sequence numbers already given do not change.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirm(null)}>Cancel</Button>
            {confirm && confirm.composedBatchCount < confirm.batchCount && <Button variant="default" onClick={() => { void make(confirm, true); }}>Only the batches without files</Button>}
            <Button onClick={() => { if (confirm) void make(confirm, false); }}>Make them again</Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={open !== null} onClose={() => setOpen(null)} size="lg" title={open ? `Job ${open.id}: ${open.pdfFileName}` : ''}>
        {open && (
          <Stack>
            <Text size="sm">{open.customerName} ({open.customerCode}), received {when(open.receivedAt)}. Status: {open.status}.</Text>
            {open.batchCount > 0 && (
              <Group justify="space-between">
                <Text size="sm">{open.runSheetsEmailedAt ? `Run sheets e-mailed ${when(open.runSheetsEmailedAt)}.` : 'Run sheets not e-mailed yet.'}</Text>
                <Group gap="xs">
                  <Button component="a" href={runSheetsUrl(open.id)} size="xs" variant="default">Download run sheets</Button>
                  <Button size="xs" variant="default" loading={working === open.id} disabled={working !== null} onClick={() => { void sendRunSheets(open); }}>
                    {open.runSheetsEmailedAt ? 'Resend run sheets' : 'E-mail run sheets'}
                  </Button>
                </Group>
              </Group>
            )}
            {open.pdfError && <Alert color="red" icon={<IconAlertCircle size={16} />}>{open.pdfError}</Alert>}
            <Table withTableBorder>
              <Table.Thead><Table.Tr><Table.Th ta="center">Batch</Table.Th><Table.Th>Status</Table.Th><Table.Th ta="right">Mailpieces</Table.Th><Table.Th>Print files</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>
                {open.batches.map((b) => (
                  <Table.Tr key={b.id}>
                    <Table.Td ta="center">{b.batchCode}</Table.Td><Table.Td>{b.status}</Table.Td><Table.Td ta="right">{b.mailpieceCount}</Table.Td>
                    <Table.Td>{b.files.length === 0 ? <Text span c="dimmed">None yet</Text> : b.files.map((f) => <div key={f.fileName}>{f.fileName} <Text span c="dimmed" size="xs">({plural(f.mailpieces, 'mailpiece', 'mailpieces')}, {plural(f.pages, 'page', 'pages')})</Text></div>)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
