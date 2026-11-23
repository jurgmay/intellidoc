import { useEffect, useState } from 'react';
import { Alert, Badge, Box, Button, Group, Loader, Paper, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconAlertCircle, IconChevronRight, IconSearch } from '@tabler/icons-react';
import { ApiError } from '../api/client';
import { ukDateTime } from '../dates';
import { BATCH_STATUSES, searchBatches, type BatchResult, type BatchRow } from '../api/batches';
import { listBatchMailpieces, listScopes, type SearchScope } from '../api/recipients';
import { Field, MailpieceCard } from './MailpieceCard';
import { MailpiecePriceModal } from './MailpiecePriceModal';
import { EMPTY_BATCH_FORM, getBatchSearchSession, saveBatchSearchSession, type BatchPieces } from './batchSearchSession';

const PAGE = 50;
const money = (n: number): string => `£${n.toFixed(2)}`;

/** Finds batches. Click a batch to show its mailpieces, and a mailpiece to show its letters. A search covers one account and the accounts below it. */
export function BatchesPage() {
  const [scopes, setScopes] = useState<SearchScope[] | null>(null);
  const kept = getBatchSearchSession();
  const [account, setAccount] = useState<string | null>(kept.account);
  const [form, setForm] = useState(kept.form);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<BatchResult | null>(kept.result);
  const [searchedAt, setSearchedAt] = useState<string | null>(kept.searchedAt);
  const [expanded, setExpanded] = useState<number[]>(kept.expanded);
  const [pieces, setPieces] = useState<Record<number, BatchPieces>>(kept.pieces);
  const [openPieces, setOpenPieces] = useState<number[]>(kept.openPieces);
  const [loading, setLoading] = useState<number[]>([]);
  const [pieceErrors, setPieceErrors] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [priceOf, setPriceOf] = useState<number | null>(null);

  // keep what is on the page, so it is still there after going to another page and coming back
  useEffect(() => { saveBatchSearchSession({ account, form, result, searchedAt, expanded, pieces, openPieces }); }, [account, form, result, searchedAt, expanded, pieces, openPieces]);
  useEffect(() => { listScopes().then((r) => setScopes(r.rows)).catch((e: Error) => setError(e.message)); }, []);
  const set = (k: keyof typeof EMPTY_BATCH_FORM) => (e: { currentTarget: { value: string } }) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, [k]: v })); };
  const forget = () => { setExpanded([]); setPieces({}); setOpenPieces([]); setPieceErrors({}); };

  /** Fetches the next page of a batch's mailpieces, within the account that was searched. */
  async function loadPieces(batchId: number, offset: number) {
    if (!result) return;
    setLoading((l) => [...l, batchId]);
    setPieceErrors((p) => { const { [batchId]: _gone, ...rest } = p; return rest; });
    try {
      const r = await listBatchMailpieces(result.scope.id, batchId, offset, PAGE);
      setPieces((p) => ({ ...p, [batchId]: { rows: [...(offset === 0 ? [] : p[batchId]?.rows ?? []), ...r.rows], more: r.truncated } }));
    } catch (err) { setPieceErrors((p) => ({ ...p, [batchId]: (err as Error).message })); }
    finally { setLoading((l) => l.filter((x) => x !== batchId)); }
  }

  function toggle(batchId: number) {
    const opening = !expanded.includes(batchId);
    setExpanded((e) => (opening ? [...e, batchId] : e.filter((x) => x !== batchId)));
    if (opening && !pieces[batchId]) void loadPieces(batchId, 0);
  }
  const togglePiece = (id: number) => setOpenPieces((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id]));

  async function submit(e: { preventDefault: () => void }) {
    e.preventDefault();
    setError(null); setErrors({});
    if (!account) { setErrors({ accountId: 'Choose the account to search in. A search covers that account and the accounts below it.' }); return; }
    setBusy(true);
    try { setResult(await searchBatches({ accountId: Number(account), ...form })); setSearchedAt(new Date().toISOString()); forget(); }
    catch (err) {
      setResult(null);
      if (err instanceof ApiError && err.fieldErrors) setErrors(err.fieldErrors); else setError((err as Error).message);
    } finally { setBusy(false); }
  }

  const band = (b: BatchRow) => {
    const open = expanded.includes(b.batchId);
    return (
      <Group role="button" tabIndex={0} aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} the mailpieces in batch ${b.batchCode}`} justify="space-between" align="flex-start" wrap="nowrap" p="sm" bg="var(--mantine-color-default-hover)"
        style={{ cursor: 'pointer', borderBottom: open ? '1px solid var(--mantine-color-default-border)' : undefined }}
        onClick={() => toggle(b.batchId)}
        onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(b.batchId); } }}>
        <IconChevronRight size={18} style={{ flex: 'none', marginTop: 4, transition: 'transform 150ms', transform: open ? 'rotate(90deg)' : undefined }} aria-hidden />
        <div style={{ minWidth: 0, flex: '1 1 14rem' }}>
          <Group gap="xs" wrap="nowrap"><Text fw={600}>Batch {b.batchCode}</Text><Badge size="xs" variant="light" color={b.status === 'Cancelled' ? 'red' : undefined}>{b.status}</Badge></Group>
          <Text size="sm" c="dimmed">{b.job}</Text>
        </div>
        <Group gap="xl" align="flex-start" wrap="wrap" style={{ flex: '3 1 28rem' }}>
          <Field label="Created">{ukDateTime(b.createdAt)}</Field>
          <Field label="Mailpieces">{b.mailpieces}{b.mailpiecesInBatch !== b.mailpieces && <Text size="xs" c="dimmed">of {b.mailpiecesInBatch} in the batch</Text>}{b.cancelled > 0 && <Text size="xs" c="red">{b.cancelled} cancelled</Text>}</Field>
          <Field label="Letters">{b.packs}</Field>
          <Field label="Pages">{b.pages}<Text size="xs" c="dimmed">{b.sheets} sheets</Text></Field>
          <Field label="Service">{b.service}<Text size="xs" c="dimmed">{b.envelope}</Text></Field>
          <Field label="Enclosing">{b.department}</Field>
          <Field label="Invoiced to">{b.invoicingName}{b.brand && <Text size="xs" c="dimmed">{b.brand}</Text>}</Field>
        </Group>
        <Field label="Price">{money(b.priceSell)}{b.unpriced > 0 && <Text size="xs" c="orange">{b.unpriced} not priced</Text>}</Field>
      </Group>
    );
  };

  return (
    <Stack>
      <Title order={2}>Batches</Title>
      <Paper withBorder p="md">
        <form onSubmit={submit}>
          <Stack>
            <Select label="Search in" description="The account you choose and every account below it." placeholder="Choose an account" searchable data={(scopes ?? []).map((s) => ({ value: String(s.id), label: s.label }))}
              value={account} onChange={setAccount} error={errors['accountId']} disabled={!scopes} withAsterisk />
            <Group grow align="flex-start">
              <TextInput label="Batch code" value={form.code} onChange={set('code')} error={errors['code']} />
              <Select label="Status" placeholder="Any" clearable data={[...BATCH_STATUSES]} value={form.status || null} onChange={(v) => setForm((f) => ({ ...f, status: v ?? '' }))} error={errors['status']} />
              <TextInput label="Job" description="Any part of the job name" value={form.job} onChange={set('job')} error={errors['job']} />
            </Group>
            <Group grow align="flex-start">
              <TextInput label="Created from" type="date" value={form.from} onChange={set('from')} error={errors['from']} />
              <TextInput label="Created to" type="date" value={form.to} onChange={set('to')} error={errors['to']} />
            </Group>
            {errors['limit'] && <Text c="red" size="sm">{errors['limit']}</Text>}
            <Group>
              <Button type="submit" leftSection={<IconSearch size={16} />} loading={busy}>Search</Button>
              <Button variant="default" onClick={() => { setForm(EMPTY_BATCH_FORM); setErrors({}); setResult(null); setSearchedAt(null); forget(); }}>Clear</Button>
            </Group>
          </Stack>
        </form>
      </Paper>

      {error && <Alert color="red" icon={<IconAlertCircle size={16} />}>{error}</Alert>}
      {!scopes && !error && <Loader size="sm" />}

      {result && (
        <Stack gap="xs">
          <Text size="sm" c="dimmed">
            {result.rows.length === 0 ? 'Nothing found' : `${result.rows.length} found`} in {result.scope.label} and below.
            {result.truncated && ' There are more than this. Narrow the search to see the rest.'}
            {searchedAt && <> Searched at {new Date(searchedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}; search again to refresh.</>}
          </Text>
          {result.rows.map((b) => {
            const open = expanded.includes(b.batchId);
            const got = pieces[b.batchId];
            return (
              <Paper key={b.batchId} withBorder data-testid="batch" aria-label={`Batch ${b.batchCode}`}>
                {band(b)}
                {open && (
                  <Stack gap="xs" p="sm">
                    {loading.includes(b.batchId) && !got && <Loader size="sm" aria-label="Loading mailpieces" />}
                    {pieceErrors[b.batchId] && <Alert color="red" icon={<IconAlertCircle size={16} />}>{pieceErrors[b.batchId]} <Button size="compact-xs" variant="subtle" onClick={() => loadPieces(b.batchId, got?.rows.length ?? 0)}>Try again</Button></Alert>}
                    {got && got.rows.length === 0 && <Text size="sm" c="dimmed">No mailpieces in this batch.</Text>}
                    {got?.rows.map((r) => <MailpieceCard key={r.mailpieceId} row={r} showSequence open={openPieces.includes(r.mailpieceId)} onToggle={() => togglePiece(r.mailpieceId)} onPrice={setPriceOf} />)}
                    {got?.more && <Box><Button variant="default" size="compact-sm" loading={loading.includes(b.batchId)} onClick={() => loadPieces(b.batchId, got.rows.length)}>Show more mailpieces</Button></Box>}
                  </Stack>
                )}
              </Paper>
            );
          })}
        </Stack>
      )}
      <MailpiecePriceModal mailpieceId={priceOf} onClose={() => setPriceOf(null)} />
    </Stack>
  );
}
