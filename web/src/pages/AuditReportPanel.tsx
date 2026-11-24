import { useEffect, useState } from 'react';
import { Alert, Anchor, Button, Checkbox, Group, Loader, Paper, Select, Stack, Text, TextInput } from '@mantine/core';
import { IconAlertCircle, IconFileTypePdf, IconSearch } from '@tabler/icons-react';
import { ApiError } from '../api/client';
import { createAuditReport } from '../api/audit';
import { listScopes, searchRecipients, type RecipientResult, type SearchScope } from '../api/recipients';
import { ukDate } from '../dates';
import { MailpieceCard } from './MailpieceCard';
import { EMPTY_FORM } from './recipientSearchSession';

const MAX = 300;
const LABELS: [keyof typeof EMPTY_FORM, string][] = [['name', 'Name contains'], ['address', 'Address contains'], ['jobGuid', 'Job GUID'], ['packGuid', 'Pack GUID'], ['reference', 'Reference'], ['referenceKey', 'in field']];

/** The words that describe the search, printed on the first page of the report. */
export function describeSearch(scopeLabel: string, form: typeof EMPTY_FORM, selected: number, found: number): string {
  const terms = LABELS.filter(([k]) => form[k].trim()).map(([k, l]) => `${l}: ${form[k].trim()}`);
  if (form.from) terms.push(`Released from ${ukDate(form.from)}`);
  if (form.to) terms.push(`Released to ${ukDate(form.to)}`);
  return `Searched in ${scopeLabel} and below. ${terms.join('; ')}. ${selected} of ${found} matches were chosen for this report.`;
}

/** Proof of postage: find a recipient's mailpieces, tick the ones that are theirs, and make the audit report. */
export function AuditReportPanel({ header }: { header: React.ReactNode }) {
  const [scopes, setScopes] = useState<SearchScope[] | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ data: RecipientResult; form: typeof EMPTY_FORM } | null>(null);
  const [ticked, setTicked] = useState<number[]>([]);
  const [open, setOpen] = useState<number[]>([]);
  const [images, setImages] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [making, setMaking] = useState(false);
  const [made, setMade] = useState<{ url: string; count: number } | null>(null);

  useEffect(() => { listScopes().then((r) => setScopes(r.rows)).catch((e: Error) => setError(e.message)); }, []);
  useEffect(() => () => { if (made) URL.revokeObjectURL(made.url); }, [made]);
  const set = (k: keyof typeof EMPTY_FORM) => (e: { currentTarget: { value: string } }) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, [k]: v })); };

  async function search(e: { preventDefault: () => void }) {
    e.preventDefault();
    setError(null); setErrors({}); setMade(null);
    if (!account) { setErrors({ accountId: 'Choose the account to search in. A search covers that account and the accounts below it.' }); return; }
    setBusy(true);
    try { const data = await searchRecipients({ accountId: Number(account), ...form, limit: MAX }); setResult({ data, form: { ...form } }); setTicked([]); setOpen([]); }
    catch (err) { setResult(null); if (err instanceof ApiError && err.fieldErrors) setErrors(err.fieldErrors); else setError((err as Error).message); }
    finally { setBusy(false); }
  }

  async function make() {
    if (!result) return;
    setError(null); setMaking(true);
    try {
      const ids = result.data.rows.map((r) => r.mailpieceId).filter((id) => ticked.includes(id));
      const blob = await createAuditReport({ accountId: result.data.scope.id, mailpieceIds: ids, criteria: describeSearch(result.data.scope.label, result.form, ids.length, result.data.rows.length), thumbnails: images });
      setMade({ url: URL.createObjectURL(blob), count: ids.length });
    } catch (err) { setError((err as Error).message); }
    finally { setMaking(false); }
  }

  const rows = result?.data.rows ?? [];
  const toggle = (list: number[], set: (l: number[]) => void, id: number) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <Stack>
      <Paper withBorder p="md">
        <form onSubmit={search}>
          <Stack>
            {header}
            <Select label="Search in" description="The account you choose and every account below it." placeholder="Choose an account" searchable data={(scopes ?? []).map((s) => ({ value: String(s.id), label: s.label }))}
              value={account} onChange={setAccount} error={errors['accountId']} disabled={!scopes} withAsterisk />
            <Group grow align="flex-start">
              <TextInput label="Name" description="Any part of the addressee" value={form.name} onChange={set('name')} error={errors['name']} />
              <TextInput label="Address" description="Any part of an address line or the postcode" value={form.address} onChange={set('address')} error={errors['address']} />
            </Group>
            <Group grow align="flex-start">
              <TextInput label="Job GUID" value={form.jobGuid} onChange={set('jobGuid')} error={errors['jobGuid']} />
              <TextInput label="Pack GUID" value={form.packGuid} onChange={set('packGuid')} error={errors['packGuid']} />
            </Group>
            <Group grow align="flex-start">
              <TextInput label="Reference" description="Exact, or start it and end with *" value={form.reference} onChange={set('reference')} error={errors['reference']} />
              <TextInput label="Reference name" description="Optional, e.g. Tenant Reference" value={form.referenceKey} onChange={set('referenceKey')} />
              <TextInput label="Released from" type="date" value={form.from} onChange={set('from')} error={errors['from']} />
              <TextInput label="Released to" type="date" value={form.to} onChange={set('to')} error={errors['to']} />
            </Group>
            <Group><Button type="submit" leftSection={<IconSearch size={16} />} loading={busy}>Find mailpieces</Button></Group>
          </Stack>
        </form>
        <Text size="xs" c="dimmed" mt="xs">Proof of postage: find the recipient's mailpieces, tick the ones that are theirs (open one to check the letters and references), then make the report. It lists what IntelliDoc recorded for each: the times it was produced, printed and despatched, the letters in it, who submitted them and, while the customer's PDF is still kept, an image of the first page. It shows no prices.</Text>
      </Paper>

      {error && <Alert color="red" icon={<IconAlertCircle size={16} />}>{error}</Alert>}
      {!scopes && !error && <Loader size="sm" />}

      {result && (
        <Stack gap="xs">
          <Group justify="space-between" align="flex-end">
            <Text size="sm" c="dimmed">
              {rows.length === 0 ? 'Nothing found' : `${rows.length} found`} in {result.data.scope.label} and below, newest first.
              {result.data.truncated && ` There are more than ${MAX}. Narrow the search to see the rest.`}
            </Text>
            {rows.length > 0 && <Group gap="xs">
              <Button variant="default" size="compact-sm" onClick={() => setTicked(rows.map((r) => r.mailpieceId))}>Tick all</Button>
              <Button variant="default" size="compact-sm" onClick={() => setTicked([])}>Untick all</Button>
            </Group>}
          </Group>
          {rows.map((r) => <MailpieceCard key={r.mailpieceId} row={r} open={open.includes(r.mailpieceId)} onToggle={() => toggle(open, setOpen, r.mailpieceId)}
            select={{ checked: ticked.includes(r.mailpieceId), onChange: () => toggle(ticked, setTicked, r.mailpieceId) }} />)}
          {rows.length > 0 && (
            <Paper withBorder p="md" style={{ position: 'sticky', bottom: 8 }}>
              <Group justify="space-between">
                <Group>
                  <Button leftSection={<IconFileTypePdf size={16} />} onClick={make} loading={making} disabled={ticked.length === 0}>Create report ({ticked.length} {ticked.length === 1 ? 'mailpiece' : 'mailpieces'})</Button>
                  <Checkbox label="Include an image of the first page of each letter" checked={images} onChange={(e) => setImages(e.currentTarget.checked)} />
                </Group>
                {made && <Anchor href={made.url} target="_blank" rel="noreferrer">Open the report ({made.count} {made.count === 1 ? 'mailpiece' : 'mailpieces'})</Anchor>}
              </Group>
            </Paper>
          )}
        </Stack>
      )}
    </Stack>
  );
}
