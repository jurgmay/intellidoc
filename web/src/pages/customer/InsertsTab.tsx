import { useState } from 'react';
import { Alert, Badge, Button, Group, Modal, MultiSelect, NumberInput, Paper, Select, Stack, Switch, Table, Text, TextInput } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { addInsert, deleteInsert, updateInsert, type InsertInput, type InsertView } from '../../api/customers';
import { FromParent, ModeSelect } from './ModeSelect';
import { orNull, run, type TabProps } from './shared';

/** What a number box holds while it is being typed: a number, or text such as "0." or "". */
type Num = number | string;
interface Form {
  stockCode: string; description: string; brandId: string | null; reference: string; hpodGuid: string; insertSizeId: string | null;
  widthMm: Num; heightMm: Num; thicknessMm: Num; weightG: Num; isChargeable: boolean; costPrice: Num; sellPrice: Num; linkedIds: string[];
}
const EMPTY: Form = { stockCode: '', description: '', brandId: null, reference: '', hpodGuid: '', insertSizeId: null, widthMm: '', heightMm: '', thicknessMm: 0, weightG: 0, isChargeable: false, costPrice: '', sellPrice: '', linkedIds: [] };

/** £ with at least 2 and at most 4 decimal places (prices are often fractions of a penny). */
export const money = (n: number | null): string => (n === null ? '–' : `£${n.toFixed(4).replace(/(\.\d\d)0{1,2}$/, '$1').replace(/(\.\d{3})0$/, '$1')}`);
const numOrNull = (v: Num): number | null => (v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const size = (i: InsertView): string => [i.widthMm, i.heightMm].every((x) => x !== null) ? `${i.widthMm} × ${i.heightMm} × ${i.thicknessMm}` : `${i.thicknessMm} thick`;

export function InsertsTab({ detail, lookups, reload }: TabProps) {
  const [editing, setEditing] = useState<InsertView | 'new' | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<InsertView | null>(null);
  // Brand filter: 'all', 'none' (inserts with no brand) or a brand id. It only changes what is listed.
  const [brandFilter, setBrandFilter] = useState<string>('all');

  const open = (i: InsertView | 'new') => {
    setEditing(i); setErrors({}); setGeneral(null);
    setForm(i === 'new' ? EMPTY : {
      stockCode: i.stockCode ?? '', description: i.description, brandId: i.brandId === null ? null : String(i.brandId), reference: i.reference ?? '', hpodGuid: i.hpodGuid ?? '',
      insertSizeId: i.insertSizeId === null ? null : String(i.insertSizeId), widthMm: i.widthMm ?? '', heightMm: i.heightMm ?? '', thicknessMm: i.thicknessMm, weightG: i.weightG,
      isChargeable: i.isChargeable, costPrice: i.costPrice ?? '', sellPrice: i.sellPrice ?? '', linkedIds: i.linkedIds.map(String),
    });
  };
  const save = async () => {
    const body: InsertInput = {
      stockCode: form.stockCode.trim(), description: form.description.trim(), brandId: form.brandId === null ? null : Number(form.brandId), reference: orNull(form.reference), hpodGuid: orNull(form.hpodGuid),
      insertSizeId: form.insertSizeId === null ? null : Number(form.insertSizeId), widthMm: numOrNull(form.widthMm), heightMm: numOrNull(form.heightMm),
      thicknessMm: numOrNull(form.thicknessMm) ?? 0, weightG: numOrNull(form.weightG) ?? 0, isChargeable: form.isChargeable,
      costPrice: numOrNull(form.costPrice), sellPrice: numOrNull(form.sellPrice), linkedIds: form.linkedIds.map(Number),
    };
    const res = await run(() => (editing === 'new' ? addInsert(detail.id, body) : updateInsert((editing as InsertView).id, body)), 'Insert saved');
    if (res.ok) { setEditing(null); await reload(); }
    else if (res.fieldErrors) setErrors(res.fieldErrors);
    else setGeneral(res.message ?? 'Not saved');
  };
  const remove = async () => {
    const i = confirm!; setConfirm(null);
    const res = await run(() => deleteInsert(i.id), 'Insert removed');
    if (res.ok) await reload();
  };
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  /** Choosing a size fills in its width and height (Settings > Insert sizes) where it has them; they can still be changed. */
  const chooseSize = (v: string | null) => setForm((f) => {
    const z = v === null ? undefined : lookups.insertSizes.find((x) => String(x.id) === v);
    return { ...f, insertSizeId: v, widthMm: z?.widthMm ?? f.widthMm, heightMm: z?.heightMm ?? f.heightMm };
  });

  const mode = detail.modes.inserts;
  const filterName = brandFilter === 'all' || brandFilter === 'none' ? null : detail.brands.find((b) => String(b.id) === brandFilter)?.name.toLowerCase() ?? null;
  const shown = detail.inserts.filter((i) => brandFilter === 'all' || (brandFilter === 'none' ? i.brandId === null : String(i.brandId) === brandFilter));
  // A parent's inserts belong to the parent's brands, so they are matched by brand name.
  const shownInherited = detail.inheritedInserts.filter((i) => brandFilter === 'all' || (brandFilter === 'none' ? i.brandName === null : i.brandName?.toLowerCase() === filterName));
  const filtering = brandFilter !== 'all';
  const codeOf = new Map(detail.inserts.map((i) => [i.id, i.stockCode ?? i.description]));

  const self = editing !== null && editing !== 'new' ? editing : null;
  // Only an insert with nothing linked under it, and not itself linked under another, can be linked here; and an insert that is itself linked cannot link others.
  const linkable = detail.inserts.filter((i) => i.id !== self?.id && i.linkedIds.length === 0 && (i.parent === null || i.parent.id === self?.id));
  const cost = numOrNull(form.costPrice), sell = numOrNull(form.sellPrice);
  const margin = cost === null || sell === null ? null : Math.round((sell - cost) * 10_000) / 10_000;

  return (
    <Stack>
      <ModeSelect detail={detail} setting="inserts" label="Where the insert list comes from" noun="list" reload={reload}
        hint="The parent's inserts are shown below for reference. Inserts are found by stock code when a file is imported.">
        {mode === 'INHERIT' && detail.inserts.length > 0 && <Alert color="yellow" variant="light" mt="sm">This customer's own inserts are kept but not listed as available while it takes the parent's list.</Alert>}
      </ModeSelect>
      <Group justify="space-between" align="flex-start">
        <Text size="sm" c="dimmed" maw={760}>
          Leaflets, reply envelopes, brochures and other stock that goes in with the letter. An insert's weight and thickness are counted when a mailpiece is weighed. An insert can have other inserts linked to it:
          wherever it is used, its linked inserts are counted and shown with it. Margin is the sell price less the cost.
        </Text>
        <Button leftSection={<IconPlus size={16} />} onClick={() => open('new')} disabled={mode === 'INHERIT'}>Add insert</Button>
      </Group>
      {(detail.brands.length > 0 || detail.inheritedInserts.some((i) => i.brandName !== null)) && (
        <Group align="flex-end">
          <Select label="Show brand" w={260} allowDeselect={false} value={brandFilter} onChange={(v) => setBrandFilter(v ?? 'all')}
            data={[{ value: 'all', label: 'All brands' }, { value: 'none', label: 'No brand (any brand)' }, ...detail.brands.map((b) => ({ value: String(b.id), label: b.name }))]} />
          {filtering && <Text size="sm" c="dimmed" pb={6}>Showing {shown.length} of {detail.inserts.length}</Text>}
        </Group>
      )}
      <Paper withBorder style={{ overflowX: 'auto' }}>
        <Table verticalSpacing="sm">
          <Table.Thead><Table.Tr><Table.Th>Stock code</Table.Th><Table.Th>Description</Table.Th><Table.Th>Brand</Table.Th><Table.Th>Size</Table.Th><Table.Th>mm (W × H × T)</Table.Th><Table.Th>Weight (g)</Table.Th>
            <Table.Th>Chargeable</Table.Th><Table.Th>Cost</Table.Th><Table.Th>Sell</Table.Th><Table.Th>Margin</Table.Th><Table.Th>Linked</Table.Th><Table.Th /></Table.Tr></Table.Thead>
          <Table.Tbody>
            {shown.map((i) => (
              <Table.Tr key={i.id}>
                <Table.Td>{i.stockCode ?? <Text span c="dimmed">no code</Text>}</Table.Td>
                <Table.Td>{i.description}{i.reference && <Text span c="dimmed"> ({i.reference})</Text>}</Table.Td>
                <Table.Td>{i.brandName ?? <Text span c="dimmed">Any brand</Text>}</Table.Td>
                <Table.Td>{i.sizeName ?? <Text span c="dimmed">–</Text>}</Table.Td>
                <Table.Td>{size(i)}</Table.Td>
                <Table.Td>{i.weightG}</Table.Td>
                <Table.Td>{i.isChargeable ? <Badge variant="light" color="teal">Yes</Badge> : <Text span c="dimmed">No</Text>}</Table.Td>
                <Table.Td>{money(i.costPrice)}</Table.Td>
                <Table.Td>{money(i.sellPrice)}</Table.Td>
                <Table.Td>{money(i.margin)}</Table.Td>
                <Table.Td>{i.parent ? <Text span size="sm">with {i.parent.stockCode ?? i.parent.description}</Text> : i.linkedIds.length > 0 ? <Text span size="sm">{i.linkedIds.map((l) => codeOf.get(l) ?? l).join(', ')}</Text> : <Text span c="dimmed">–</Text>}</Table.Td>
                <Table.Td><Group justify="flex-end" gap="xs" wrap="nowrap"><Button size="xs" variant="default" onClick={() => open(i)}>Edit</Button><Button size="xs" variant="subtle" color="red" onClick={() => setConfirm(i)}>Remove</Button></Group></Table.Td>
              </Table.Tr>
            ))}
            {shown.length === 0 && <Table.Tr><Table.Td colSpan={12}><Text c="dimmed" ta="center" py="md">{filtering && detail.inserts.length > 0 ? 'No inserts for this brand.' : mode === 'OWN' ? 'No inserts yet.' : mode === 'EXTEND' ? "No inserts of this customer's own yet. The parent's are listed below." : "This customer takes the parent's inserts, listed below."}</Text></Table.Td></Table.Tr>}
          </Table.Tbody>
        </Table>
      </Paper>
      <FromParent head={['Stock code', 'Description', 'Brand', 'Size', 'Weight (g)', 'Chargeable', 'Sell']}
        rows={shownInherited.map((i) => ({ key: `i${i.id}`, from: i.from.name, cells: [i.stockCode ?? 'no code', i.description, i.brandName ?? 'Any brand', i.sizeName ?? '–', i.weightG, i.isChargeable ? 'Yes' : 'No', money(i.sellPrice)] }))} />
      <Modal opened={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add insert' : 'Edit insert'} size="lg">
        <Stack>
          {general && <Alert color="red">{general}</Alert>}
          <Group grow align="flex-start">
            <TextInput label="Stock code" required value={form.stockCode} onChange={(e) => set('stockCode', e.currentTarget.value)} error={errors['stockCode']} />
            <TextInput label="Reference" value={form.reference} onChange={(e) => set('reference', e.currentTarget.value)} error={errors['reference']} />
          </Group>
          <TextInput label="Description" required value={form.description} onChange={(e) => set('description', e.currentTarget.value)} error={errors['description']} />
          <Group grow align="flex-start">
            <Select label="Brand" placeholder="Any brand" clearable data={detail.brands.map((b) => ({ value: String(b.id), label: b.name }))} value={form.brandId} onChange={(v) => set('brandId', v)} error={errors['brandId']} />
            <Select label="Display size" placeholder="Not set" clearable data={lookups.insertSizes.map((z) => ({ value: String(z.id), label: z.name }))} value={form.insertSizeId} onChange={chooseSize} error={errors['insertSizeId']} />
          </Group>
          <TextInput label="H-POD GUID" placeholder="e.g. 3f2b8c1e-5d4a-4e7b-9a10-2c6d8e0f1a23" value={form.hpodGuid} onChange={(e) => set('hpodGuid', e.currentTarget.value)} error={errors['hpodGuid']} />
          <Group grow align="flex-start">
            <NumberInput label="Width (mm)" min={0} decimalScale={2} value={form.widthMm} onChange={(v) => set('widthMm', v)} error={errors['widthMm']} />
            <NumberInput label="Height (mm)" min={0} decimalScale={2} value={form.heightMm} onChange={(v) => set('heightMm', v)} error={errors['heightMm']} />
            <NumberInput label="Thickness (mm)" min={0} decimalScale={2} value={form.thicknessMm} onChange={(v) => set('thicknessMm', v)} error={errors['thicknessMm']} />
            <NumberInput label="Weight (g)" min={0} decimalScale={2} value={form.weightG} onChange={(v) => set('weightG', v)} error={errors['weightG']} />
          </Group>
          <Switch label="Chargeable" description="The customer is charged for this insert." checked={form.isChargeable} onChange={(e) => set('isChargeable', e.currentTarget.checked)} error={errors['isChargeable']} />
          <Group grow align="flex-start">
            <NumberInput label="Cost (£)" min={0} decimalScale={4} value={form.costPrice} onChange={(v) => set('costPrice', v)} error={errors['costPrice']} />
            <NumberInput label="Sell price (£)" min={0} decimalScale={4} value={form.sellPrice} onChange={(v) => set('sellPrice', v)} error={errors['sellPrice']} />
            <TextInput label="Margin (£)" description="Sell price less cost" readOnly value={margin === null ? '' : money(margin)} />
          </Group>
          <MultiSelect label="Linked inserts" description="Also counted and shown on the run sheet whenever this insert is used." placeholder={self?.parent ? '' : 'None'} searchable clearable disabled={!!self?.parent}
            data={linkable.map((i) => ({ value: String(i.id), label: `${i.stockCode ?? 'no code'} – ${i.description}` }))} value={form.linkedIds} onChange={(v) => set('linkedIds', v)} error={errors['linkedIds']} />
          {self?.parent && <Text size="xs" c="dimmed">This insert is linked under {self.parent.stockCode ?? self.parent.description}, so it cannot have linked inserts of its own.</Text>}
          <Group justify="flex-end"><Button variant="default" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save}>Save</Button></Group>
        </Stack>
      </Modal>
      <Modal opened={confirm !== null} onClose={() => setConfirm(null)} title="Remove insert">
        <Stack>
          <Text>Remove {confirm?.stockCode ?? confirm?.description} – {confirm?.description}? Files already imported keep it. Anything linked to it is unlinked.</Text>
          <Group justify="flex-end"><Button variant="default" onClick={() => setConfirm(null)}>Cancel</Button><Button color="red" onClick={remove}>Remove</Button></Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
