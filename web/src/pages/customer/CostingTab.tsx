import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Anchor, Badge, Button, Group, Loader, Modal, Paper, Select, Stack, Switch, Table, Text, TextInput } from '@mantine/core';
import { IconAlertCircle, IconPlus } from '@tabler/icons-react';
import { createModel, getCosting, setCostingMode, type CostingMode, type CostingOverview, type ModelSummary } from '../../api/costing';
import { CostingModelEditor } from './CostingModelEditor';
import { RepriceCard } from './RepriceCard';
import { orNull, run, type TabProps } from './shared';

const today = (): string => new Date().toISOString().slice(0, 10);
function status(m: ModelSummary, inForceId: number | null): { label: string; color: string } {
  if (m.validFrom === null) return { label: 'Draft: no dates yet', color: 'orange' };
  if (!m.isActive) return { label: 'Switched off', color: 'gray' };
  if (m.id === inForceId) return { label: 'In force', color: 'teal' };
  if (m.validTo !== null && m.validTo < today()) return { label: 'Ended', color: 'gray' };
  if (m.validFrom > today()) return { label: 'Not started', color: 'blue' };
  return { label: 'Replaced by a later model', color: 'yellow' };
}
const dates = (m: ModelSummary): string => (m.validFrom === null ? 'Not set' : `${m.validFrom} to ${m.validTo ?? 'until replaced'}`);

function ModelTable({ models, inForceId, onOpen }: { models: ModelSummary[]; inForceId: number | null; onOpen?: (id: number) => void }) {
  return (
    <Table verticalSpacing="sm">
      <Table.Thead><Table.Tr><Table.Th>Model</Table.Th><Table.Th>Applies</Table.Th><Table.Th>Status</Table.Th><Table.Th>Mailpieces priced</Table.Th><Table.Th /></Table.Tr></Table.Thead>
      <Table.Tbody>
        {models.map((m) => {
          const s = status(m, inForceId);
          return (
            <Table.Tr key={m.id}>
              <Table.Td fw={500}>{m.name}</Table.Td>
              <Table.Td>{dates(m)}</Table.Td>
              <Table.Td><Badge color={s.color} variant="light">{s.label}</Badge></Table.Td>
              <Table.Td>{m.mailpieceCount === 0 ? <Text span c="dimmed">None</Text> : m.mailpieceCount.toLocaleString('en-GB')}</Table.Td>
              <Table.Td><Group justify="flex-end">{onOpen && <Button size="xs" variant="default" onClick={() => onOpen(m.id)}>Open</Button>}</Group></Table.Td>
            </Table.Tr>
          );
        })}
        {models.length === 0 && <Table.Tr><Table.Td colSpan={5}><Text c="dimmed" ta="center" py="md">No costing models.</Text></Table.Td></Table.Tr>}
      </Table.Tbody>
    </Table>
  );
}

export function CostingTab({ detail }: TabProps) {
  const [o, setO] = useState<CostingOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', validFrom: '', validTo: '', isActive: true, copyFromId: null as string | null });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);

  const load = useCallback(async () => { setO(await getCosting(detail.id)); }, [detail.id]);
  useEffect(() => { load().catch((e: Error) => setError(e.message)); }, [load]);

  if (error) return <Alert color="red" icon={<IconAlertCircle />} title="Could not load the costing">{error}</Alert>;
  if (!o) return <Loader />;
  if (openId !== null) return <CostingModelEditor id={openId} onBack={() => { setOpenId(null); load().catch((e: Error) => setError(e.message)); }} />;

  const changeMode = async (m: string | null) => {
    if (m === null || m === o.mode) return;
    const res = await run(() => setCostingMode(detail.id, m as CostingMode), 'Costing changed');
    if (res.ok) await load();
  };
  const open = () => { setForm({ name: '', validFrom: today(), validTo: '', isActive: true, copyFromId: null }); setErrors({}); setGeneral(null); setAdding(true); };
  const add = async () => {
    const res = await run(async () => {
      const { id } = await createModel(detail.id, { name: form.name, validFrom: form.validFrom, validTo: orNull(form.validTo), isActive: form.isActive, copyFromId: form.copyFromId === null ? null : Number(form.copyFromId) });
      setAdding(false); await load(); setOpenId(id);
    }, 'Costing model created');
    if (!res.ok) { setErrors(res.fieldErrors ?? {}); setGeneral(res.fieldErrors ? null : res.message ?? 'Not saved'); }
  };
  const own = o.mode === 'OWN' && !o.inheritsAll;
  const copyOptions = [...o.models, ...o.sourceModels].map((m) => ({ value: String(m.id), label: m.validFrom === null ? `${m.name} (draft)` : `${m.name} (${m.validFrom})` }));

  return (
    <Stack>
      <Paper withBorder p="md">
        <Select label="Where the prices come from" allowDeselect={false} maw={420} value={o.mode} onChange={changeMode} disabled={o.inheritsAll || detail.parent === null}
          data={[{ value: 'OWN', label: "This customer's own price lists" }, { value: 'INHERIT', label: "The parent's price lists" }]}
          description={o.inheritsAll ? 'This account takes all its settings from its parent.' : detail.parent ? `The parent is ${detail.parent.name} (${detail.parent.code}).` : 'Choose a parent customer on the Details tab to take prices from it.'} />
      </Paper>
      {o.source && (
        <Alert color="blue" title={`Prices come from ${o.source.name}`}>
          Mail from this customer is priced with {o.source.name}&apos;s models, shown below. To change them, edit them on <Anchor component={Link} to={`/customers/${o.source.id}`}>{o.source.name}</Anchor>.
        </Alert>
      )}
      {o.inForceId === null && <Alert color="yellow" icon={<IconAlertCircle />} title="No model prices today's mail">Until there is an active model that covers today, mailpieces are saved without a price.</Alert>}
      <Paper withBorder>
        <Group justify="space-between" p="md" pb={0}>
          <Text fw={600}>{o.source ? `Price lists of ${o.source.name}` : 'Price lists'}</Text>
          {own && <Button size="xs" leftSection={<IconPlus size={14} />} onClick={open}>New model</Button>}
        </Group>
        {o.source ? <ModelTable models={o.sourceModels} inForceId={o.inForceId} /> : <ModelTable models={o.models} inForceId={o.inForceId} onOpen={setOpenId} />}
      </Paper>
      <RepriceCard customerId={detail.id} />
      <Modal opened={adding} onClose={() => setAdding(false)} title="New costing model">
        <Stack>
          {general && <Alert color="red">{general}</Alert>}
          <TextInput label="Name" value={form.name} onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, name: v })); }} error={errors['name']} data-autofocus />
          <Group grow align="flex-start">
            <TextInput label="First day" type="date" value={form.validFrom} onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, validFrom: v })); }} error={errors['validFrom']} />
            <TextInput label="Last day" type="date" description="Leave empty until replaced" value={form.validTo} onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, validTo: v })); }} error={errors['validTo']} />
          </Group>
          <Select label="Start from" placeholder="An empty model" clearable data={copyOptions} value={form.copyFromId} onChange={(v) => setForm((f) => ({ ...f, copyFromId: v }))} error={errors['copyFromId']}
            description="Copy every price from an existing model, then change what is different." />
          <Switch label="Switched on" checked={form.isActive} onChange={(e) => { const v = e.currentTarget.checked; setForm((f) => ({ ...f, isActive: v })); }} />
          <Group justify="flex-end"><Button variant="default" onClick={() => setAdding(false)}>Cancel</Button><Button onClick={add}>Create</Button></Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
