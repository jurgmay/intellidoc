import { useEffect, useState } from 'react';
import { Alert, Button, Group, Loader, Paper, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconAlertCircle, IconSearch } from '@tabler/icons-react';
import { ApiError } from '../api/client';
import { MailpieceCard } from './MailpieceCard';
import { MailpiecePriceModal } from './MailpiecePriceModal';
import { EMPTY_FORM, getRecipientSearchSession, saveRecipientSearchSession } from './recipientSearchSession';
import { listScopes, searchRecipients, type RecipientResult, type SearchScope } from '../api/recipients';

const EMPTY = EMPTY_FORM;
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
      <Title order={2}>Mailpieces</Title>
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
              <TextInput label="Job GUID" description="The H-POD job the letter came from" value={form.jobGuid} onChange={set('jobGuid')} error={errors['jobGuid']} />
              <TextInput label="Pack GUID" description="The GUID of one letter" value={form.packGuid} onChange={set('packGuid')} error={errors['packGuid']} />
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
          {result.rows.map((r) => <MailpieceCard key={r.mailpieceId} row={r} open={expanded.includes(r.mailpieceId)} onToggle={() => toggle(r.mailpieceId)} onPrice={setPriceOf} />)}
        </Stack>
      )}
      <MailpiecePriceModal mailpieceId={priceOf} onClose={() => setPriceOf(null)} />
    </Stack>
  );
}
