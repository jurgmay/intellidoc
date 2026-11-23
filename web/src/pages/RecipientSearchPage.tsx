import { useEffect, useState } from 'react';
import { Alert, Badge, Box, Button, Group, Loader, Paper, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconAlertCircle, IconChevronRight, IconSearch } from '@tabler/icons-react';
import { ApiError } from '../api/client';
import { MailpiecePriceModal } from './MailpiecePriceModal';
import { EMPTY_FORM, getRecipientSearchSession, saveRecipientSearchSession } from './recipientSearchSession';
import { listScopes, searchRecipients, type RecipientResult, type SearchScope } from '../api/recipients';

const EMPTY = EMPTY_FORM;
const day = (iso: string): string => iso.slice(0, 10);
/** The address under the name, in one line: the lines after the addressee, then the postcode (unless the lines already end with it). */
const addressLine = (lines: string[], postcode: string): string => [...lines.slice(1), ...(postcode && !lines.includes(postcode) ? [postcode] : [])].join(', ');

/** A small labelled value in a mailpiece's header. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Text size="xs" c="dimmed">{label}</Text><div style={{ fontSize: 'var(--mantine-font-size-sm)' }}>{children}</div></div>;
}

/** Finds where a person's letters went. A search always covers one account and the accounts below it, never the whole system. */
export function RecipientSearchPage() {
  const [scopes, setScopes] = useState<SearchScope[] | null>(null);
  const kept = getRecipientSearchSession();
  const [account, setAccount] = useState<string | null>(kept.account);
  const [form, setForm] = useState(kept.form);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<RecipientResult | null>(kept.result);
  const [searchedAt, setSearchedAt] = useState<string | null>(kept.searchedAt);
  const [expanded, setExpanded] = useState<number[]>(kept.expanded);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [priceOf, setPriceOf] = useState<number | null>(null);

  // keep what is on the page, so it is still there after going to another page and coming back
  useEffect(() => { saveRecipientSearchSession({ account, form, result, searchedAt, expanded }); }, [account, form, result, searchedAt, expanded]);
  useEffect(() => { listScopes().then((r) => setScopes(r.rows)).catch((e: Error) => setError(e.message)); }, []);
  const set = (k: keyof typeof EMPTY) => (e: { currentTarget: { value: string } }) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, [k]: v })); };

  const toggle = (id: number) => setExpanded((e) => (e.includes(id) ? e.filter((x) => x !== id) : [...e, id]));

  async function submit(e: { preventDefault: () => void }) {
    e.preventDefault();
    setError(null); setErrors({});
    if (!account) { setErrors({ accountId: 'Choose the account to search in. A search covers that account and the accounts below it.' }); return; }
    setBusy(true);
    try { setResult(await searchRecipients({ accountId: Number(account), ...form })); setSearchedAt(new Date().toISOString()); setExpanded([]); }
    catch (err) {
      setResult(null);
      if (err instanceof ApiError && err.fieldErrors) setErrors(err.fieldErrors); else setError((err as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <Stack>
      <Title order={2}>Recipient search</Title>
      <Paper withBorder p="md">
        <form onSubmit={submit}>
          <Stack>
            <Select label="Search in" description="The account you choose and every account below it." placeholder="Choose an account" searchable data={(scopes ?? []).map((s) => ({ value: String(s.id), label: s.label }))}
              value={account} onChange={setAccount} error={errors['accountId']} disabled={!scopes} withAsterisk />
            <Group grow align="flex-start">
              <TextInput label="Name" description="Any part of the addressee" value={form.name} onChange={set('name')} error={errors['name']} />
              <TextInput label="Address" description="Any part of an address line or the postcode" value={form.address} onChange={set('address')} error={errors['address']} />
            </Group>
            <Group grow align="flex-start">
              <TextInput label="Reference" description="Exact, or start it and end with *" value={form.reference} onChange={set('reference')} error={errors['reference']} />
              <TextInput label="Reference name" description="Optional, e.g. Tenant Reference" value={form.referenceKey} onChange={set('referenceKey')} />
              <TextInput label="Released from" type="date" value={form.from} onChange={set('from')} error={errors['from']} />
              <TextInput label="Released to" type="date" value={form.to} onChange={set('to')} error={errors['to']} />
            </Group>
            {errors['limit'] && <Text c="red" size="sm">{errors['limit']}</Text>}
            <Group>
              <Button type="submit" leftSection={<IconSearch size={16} />} loading={busy}>Search</Button>
              <Button variant="default" onClick={() => { setForm(EMPTY); setErrors({}); setResult(null); setSearchedAt(null); setExpanded([]); }}>Clear</Button>
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
          {result.rows.map((r) => {
            const open = expanded.includes(r.mailpieceId);
            const who = r.addressLines[0] ?? 'this recipient';
            return (
            <Paper key={r.mailpieceId} withBorder data-testid="mailpiece" aria-label={`Mailpiece to ${who}`}>
              {/* the mailpiece: what is the same for every letter in the envelope. Click it to show or hide the letters. */}
              <Group role="button" tabIndex={0} aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} the letters for ${who}`} justify="space-between" align="flex-start" wrap="nowrap" p="sm" bg="var(--mantine-color-default-hover)"
                style={{ cursor: 'pointer', borderBottom: open ? '1px solid var(--mantine-color-default-border)' : undefined }}
                onClick={() => toggle(r.mailpieceId)}
                onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle(r.mailpieceId); } }}>
                <IconChevronRight size={18} style={{ flex: 'none', marginTop: 4, transition: 'transform 150ms', transform: open ? 'rotate(90deg)' : undefined }} aria-hidden />
                <div style={{ minWidth: 0, flex: '1 1 18rem' }}>
                  <Group gap="xs" wrap="nowrap"><Text fw={600}>{r.addressLines[0]}</Text>{r.isCancelled && <Badge size="xs" color="red" variant="light">Cancelled</Badge>}</Group>
                  <Text size="sm" c="dimmed">{addressLine(r.addressLines, r.postcode)}</Text>
                </div>
                <Group gap="xl" align="flex-start" wrap="wrap" style={{ flex: '2 1 24rem' }}>
                  <Field label="Letters">{r.packs.length}</Field>
                  <Field label="Released">{day(r.releaseDate)}</Field>
                  <Field label="Job">{r.job}</Field>
                  <Field label="Batch">{r.batchCode !== null ? <Group gap={6}><span>{r.batchCode}</span><Badge size="xs" variant="light">{r.batchStatus}</Badge></Group> : <Text size="sm" c="dimmed">Not in a batch</Text>}</Field>
                  <Field label="Sent from">{r.accountPath}{r.brand && <Text size="xs" c="dimmed">{r.brand}</Text>}</Field>
                  <Field label="Invoiced to">{r.invoicingName ?? '–'}</Field>
                </Group>
                <Button size="compact-sm" variant="light" aria-label={`Price of the mailpiece to ${r.addressLines[0] ?? 'this recipient'}`} onClick={(e) => { e.stopPropagation(); setPriceOf(r.mailpieceId); }}>{r.priceSell == null ? 'Not priced' : `£${r.priceSell.toFixed(2)}`}</Button>
              </Group>
              {/* the letters in the envelope, in the order they go in: what is specific to each */}
              {open && <Box p="sm">
                <Table withTableBorder withColumnBorders aria-label="Letters in the envelope">
                  <Table.Thead>
                    <Table.Tr><Table.Th w={70}>Letter</Table.Th><Table.Th w={110}>Sequence</Table.Th><Table.Th w={130}>Pages</Table.Th><Table.Th w={110}>Released</Table.Th><Table.Th>Fields</Table.Th></Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {r.packs.map((k) => (
                      <Table.Tr key={k.packId} data-testid="pack">
                        <Table.Td><Badge size="sm" variant="outline" aria-label={`Letter ${k.position}`}>{k.position}</Badge></Table.Td>
                        <Table.Td>{k.sequence === null ? <Text size="sm" c="dimmed">Not in the sequence</Text> : k.sequence}</Table.Td>
                        <Table.Td>{k.pageCount} {k.pageCount === 1 ? 'page' : 'pages'}<Text size="xs" c="dimmed">from page {k.startPage}</Text></Table.Td>
                        <Table.Td>{day(k.releaseDate)}</Table.Td>
                        <Table.Td>{Object.keys(k.references).length === 0 ? <Text size="sm" c="dimmed">None</Text> : Object.entries(k.references).map(([key, v]) => <div key={key}><Text span size="xs" c="dimmed">{key}: </Text>{v}</div>)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Box>}
            </Paper>
            );
          })}
        </Stack>
      )}
      <MailpiecePriceModal mailpieceId={priceOf} onClose={() => setPriceOf(null)} />
    </Stack>
  );
}
