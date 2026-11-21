import { useState } from 'react';
import { Alert, Autocomplete, Badge, Button, Group, Modal, Paper, Select, Stack, Switch, Table, Text, TextInput } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { addEnvelope, deleteEnvelope, updateEnvelope, type EnvelopeInput, type EnvelopeView } from '../../api/customers';
import { orNull, run, type TabProps } from './shared';

interface Form { brandId: string | null; deliveryBand: string; postalRateId: string | null; stockItemId: string | null; reference: string; externalName: string; isOversticker: boolean }
const EMPTY: Form = { brandId: null, deliveryBand: '', postalRateId: null, stockItemId: null, reference: '', externalName: '', isOversticker: false };

export function EnvelopesTab({ detail, lookups, reload }: TabProps) {
  const [editing, setEditing] = useState<EnvelopeView | 'new' | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<EnvelopeView | null>(null);

  const open = (e: EnvelopeView | 'new') => {
    setEditing(e); setErrors({}); setGeneral(null);
    setForm(e === 'new' ? EMPTY : { brandId: e.brandId === null ? null : String(e.brandId), deliveryBand: e.deliveryBand, postalRateId: String(e.postalRateId), stockItemId: String(e.stockItemId), reference: e.reference ?? '', externalName: e.externalName ?? '', isOversticker: e.isOversticker });
  };
  const save = async () => {
    const body: EnvelopeInput = {
      brandId: form.brandId === null ? null : Number(form.brandId), deliveryBand: form.deliveryBand.trim(), postalRateId: Number(form.postalRateId), stockItemId: Number(form.stockItemId),
      reference: orNull(form.reference), externalName: orNull(form.externalName), isOversticker: form.isOversticker,
    };
    if (form.postalRateId === null || form.stockItemId === null) {
      setErrors({ ...(form.postalRateId === null ? { postalRateId: 'Choose a postal service and weight band' } : {}), ...(form.stockItemId === null ? { stockItemId: 'Choose an envelope' } : {}) });
      return;
    }
    const res = await run(() => (editing === 'new' ? addEnvelope(detail.id, body) : updateEnvelope((editing as EnvelopeView).id, body)), 'Envelope saved');
    if (res.ok) { setEditing(null); await reload(); }
    else if (res.fieldErrors) setErrors(res.fieldErrors);
    else setGeneral(res.message ?? 'Not saved');
  };
  const remove = async () => {
    const e = confirm!; setConfirm(null);
    const res = await run(() => deleteEnvelope(e.id), 'Envelope setting removed');
    if (res.ok) await reload();
  };

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const stockLabel = (s: { code: string | null; description: string; size: string | null }) => `${s.code ?? 'no code'} – ${s.description}${s.size ? ` (${s.size})` : ''}`;
  // Keep the saved choice visible even if it is no longer in the current lists.
  const rates = lookups.postalRates.map((r) => ({ value: String(r.id), label: r.label }));
  if (editing !== 'new' && editing && !rates.some((r) => r.value === String(editing.postalRateId))) rates.push({ value: String(editing.postalRateId), label: editing.rateLabel });

  return (
    <Stack>
      <Group justify="space-between" align="flex-start">
        <Text size="sm" c="dimmed" maw={760}>
          Which outer envelope is used for each brand, delivery band and postal service weight band. When a mailpiece is weighed, the importer picks the setting whose weight band covers it. A setting with no brand is used for packs that have no brand.
        </Text>
        <Button leftSection={<IconPlus size={16} />} onClick={() => open('new')}>Add envelope</Button>
      </Group>
      <Paper withBorder>
        <Table verticalSpacing="sm">
          <Table.Thead><Table.Tr><Table.Th>Brand</Table.Th><Table.Th>Delivery band</Table.Th><Table.Th>Postal service and weight band</Table.Th><Table.Th>Envelope</Table.Th><Table.Th>Reference</Table.Th><Table.Th /></Table.Tr></Table.Thead>
          <Table.Tbody>
            {detail.envelopes.map((e) => (
              <Table.Tr key={e.id}>
                <Table.Td>{e.brandName ?? <Text span c="dimmed">Any brand</Text>}</Table.Td>
                <Table.Td>{e.deliveryBand}</Table.Td>
                <Table.Td>{e.rateLabel}</Table.Td>
                <Table.Td>{e.stockCode ?? 'no code'} – {e.stockDescription} {e.isOversticker && <Badge ml="xs" variant="light">Oversticker</Badge>}</Table.Td>
                <Table.Td>{e.reference ?? <Text span c="dimmed">–</Text>}</Table.Td>
                <Table.Td><Group justify="flex-end" gap="xs"><Button size="xs" variant="default" onClick={() => open(e)}>Edit</Button><Button size="xs" variant="subtle" color="red" onClick={() => setConfirm(e)}>Remove</Button></Group></Table.Td>
              </Table.Tr>
            ))}
            {detail.envelopes.length === 0 && <Table.Tr><Table.Td colSpan={6}><Text c="dimmed" ta="center" py="md">No envelope settings. Files for this customer cannot be given an envelope until one is added.</Text></Table.Td></Table.Tr>}
          </Table.Tbody>
        </Table>
      </Paper>
      <Modal opened={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add envelope' : 'Edit envelope'} size="lg">
        <Stack>
          {general && <Alert color="red">{general}</Alert>}
          <Select label="Brand" placeholder="Any brand" clearable data={detail.brands.map((b) => ({ value: String(b.id), label: b.name }))} value={form.brandId} onChange={(v) => set('brandId', v)} error={errors['brandId']} />
          <Autocomplete label="Delivery band" description="The customer-facing service, for example 1st Class." data={lookups.deliveryBands} value={form.deliveryBand} onChange={(v) => set('deliveryBand', v)} error={errors['deliveryBand']} />
          <Select label="Postal service and weight band" searchable data={rates} value={form.postalRateId} onChange={(v) => set('postalRateId', v)} error={errors['postalRateId']} />
          <Select label="Envelope" searchable data={lookups.envelopeStock.map((s) => ({ value: String(s.id), label: stockLabel(s) }))} value={form.stockItemId} onChange={(v) => set('stockItemId', v)} error={errors['stockItemId']} />
          <Group grow align="flex-start">
            <TextInput label="Reference" value={form.reference} onChange={(e) => set('reference', e.currentTarget.value)} error={errors['reference']} />
            <TextInput label="External name" value={form.externalName} onChange={(e) => set('externalName', e.currentTarget.value)} error={errors['externalName']} />
          </Group>
          <Switch label="Oversticker" checked={form.isOversticker} onChange={(e) => set('isOversticker', e.currentTarget.checked)} />
          <Group justify="flex-end"><Button variant="default" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save}>Save</Button></Group>
        </Stack>
      </Modal>
      <Modal opened={confirm !== null} onClose={() => setConfirm(null)} title="Remove envelope setting">
        <Stack>
          <Text>Remove the {confirm?.deliveryBand} setting for {confirm?.brandName ?? 'any brand'} ({confirm?.rateLabel})? Files already imported keep the envelope they were given.</Text>
          <Group justify="flex-end"><Button variant="default" onClick={() => setConfirm(null)}>Cancel</Button><Button color="red" onClick={remove}>Remove</Button></Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
