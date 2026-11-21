import { useEffect, useState } from 'react';
import { Alert, Badge, Button, Group, Loader, Paper, Select, Stack, Table, Text, TextInput, Title } from '@mantine/core';
import { IconAlertCircle, IconSearch } from '@tabler/icons-react';
import { ApiError } from '../api/client';
import { MailpiecePriceModal } from './MailpiecePriceModal';
import { listScopes, searchRecipients, type RecipientResult, type SearchScope } from '../api/recipients';

const EMPTY = { name: '', address: '', reference: '', referenceKey: '', from: '', to: '' };
const day = (iso: string): string => iso.slice(0, 10);

/** Finds where a person's letters went. A search always covers one account and the accounts below it, never the whole system. */
export function RecipientSearchPage() {
  const [scopes, setScopes] = useState<SearchScope[] | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<RecipientResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [priceOf, setPriceOf] = useState<number | null>(null);

  useEffect(() => { listScopes().then((r) => setScopes(r.rows)).catch((e: Error) => setError(e.message)); }, []);
  const set = (k: keyof typeof EMPTY) => (e: { currentTarget: { value: string } }) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, [k]: v })); };

  async function submit(e: { preventDefault: () => void }) {
    e.preventDefault();
    setError(null); setErrors({});
    if (!account) { setErrors({ accountId: 'Choose the account to search in. A search covers that account and the accounts below it.' }); return; }
    setBusy(true);
    try { setResult(await searchRecipients({ accountId: Number(account), ...form })); }
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
              <Button variant="default" onClick={() => { setForm(EMPTY); setErrors({}); setResult(null); }}>Clear</Button>
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
          </Text>
          {result.rows.length > 0 && (
            <Table striped withTableBorder>
              <Table.Thead>
                <Table.Tr><Table.Th>Recipient</Table.Th><Table.Th>Sent from</Table.Th><Table.Th>Invoiced to</Table.Th><Table.Th>Released</Table.Th><Table.Th>Batch</Table.Th><Table.Th>References</Table.Th><Table.Th ta="right">Price</Table.Th></Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {result.rows.map((r) => (
                  <Table.Tr key={r.packId}>
                    <Table.Td>{r.addressLines.map((l, i) => <div key={i} style={i === 0 ? { fontWeight: 600 } : undefined}>{l}</div>)}{r.postcode && !r.addressLines.includes(r.postcode) && <div>{r.postcode}</div>}</Table.Td>
                    <Table.Td><div>{r.accountPath}</div>{r.brand && <Text size="xs" c="dimmed">{r.brand}</Text>}</Table.Td>
                    <Table.Td>{r.invoicingName ?? '–'}</Table.Td>
                    <Table.Td>{day(r.releaseDate)}<Text size="xs" c="dimmed">{r.job}</Text></Table.Td>
                    <Table.Td>{r.batchCode !== null ? <><div>{r.batchCode}</div><Badge size="xs" variant="light">{r.batchStatus}</Badge></> : <Text size="xs" c="dimmed">Not in a batch</Text>}</Table.Td>
                    <Table.Td>{Object.entries(r.references).map(([k, v]) => <div key={k}><Text span size="xs" c="dimmed">{k}: </Text>{v}</div>)}</Table.Td>
                    <Table.Td ta="right">{r.mailpieceId === null ? <Text size="xs" c="dimmed">–</Text>
                      : <Button size="compact-sm" variant="subtle" aria-label={`Price of the mailpiece to ${r.addressLines[0] ?? 'this recipient'}`} onClick={() => setPriceOf(r.mailpieceId)}>{r.priceSell == null ? 'Not priced' : `£${r.priceSell.toFixed(2)}`}</Button>}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Stack>
      )}
      <MailpiecePriceModal mailpieceId={priceOf} onClose={() => setPriceOf(null)} />
    </Stack>
  );
}
