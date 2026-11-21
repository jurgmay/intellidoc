import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, Group, Loader, Modal, Paper, Select, Stack, Switch, Table, Text, TextInput, Title } from '@mantine/core';
import { IconAlertCircle, IconPlus } from '@tabler/icons-react';
import {
  changePrices, createProvider, createRate, createService, deleteProvider, deleteRate, deleteService, getPostal, getPostalHistory, renameProvider, saveRate, saveService,
  type PostalHistoryRow, type PostalOverview, type PostalProvider, type PostalRate, type PostalService, type RateInput, type ServiceInput,
} from '../api/postal';
import { run } from './customer/shared';

const bandLabel = (r: { minWeightG: number; maxWeightG: number }): string => (r.minWeightG <= 1 ? `up to ${r.maxWeightG}g` : `${r.minWeightG}–${r.maxWeightG}g`);
const money = (v: number | null): string => { if (v === null) return '—'; const t = String(Math.round(v * 1e4) / 1e4); return /\.\d$/.test(t) ? `${t}0` : /\./.test(t) ? t : `${t}.00`; };
const STATUS = { current: { label: 'In force', color: 'teal' }, planned: { label: 'Starts later', color: 'blue' }, ended: { label: 'Ended', color: 'gray' } } as const;
const orNull = (s: string): string | null => (s.trim() === '' ? null : s.trim());

/** A price box that keeps what is typed, and reports a number, or null when empty. */
function PriceBox({ label, value, onChange, error }: { label: string; value: number | null; onChange: (v: number | null) => void; error?: string }) {
  const [text, setText] = useState(value === null ? '' : String(value));
  return (
    <TextInput label={label} inputMode="decimal" value={text} error={error} placeholder="not set"
      onChange={(e) => { const t = e.currentTarget.value; setText(t); onChange(t.trim() === '' ? null : Number(t)); }} />
  );
}
const asNumber = (s: string): number => (s.trim() === '' ? NaN : Number(s));

type Dialog =
  | { kind: 'provider'; provider: PostalProvider | null }
  | { kind: 'service'; provider: PostalProvider; service: PostalService | null }
  | { kind: 'rate'; service: PostalService; rate: PostalRate | null }
  | { kind: 'change'; service: PostalService }
  | { kind: 'delete'; what: 'provider' | 'service' | 'rate'; id: number; label: string };

function ProviderDialog({ d, onClose, onDone }: { d: Extract<Dialog, { kind: 'provider' }>; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(d.provider?.name ?? ''); const [err, setErr] = useState<Record<string, string>>({}); const [msg, setMsg] = useState<string | null>(null);
  const save = async () => {
    const res = await run(() => (d.provider ? renameProvider(d.provider.id, name) : createProvider(name)), d.provider ? 'Provider renamed' : 'Provider added');
    if (res.ok) onDone(); else { setErr(res.fieldErrors ?? {}); setMsg(res.fieldErrors ? null : res.message ?? null); }
  };
  return (
    <Modal opened onClose={onClose} title={d.provider ? 'Rename provider' : 'New provider'}>
      <Stack>{msg && <Alert color="red">{msg}</Alert>}
        <TextInput label="Name" value={name} onChange={(e) => setName(e.currentTarget.value)} error={err['name']} data-autofocus />
        <Group justify="flex-end"><Button variant="default" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></Group></Stack>
    </Modal>
  );
}

function ServiceDialog({ d, formats, onClose, onDone }: { d: Extract<Dialog, { kind: 'service' }>; formats: PostalOverview['formats']; onClose: () => void; onDone: () => void }) {
  const s = d.service;
  const [f, setF] = useState({ name: s?.name ?? '', formatId: s ? String(s.formatId) : null as string | null, serviceCode: s?.serviceCode ?? '', isSignedFor: s?.isSignedFor ?? false, isTracked: s?.isTracked ?? false, isRecorded: s?.isRecorded ?? false });
  const [err, setErr] = useState<Record<string, string>>({}); const [msg, setMsg] = useState<string | null>(null);
  const save = async () => {
    const body: ServiceInput = { formatId: f.formatId === null ? 0 : Number(f.formatId), name: f.name, serviceCode: orNull(f.serviceCode), isSignedFor: f.isSignedFor, isTracked: f.isTracked, isRecorded: f.isRecorded };
    const res = await run(() => (s ? saveService(s.id, body) : createService(d.provider.id, body)), s ? 'Service saved' : 'Service added');
    if (res.ok) onDone(); else { setErr(res.fieldErrors ?? {}); setMsg(res.fieldErrors ? null : res.message ?? null); }
  };
  return (
    <Modal opened onClose={onClose} title={s ? `Edit ${s.name}` : `New service for ${d.provider.name}`}>
      <Stack>{msg && <Alert color="red">{msg}</Alert>}
        <TextInput label="Name" value={f.name} onChange={(e) => { const v = e.currentTarget.value; setF((x) => ({ ...x, name: v })); }} error={err['name']} data-autofocus />
        <Select label="Format" allowDeselect={false} data={formats.map((x) => ({ value: String(x.id), label: x.name }))} value={f.formatId} onChange={(v) => setF((x) => ({ ...x, formatId: v }))} error={err['formatId']} />
        <TextInput label="Service code" description="The provider's own code, if it has one" value={f.serviceCode} onChange={(e) => { const v = e.currentTarget.value; setF((x) => ({ ...x, serviceCode: v })); }} error={err['serviceCode']} />
        <Group>
          <Switch label="Signed for" checked={f.isSignedFor} onChange={(e) => { const v = e.currentTarget.checked; setF((x) => ({ ...x, isSignedFor: v })); }} />
          <Switch label="Tracked" checked={f.isTracked} onChange={(e) => { const v = e.currentTarget.checked; setF((x) => ({ ...x, isTracked: v })); }} />
          <Switch label="Recorded" checked={f.isRecorded} onChange={(e) => { const v = e.currentTarget.checked; setF((x) => ({ ...x, isRecorded: v })); }} />
        </Group>
        <Group justify="flex-end"><Button variant="default" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></Group></Stack>
    </Modal>
  );
}

function RateDialog({ d, today, onClose, onDone }: { d: Extract<Dialog, { kind: 'rate' }>; today: string; onClose: () => void; onDone: () => void }) {
  const r = d.rate; const locked = !!r && r.usedBy > 0;
  const [f, setF] = useState({ min: r ? String(r.minWeightG) : '0', max: r ? String(r.maxWeightG) : '', from: r?.validFrom ?? today, to: r?.validTo ?? '', cost: r?.cost ?? null as number | null, sell: r?.sellPrice ?? null as number | null });
  const [err, setErr] = useState<Record<string, string>>({}); const [msg, setMsg] = useState<string | null>(null);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => { const v = e.currentTarget.value; setF((x) => ({ ...x, [k]: v })); };
  const save = async () => {
    const body: RateInput = { minWeightG: asNumber(f.min), maxWeightG: asNumber(f.max), validFrom: f.from, validTo: orNull(f.to), cost: f.cost, sellPrice: f.sell };
    const res = await run(() => (r ? saveRate(r.id, body) : createRate(d.service.id, body)), r ? 'Price saved' : 'Price added');
    if (res.ok) onDone(); else { setErr(res.fieldErrors ?? {}); setMsg(res.fieldErrors ? null : res.message ?? null); }
  };
  return (
    <Modal opened onClose={onClose} title={r ? `Edit ${bandLabel(r)}` : `New weight band for ${d.service.name}`}>
      <Stack>{msg && <Alert color="red">{msg}</Alert>}
        {locked && <Alert color="blue">This price is in use, so its weights and first day are fixed. You can change the prices and give it a last day. To change prices from a date, use &ldquo;Change prices from a date&rdquo;.</Alert>}
        <Group grow align="flex-start">
          <TextInput label="From weight (g)" inputMode="numeric" value={f.min} onChange={set('min')} error={err['minWeightG']} disabled={locked} />
          <TextInput label="Up to weight (g)" inputMode="numeric" value={f.max} onChange={set('max')} error={err['maxWeightG']} disabled={locked} />
        </Group>
        <Group grow align="flex-start">
          <TextInput label="First day" type="date" value={f.from} onChange={set('from')} error={err['validFrom']} disabled={locked} />
          <TextInput label="Last day" type="date" description="Leave empty until replaced" value={f.to} onChange={set('to')} error={err['validTo']} />
        </Group>
        <Group grow align="flex-start">
          <PriceBox label="Cost" value={f.cost} onChange={(v) => setF((x) => ({ ...x, cost: v }))} error={err['cost']} />
          <PriceBox label="Sell price" value={f.sell} onChange={(v) => setF((x) => ({ ...x, sell: v }))} error={err['sellPrice']} />
        </Group>
        <Group justify="flex-end"><Button variant="default" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></Group></Stack>
    </Modal>
  );
}

function ChangeDialog({ d, today, onClose, onDone }: { d: Extract<Dialog, { kind: 'change' }>; today: string; onClose: () => void; onDone: () => void }) {
  // A band can be changed from a date when its in-force row has no later row waiting.
  const rows = d.service.rates.filter((r) => r.status === 'current' && !d.service.rates.some((o) => o !== r && o.minWeightG === r.minWeightG && o.maxWeightG === r.maxWeightG && o.validFrom > r.validFrom));
  const [from, setFrom] = useState(today);
  const [vals, setVals] = useState<Record<number, { cost: number | null; sell: number | null }>>(Object.fromEntries(rows.map((r) => [r.id, { cost: r.cost, sell: r.sellPrice }])));
  const [err, setErr] = useState<Record<string, string>>({}); const [msg, setMsg] = useState<string | null>(null);
  const changed = rows.filter((r) => vals[r.id]!.cost !== r.cost || vals[r.id]!.sell !== r.sellPrice);
  const save = async () => {
    const res = await run(() => changePrices(d.service.id, { effectiveFrom: from, changes: changed.map((r) => ({ rateId: r.id, cost: vals[r.id]!.cost, sellPrice: vals[r.id]!.sell })) }), 'New prices saved');
    if (res.ok) onDone(); else { setErr(res.fieldErrors ?? {}); setMsg(res.fieldErrors ? null : res.message ?? null); }
  };
  return (
    <Modal opened onClose={onClose} size="lg" title={`Change prices for ${d.service.name}`}>
      <Stack>{msg && <Alert color="red">{msg}</Alert>}
        <Text size="sm" c="dimmed">The old price ends the day before and the new one starts on this day. Mail priced earlier keeps the old price. Envelope settings and customer price adjustments carry over.</Text>
        <TextInput label="New prices start on" type="date" min={today} value={from} onChange={(e) => setFrom(e.currentTarget.value)} error={err['effectiveFrom']} maw={220} />
        {rows.length === 0 ? <Text c="dimmed">There are no prices in force to change.</Text> : (
          <Table verticalSpacing="xs">
            <Table.Thead><Table.Tr><Table.Th>Weights</Table.Th><Table.Th>Cost now</Table.Th><Table.Th>New cost</Table.Th><Table.Th>Sell now</Table.Th><Table.Th>New sell price</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>
              {rows.map((r) => (
                <Table.Tr key={r.id}>
                  <Table.Td>{bandLabel(r)}</Table.Td><Table.Td>{money(r.cost)}</Table.Td>
                  <Table.Td><PriceBox label="" value={vals[r.id]!.cost} error={err[`changes.${changed.indexOf(r)}.cost`]} onChange={(v) => setVals((x) => ({ ...x, [r.id]: { ...x[r.id]!, cost: v } }))} /></Table.Td>
                  <Table.Td>{money(r.sellPrice)}</Table.Td>
                  <Table.Td><PriceBox label="" value={vals[r.id]!.sell} error={err[`changes.${changed.indexOf(r)}.sellPrice`]} onChange={(v) => setVals((x) => ({ ...x, [r.id]: { ...x[r.id]!, sell: v } }))} /></Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
        {err['changes'] && <Text c="red" size="sm">{err['changes']}</Text>}
        <Group justify="space-between"><Text size="sm" c="dimmed">{changed.length} price{changed.length === 1 ? '' : 's'} changed</Text>
          <Group><Button variant="default" onClick={onClose}>Cancel</Button><Button disabled={changed.length === 0} onClick={save}>Save new prices</Button></Group></Group>
      </Stack>
    </Modal>
  );
}

function DeleteDialog({ d, onClose, onDone }: { d: Extract<Dialog, { kind: 'delete' }>; onClose: () => void; onDone: () => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  const go = async () => {
    const fn = d.what === 'provider' ? deleteProvider : d.what === 'service' ? deleteService : deleteRate;
    const res = await run(() => fn(d.id), 'Deleted');
    if (res.ok) onDone(); else setMsg(res.message ?? 'Not deleted');
  };
  return (
    <Modal opened onClose={onClose} title="Delete">
      <Stack>{msg && <Alert color="red">{msg}</Alert>}
        <Text>Delete {d.label}? This cannot be undone.</Text>
        <Group justify="flex-end"><Button variant="default" onClick={onClose}>Cancel</Button><Button color="red" onClick={go}>Delete</Button></Group></Stack>
    </Modal>
  );
}

function ServiceBlock({ s, provider, showEnded, open }: { s: PostalService; provider: PostalProvider; showEnded: boolean; open: (d: Dialog) => void }) {
  const rates = s.rates.filter((r) => showEnded || r.status !== 'ended');
  const live = s.rates.some((r) => r.status !== 'ended');
  return (
    <Paper withBorder>
      <Group justify="space-between" p="md" pb="xs">
        <Group gap="xs">
          <Text fw={600}>{s.name}</Text><Badge variant="light" color="gray">{s.formatName}</Badge>
          {s.serviceCode && <Badge variant="outline" color="gray">{s.serviceCode}</Badge>}
          {s.isTracked && <Badge variant="light">Tracked</Badge>}{s.isSignedFor && <Badge variant="light">Signed for</Badge>}{s.isRecorded && <Badge variant="light">Recorded</Badge>}
          {s.rates.length > 0 && !live && <Badge color="gray">Switched off</Badge>}
        </Group>
        <Group gap="xs">
          <Button size="xs" variant="default" onClick={() => open({ kind: 'change', service: s })}>Change prices from a date</Button>
          <Button size="xs" variant="default" onClick={() => open({ kind: 'rate', service: s, rate: null })}>Add weight band</Button>
          <Button size="xs" variant="subtle" onClick={() => open({ kind: 'service', provider, service: s })}>Edit service</Button>
          <Button size="xs" variant="subtle" color="red" onClick={() => open({ kind: 'delete', what: 'service', id: s.id, label: `the service ${provider.name} – ${s.name}` })}>Delete</Button>
        </Group>
      </Group>
      <Table verticalSpacing="xs">
        <Table.Thead><Table.Tr><Table.Th>Weights</Table.Th><Table.Th>Applies</Table.Th><Table.Th ta="right">Cost</Table.Th><Table.Th ta="right">Sell price</Table.Th><Table.Th>Status</Table.Th><Table.Th>In use</Table.Th><Table.Th /></Table.Tr></Table.Thead>
        <Table.Tbody>
          {rates.map((r) => (
            <Table.Tr key={r.id}>
              <Table.Td>{bandLabel(r)}</Table.Td><Table.Td>{r.validFrom} to {r.validTo ?? 'until replaced'}</Table.Td>
              <Table.Td ta="right">{money(r.cost)}</Table.Td><Table.Td ta="right">{money(r.sellPrice)}</Table.Td>
              <Table.Td><Badge variant="light" color={STATUS[r.status].color}>{STATUS[r.status].label}</Badge></Table.Td>
              <Table.Td>{r.usedBy === 0 ? <Text span c="dimmed">No</Text> : 'Yes'}</Table.Td>
              <Table.Td><Group gap="xs" justify="flex-end">
                <Button size="xs" variant="default" onClick={() => open({ kind: 'rate', service: s, rate: r })}>Edit</Button>
                <Button size="xs" variant="subtle" color="red" disabled={r.usedBy > 0} title={r.usedBy > 0 ? 'In use. Give it a last day instead.' : undefined}
                  onClick={() => open({ kind: 'delete', what: 'rate', id: r.id, label: `the ${bandLabel(r)} price from ${r.validFrom}` })}>Delete</Button>
              </Group></Table.Td>
            </Table.Tr>
          ))}
          {rates.length === 0 && <Table.Tr><Table.Td colSpan={7}><Text c="dimmed" ta="center" py="sm">{s.rates.length ? 'All prices have ended. Show ended prices to see them.' : 'No prices yet.'}</Text></Table.Td></Table.Tr>}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}

export function PostalRatesTab({ onChanged }: { onChanged?: () => void }) {
  const [o, setO] = useState<PostalOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showEnded, setShowEnded] = useState(false);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [history, setHistory] = useState<PostalHistoryRow[]>([]);
  const load = useCallback(async () => { setO(await getPostal()); setHistory((await getPostalHistory()).rows); }, []);
  useEffect(() => { load().catch((e: Error) => setError(e.message)); }, [load]);
  if (error) return <Alert color="red" icon={<IconAlertCircle />} title="Could not load the postal rates">{error}</Alert>;
  if (!o) return <Loader />;
  const done = () => { setDialog(null); load().catch((e: Error) => setError(e.message)); onChanged?.(); };
  return (
    <Stack>
      <Group justify="space-between">
        <Text size="sm" c="dimmed" maw={640}>Postage prices by provider, service and weight. To change a price, use &ldquo;Change prices from a date&rdquo;: mail already priced keeps its price. Prices that are in use cannot be deleted, so give them a last day instead.</Text>
        <Group>
          <Switch label="Show ended prices" checked={showEnded} onChange={(e) => setShowEnded(e.currentTarget.checked)} />
          <Button leftSection={<IconPlus size={14} />} onClick={() => setDialog({ kind: 'provider', provider: null })}>New provider</Button>
        </Group>
      </Group>
      {o.providers.map((p) => (
        <Stack key={p.id} gap="sm">
          <Group justify="space-between">
            <Title order={4} c="brand.6">{p.name}</Title>
            <Group gap="xs">
              <Button size="xs" variant="default" leftSection={<IconPlus size={14} />} onClick={() => setDialog({ kind: 'service', provider: p, service: null })}>New service</Button>
              <Button size="xs" variant="subtle" onClick={() => setDialog({ kind: 'provider', provider: p })}>Rename</Button>
              <Button size="xs" variant="subtle" color="red" onClick={() => setDialog({ kind: 'delete', what: 'provider', id: p.id, label: `the provider ${p.name}` })}>Delete</Button>
            </Group>
          </Group>
          {p.services.map((s) => <ServiceBlock key={s.id} s={s} provider={p} showEnded={showEnded} open={setDialog} />)}
          {p.services.length === 0 && <Text c="dimmed">No services yet.</Text>}
        </Stack>
      ))}
      {o.providers.length === 0 && <Text c="dimmed" ta="center" py="lg">No postal providers yet.</Text>}
      {history.length > 0 && (
        <Paper withBorder p="md" mt="md">
          <Text fw={600} mb="xs">Recent changes</Text>
          <Table verticalSpacing="xs">
            <Table.Tbody>
              {history.slice(0, 15).map((h) => (
                <Table.Tr key={h.id}><Table.Td w={170}>{new Date(h.changedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</Table.Td><Table.Td w={140}>{h.changedBy}</Table.Td><Table.Td>{h.summary}</Table.Td></Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      )}
      {dialog?.kind === 'provider' && <ProviderDialog d={dialog} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === 'service' && <ServiceDialog d={dialog} formats={o.formats} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === 'rate' && <RateDialog d={dialog} today={o.today} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === 'change' && <ChangeDialog d={dialog} today={o.today} onClose={() => setDialog(null)} onDone={done} />}
      {dialog?.kind === 'delete' && <DeleteDialog d={dialog} onClose={() => setDialog(null)} onDone={done} />}
    </Stack>
  );
}
