import { useState } from 'react';
import { Alert, Button, NumberInput, Select, Group, Paper, SimpleGrid, Stack, Switch, Text, Textarea, TextInput, Title } from '@mantine/core';
import { FLAGS, type FlagKey } from '../../api/customers';
import { orNull, type TabProps } from './shared';

/** Flags the importer does not read yet. They were brought over from FileMaker and can be kept up to date here. */
const KEPT: FlagKey[] = FLAGS.filter((f) => f !== 'isAddressMatching' && f !== 'isDeleted');

const longDate = (iso: string): string => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

const ordinal = (n: number): string => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;

/** Says when the pending number will take over: the saved date if nothing about it changed, otherwise the next rollover day. */
function pendingNote(saved: string | null, from: string | null, typed: string, savedDay: number, day: number): string {
  if (typed.trim() === '') return 'The next job number. Leave empty for none.';
  if (saved !== null && from !== null && typed.trim() === saved && savedDay === day) return `Becomes the job number on ${longDate(from)}, then this field is cleared.`;
  return `Becomes the job number on the ${ordinal(day)} of the month, then this field is cleared.`;
}

export function DetailsTab({ detail, lookups, patchDetails }: TabProps) {
  const [code, setCode] = useState(detail.code);
  const [name, setName] = useState(detail.name);
  const [mis, setMis] = useState(detail.misJobNumber ?? '');
  const [pending, setPending] = useState(detail.pendingJobNumber ?? '');
  const [rollDay, setRollDay] = useState<number>(detail.jobNumberRolloverDay);
  const [ret, setRet] = useState(detail.returnAddress ?? '');
  const [flags, setFlags] = useState(detail.flags);
  const [parentId, setParentId] = useState<string | null>(detail.parent ? String(detail.parent.id) : null);
  const [invoicingId, setInvoicingId] = useState<string>(detail.invoicing ? String(detail.invoicing.id) : '');
  const parentChanged = parentId !== (detail.parent ? String(detail.parent.id) : null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const dirty = code !== detail.code || name !== detail.name || mis !== (detail.misJobNumber ?? '') || pending !== (detail.pendingJobNumber ?? '') || rollDay !== detail.jobNumberRolloverDay || invoicingId !== (detail.invoicing ? String(detail.invoicing.id) : '') || ret !== (detail.returnAddress ?? '') || FLAGS.some((f) => flags[f] !== detail.flags[f]) || parentId !== (detail.parent ? String(detail.parent.id) : null);

  const save = async () => {
    setSaving(true);
    try { await patchDetails({ code: code.trim(), name: name.trim(), misJobNumber: orNull(mis), pendingJobNumber: orNull(pending), jobNumberRolloverDay: rollDay, invoicingAccountId: invoicingId === '' || parentChanged ? null : Number(invoicingId), returnAddress: orNull(ret), flags, parentId: parentId === null ? null : Number(parentId) }); setErrors({}); }
    catch (e) { setErrors((e as { fieldErrors?: Record<string, string> }).fieldErrors ?? {}); }
    finally { setSaving(false); }
  };

  return (
    <Stack gap="lg">
      <Paper withBorder p="lg">
        <Title order={4} mb="md" c="brand.6">Customer</Title>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput label="Account code" description="Unique across all customers and sub-accounts." value={code} onChange={(e) => setCode(e.currentTarget.value)} error={errors['code']} />
          <TextInput label="Name" description="Printed as written on the run sheet." value={name} onChange={(e) => setName(e.currentTarget.value)} error={errors['name']} />
          <TextInput label="Job number" description="The customer's job number in the MIS. Printed on the run sheet." value={mis} onChange={(e) => setMis(e.currentTarget.value)} error={errors['misJobNumber']} />
          <TextInput label="Pending job number" value={pending} onChange={(e) => setPending(e.currentTarget.value)} error={errors['pendingJobNumber']}
            description={pendingNote(detail.pendingJobNumber, detail.pendingFrom, pending, detail.jobNumberRolloverDay, rollDay)} />
          <NumberInput label="Job number rollover day" description="Day of the month the pending job number takes over (1 to 28). Most customers use the 1st." min={1} max={28} allowDecimal={false} allowNegative={false}
            value={rollDay} onChange={(v) => setRollDay(typeof v === 'number' ? v : 1)} error={errors['jobNumberRolloverDay']} />
          <Select label="Parent customer" description="Where this customer sits in a hierarchy. It keeps its own settings; this only organises the list." searchable clearable placeholder="None (top level)"
            data={lookups.customers.filter((c) => c.id !== detail.id).map((c) => ({ value: String(c.id), label: `${c.name} (${c.code})` }))} value={parentId} onChange={setParentId} error={errors['parentId']} />
          <Select label="Invoicing account" allowDeselect={false} disabled={parentChanged}
            description={parentChanged ? 'Save the new parent first, then choose the invoicing account.' : 'The account that is invoiced for this customer\'s mail. Its job number is printed on the run sheet, and its mail is never batched with another invoicing account\'s.'}
            data={detail.invoicingOptions.map((o, i) => ({ value: i === 0 ? '' : String(o.id), label: i === 0 ? `${o.name} (this customer)` : `${o.name} (${o.code})` }))} value={invoicingId} onChange={(v) => setInvoicingId(v ?? '')} error={errors['invoicingAccountId']} />
          <Textarea label="Return address" autosize minRows={3} value={ret} onChange={(e) => setRet(e.currentTarget.value)} error={errors['returnAddress']} />
        </SimpleGrid>
      </Paper>
      <Paper withBorder p="lg">
        <Title order={4} mb={4} c="brand.6">Other flags</Title>
        <Alert color="gray" variant="light" mb="md">
          These were brought over from FileMaker. The importer does not read them yet, so changing them has no effect on processing today. Address matching is on the Matching &amp; batching tab.
        </Alert>
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          {KEPT.map((f) => (
            <Switch key={f} label={lookups.flagLabels[f]} checked={flags[f]} onChange={(e) => setFlags({ ...flags, [f]: e.currentTarget.checked })} />
          ))}
        </SimpleGrid>
        {detail.colourMode !== null && <Text size="sm" c="dimmed" mt="md">Colour mode (from FileMaker, not editable yet): {detail.colourMode}</Text>}
      </Paper>
      <Paper withBorder p="lg">
        <Title order={4} mb={4} c="brand.6">Deleting a customer</Title>
        <Text size="sm" c="dimmed" mb="sm">A deleted customer is hidden from the list. Its history is kept.</Text>
        <Switch label="Deleted" checked={flags.isDeleted} onChange={(e) => setFlags({ ...flags, isDeleted: e.currentTarget.checked })} />
      </Paper>
      <Group justify="flex-end"><Button onClick={save} loading={saving} disabled={!dirty}>Save</Button></Group>
    </Stack>
  );
}
