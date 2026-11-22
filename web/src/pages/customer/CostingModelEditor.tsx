import { useEffect, useMemo, useState } from 'react';
import { Alert, Anchor, Badge, Button, Group, Loader, Modal, NumberInput, Paper, Select, Stack, Switch, Table, Text, Textarea, TextInput, Title } from '@mantine/core';
import { IconAlertCircle, IconArrowLeft, IconPlus, IconTrash } from '@tabler/icons-react';
import { deleteModel, getCostingLookups, getModel, saveModel, type CostingLookups, type ModelDetail, type ModelInput } from '../../api/costing';
import { orNull, run } from './shared';

const money = (n: number): string => (Math.round(n * 1e4) / 1e4).toFixed(4);
type Price = { cost: number; sellPrice: number; adjustment: number };

function Num({ value, onChange, error, label, allowNegative = false }: { value: number; onChange: (v: number) => void; error?: string; label: string; allowNegative?: boolean }) {
  // Keep what is being typed ("0." is not a number yet) and tell the page the number it means.
  const [raw, setRaw] = useState<number | string>(value);
  return <NumberInput aria-label={label} size="xs" w={110} value={raw} decimalScale={4} fixedDecimalScale min={allowNegative ? undefined : 0} hideControls error={error}
    onChange={(v) => { setRaw(v); onChange(typeof v === 'number' ? v : Number(v) || 0); }} />;
}

interface Props { id: number; onBack: () => void }

export function CostingModelEditor({ id, onBack }: Props) {
  const [m, setM] = useState<ModelDetail | null>(null);
  const [lookups, setLookups] = useState<CostingLookups | null>(null);
  const [form, setForm] = useState<{ name: string; validFrom: string; validTo: string; isActive: boolean; comments: string } | null>(null);
  const [charges, setCharges] = useState<ModelDetail['charges']>([]);
  const [envelopes, setEnvelopes] = useState<ModelDetail['envelopes']>([]);
  const [postage, setPostage] = useState<ModelDetail['postage']>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [addEnv, setAddEnv] = useState<string | null>(null);

  const apply = (d: ModelDetail) => {
    setM(d); setCharges(d.charges); setEnvelopes(d.envelopes); setPostage(d.postage); setDirty(false);
    setForm({ name: d.name, validFrom: d.validFrom ?? '', validTo: d.validTo ?? '', isActive: d.isActive, comments: d.comments ?? '' });
  };
  useEffect(() => { Promise.all([getModel(id), getCostingLookups()]).then(([d, l]) => { apply(d); setLookups(l); }).catch((e: Error) => setLoadError(e.message)); }, [id]);

  const groups = useMemo(() => [...new Set(charges.map((c) => c.group))], [charges]);
  if (loadError) return <Alert color="red" icon={<IconAlertCircle />} title="Could not load this model">{loadError}</Alert>;
  if (!m || !form || !lookups) return <Loader />;

  const touch = () => setDirty(true);
  const setF = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => { setForm((f) => ({ ...f!, [k]: v })); touch(); };
  const setCharge = (i: number, patch: Partial<Price>) => { setCharges((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c))); touch(); };
  const setEnv = (i: number, patch: Partial<Price>) => { setEnvelopes((es) => es.map((e, j) => (j === i ? { ...e, ...patch } : e))); touch(); };
  const setPost = (i: number, adjustment: number) => { setPostage((ps) => ps.map((p, j) => (j === i ? { ...p, adjustment } : p))); touch(); };

  const save = async () => {
    const body: ModelInput = {
      name: form.name, validFrom: orNull(form.validFrom), validTo: orNull(form.validTo), isActive: form.isActive, comments: orNull(form.comments),
      charges: charges.map((c) => ({ code: c.code, cost: c.cost, sellPrice: c.sellPrice, adjustment: c.adjustment })),
      envelopes: envelopes.map((e) => ({ stockItemId: e.stockItemId, cost: e.cost, sellPrice: e.sellPrice, adjustment: e.adjustment })),
      postage: postage.map((p) => ({ postalRateId: p.postalRateId, adjustment: p.adjustment })),
    };
    let saved: ModelDetail | null = null;
    const res = await run(async () => { saved = await saveModel(id, body); }, 'Costing model saved');
    if (res.ok && saved) { setErrors({}); setGeneral(null); apply(saved); }
    else { setErrors(res.fieldErrors ?? {}); setGeneral(res.fieldErrors ? 'Some values need fixing. They are marked below.' : res.message ?? 'Not saved'); }
  };
  const remove = async () => {
    setConfirmDelete(false);
    const res = await run(() => deleteModel(id), 'Costing model deleted');
    if (res.ok) onBack();
  };
  const unused = lookups.envelopeStock.filter((s) => !envelopes.some((e) => e.stockItemId === s.id));
  const addEnvelope = (v: string | null) => {
    const s = lookups.envelopeStock.find((x) => String(x.id) === v);
    if (!s) return;
    setEnvelopes((es) => [...es, { stockItemId: s.id, stockCode: s.code, description: s.description, size: s.size, cost: 0, sellPrice: 0, adjustment: 0 }]); touch(); setAddEnv(null);
  };
  const sellOnly = (group: string) => group === 'Adjustments';

  return (
    <Stack>
      <div>
        <Anchor component="button" type="button" size="sm" onClick={() => { if (!dirty || window.confirm('Leave without saving your changes?')) onBack(); }}><Group gap={4}><IconArrowLeft size={14} />All price lists</Group></Anchor>
        <Group mt="xs" gap="sm"><Title order={3}>{m.name}</Title>{m.validFrom === null ? <Badge color="orange">Draft: no dates yet</Badge> : !m.isActive && <Badge color="gray">Switched off</Badge>}{dirty && <Badge color="orange" variant="light">Unsaved changes</Badge>}</Group>
        {m.copiedFrom && <Text size="sm" c="dimmed">Started as a copy of {m.copiedFrom.name}.</Text>}
      </div>
      {m.mailpieceCount > 0 && (
        <Alert color="blue" title={`${m.mailpieceCount.toLocaleString('en-GB')} mailpiece${m.mailpieceCount === 1 ? ' has' : 's have'} been priced with this model`}>
          Their prices are kept as they were. Changes here only affect mail priced from now on. For a price change that starts on a date, add a new model that starts on that date instead.
        </Alert>
      )}
      {general && <Alert color="red" icon={<IconAlertCircle />}>{general}</Alert>}
      <Paper withBorder p="md">
        <Stack>
          <Group grow align="flex-start">
            <TextInput label="Name" value={form.name} onChange={(e) => setF('name', e.currentTarget.value)} error={errors['name']} />
            <TextInput label="First day" type="date" value={form.validFrom} onChange={(e) => setF('validFrom', e.currentTarget.value)} error={errors['validFrom']} />
            <TextInput label="Last day" type="date" description="Empty = until replaced" value={form.validTo} onChange={(e) => setF('validTo', e.currentTarget.value)} error={errors['validTo']} />
          </Group>
           <Switch label="Switched on" description={form.validFrom === '' ? 'Give it a first day before switching it on. A model with no dates never prices any mail.' : 'A model that is switched off never prices any mail.'} checked={form.isActive} onChange={(e) => setF('isActive', e.currentTarget.checked)} error={errors['isActive']} />
          <Textarea label="Comments" autosize minRows={2} value={form.comments} onChange={(e) => setF('comments', e.currentTarget.value)} error={errors['comments']} />
        </Stack>
      </Paper>

      {groups.map((g) => (
        <Paper withBorder key={g}>
          <Text fw={600} px="md" pt="sm">{g}</Text>
          <Table verticalSpacing="xs">
            <Table.Thead><Table.Tr><Table.Th>Charge</Table.Th><Table.Th>Cost (£)</Table.Th><Table.Th>Sell price (£)</Table.Th><Table.Th>Adjustment (£)</Table.Th><Table.Th>Customer pays (£)</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {charges.map((c, i) => c.group !== g ? null : (
                <Table.Tr key={c.code}>
                  <Table.Td>{c.label}</Table.Td>
                  <Table.Td>{sellOnly(g) ? <Text c="dimmed" size="sm">no cost</Text> : <Num label={`${c.label} cost`} value={c.cost} onChange={(v) => setCharge(i, { cost: v })} error={errors[`charges.${i}.cost`]} />}</Table.Td>
                  <Table.Td><Num label={`${c.label} sell price`} value={c.sellPrice} onChange={(v) => setCharge(i, { sellPrice: v })} error={errors[`charges.${i}.sellPrice`]} /></Table.Td>
                  <Table.Td>{sellOnly(g) ? <Text c="dimmed" size="sm">not adjusted</Text> : <Num allowNegative label={`${c.label} adjustment`} value={c.adjustment} onChange={(v) => setCharge(i, { adjustment: v })} error={errors[`charges.${i}.adjustment`]} />}</Table.Td>
                  <Table.Td fw={500}>{money(c.sellPrice + (sellOnly(g) ? 0 : c.adjustment))}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      ))}

      <Paper withBorder>
        <Group justify="space-between" px="md" pt="sm"><Text fw={600}>Outer envelopes</Text>
          <Select size="xs" w={320} placeholder="Add an envelope…" searchable value={addEnv} onChange={addEnvelope} nothingFoundMessage="No more envelopes"
            data={unused.map((s) => ({ value: String(s.id), label: `${s.code ?? 'no code'} – ${s.description}${s.size ? ` (${s.size})` : ''}` }))} leftSection={<IconPlus size={14} />} />
        </Group>
        <Table verticalSpacing="xs">
          <Table.Thead><Table.Tr><Table.Th>Envelope</Table.Th><Table.Th>Cost (£)</Table.Th><Table.Th>Sell price (£)</Table.Th><Table.Th>Adjustment (£)</Table.Th><Table.Th>Customer pays (£)</Table.Th><Table.Th /></Table.Tr></Table.Thead>
          <Table.Tbody>
            {envelopes.map((e, i) => (
              <Table.Tr key={e.stockItemId}>
                <Table.Td>{e.stockCode ?? 'no code'} – {e.description}{e.size ? ` (${e.size})` : ''}</Table.Td>
                <Table.Td><Num label={`${e.stockCode ?? e.description} cost`} value={e.cost} onChange={(v) => setEnv(i, { cost: v })} error={errors[`envelopes.${i}.cost`]} /></Table.Td>
                <Table.Td><Num label={`${e.stockCode ?? e.description} sell price`} value={e.sellPrice} onChange={(v) => setEnv(i, { sellPrice: v })} error={errors[`envelopes.${i}.sellPrice`]} /></Table.Td>
                <Table.Td><Num allowNegative label={`${e.stockCode ?? e.description} adjustment`} value={e.adjustment} onChange={(v) => setEnv(i, { adjustment: v })} error={errors[`envelopes.${i}.adjustment`]} /></Table.Td>
                <Table.Td fw={500}>{money(e.sellPrice + e.adjustment)}</Table.Td>
                <Table.Td><Group justify="flex-end"><Button size="xs" variant="subtle" color="red" aria-label={`Remove ${e.stockCode ?? e.description}`} onClick={() => { setEnvelopes((es) => es.filter((_, j) => j !== i)); touch(); }}><IconTrash size={14} /></Button></Group></Table.Td>
              </Table.Tr>
            ))}
            {envelopes.length === 0 && <Table.Tr><Table.Td colSpan={6}><Text c="dimmed" ta="center" py="md">No envelope prices. Mail in an envelope without a price is priced without it, and says so.</Text></Table.Td></Table.Tr>}
          </Table.Tbody>
        </Table>
      </Paper>

      <Paper withBorder>
        <Text fw={600} px="md" pt="sm">Postage</Text>
        <Text size="sm" c="dimmed" px="md">The cost and the suggested sell price come from the postal rates. Enter this customer&apos;s adjustment to the sell price, up or down.</Text>
        <Table verticalSpacing="xs">
          <Table.Thead><Table.Tr><Table.Th>Postal rate</Table.Th><Table.Th>Cost (£)</Table.Th><Table.Th>Suggested sell (£)</Table.Th><Table.Th>Adjustment (£)</Table.Th><Table.Th>Customer pays (£)</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>
            {postage.map((p, i) => (
              <Table.Tr key={p.postalRateId}>
                <Table.Td>{p.label}</Table.Td>
                <Table.Td>{p.suggestedCost === null ? '–' : money(p.suggestedCost)}</Table.Td>
                <Table.Td>{p.suggestedSell === null ? '–' : money(p.suggestedSell)}</Table.Td>
                <Table.Td><Num allowNegative label={`${p.label} adjustment`} value={p.adjustment} onChange={(v) => setPost(i, v)} error={errors[`postage.${i}.adjustment`]} /></Table.Td>
                <Table.Td fw={500}>{p.suggestedSell === null ? '–' : money(p.suggestedSell + p.adjustment)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Paper>

      <Group justify="space-between">
        <Button variant="subtle" color="red" leftSection={<IconTrash size={14} />} disabled={m.mailpieceCount > 0} onClick={() => setConfirmDelete(true)}>Delete model</Button>
        <Group>
          {m.mailpieceCount > 0 && <Text size="sm" c="dimmed">A model that has priced mail cannot be deleted. Switch it off instead.</Text>}
          <Button onClick={save} disabled={!dirty}>Save</Button>
        </Group>
      </Group>
      <Modal opened={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete costing model">
        <Stack>
          <Text>Delete &quot;{m.name}&quot; and all its prices? This cannot be undone.</Text>
          <Group justify="flex-end"><Button variant="default" onClick={() => setConfirmDelete(false)}>Cancel</Button><Button color="red" onClick={remove}>Delete</Button></Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
