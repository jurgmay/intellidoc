import { useState } from 'react';
import { Alert, Badge, Button, FileInput, Group, Modal, ScrollArea, Stack, Table, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconUpload } from '@tabler/icons-react';
import { importPostal, type BandAction, type ImportPlan } from '../api/postal';
import { ukDate } from '../dates';

const uk = (s: string): string => s.replace(/\d{4}-\d{2}-\d{2}/g, ukDate);
const money = (v: number | null): string => (v === null ? '—' : String(Math.round(v * 1e4) / 1e4));
const bandLabel = (min: number, max: number): string => (min <= 1 ? `up to ${max}g` : `${min}–${max}g`);
const ACTION: Record<BandAction, { label: string; color: string }> = {
  new: { label: 'New price', color: 'teal' }, change: { label: 'Changed', color: 'blue' }, update: { label: 'Replaced', color: 'violet' },
  unchanged: { label: 'No change', color: 'gray' }, blocked: { label: 'Blocked', color: 'red' },
};

/** Upload a price list, say when its prices start (and optionally end), check what it would do, then import. */
export function PostalImportModal({ today, onClose, onDone }: { today: string; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState('');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reset = () => { setPlan(null); setError(null); };

  const go = async (apply: boolean) => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const out = await importPostal(file, start, end || null, apply);
      if (!apply) { setPlan(out.plan); return; }
      const r = out.result!;
      notifications.show({ color: 'teal', title: 'Prices imported', message: `${r.newBands} new, ${r.changedBands} changed, ${r.updatedBands} replaced${r.newServices ? `, ${r.newServices} new service${r.newServices > 1 ? 's' : ''}` : ''}.` });
      onDone();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const c = plan?.counts;
  const shown = plan?.bands.filter((b) => b.action !== 'unchanged') ?? [];

  return (
    <Modal opened onClose={onClose} title="Import postal prices" size="xl">
      <Stack>
        <Text size="sm" c="dimmed">Upload an .xlsx or .csv price list. Providers and services in the file that do not exist yet are added. Where a service already has a price for the same weights on the start date, its old price ends the day before and the new one starts.</Text>
        <FileInput label="Price list" placeholder="Choose an .xlsx or .csv file" leftSection={<IconUpload size={14} />} accept=".xlsx,.csv" value={file} onChange={(f) => { setFile(f); reset(); }} clearable />
        <Group grow align="flex-start">
          <TextInput label="Start date" type="date" required value={start} onChange={(e) => { setStart(e.currentTarget.value); reset(); }} />
          <TextInput label="End date" type="date" description="Optional. Leave empty until replaced" value={end} onChange={(e) => { setEnd(e.currentTarget.value); reset(); }} />
        </Group>
        {error && <Alert color="red">{uk(error)}</Alert>}
        {plan && (
          <Stack gap="xs">
            {plan.errors.length > 0 && <Alert color="red" title="Fix these before importing"><Stack gap={2}>{plan.errors.slice(0, 30).map((e, i) => <Text size="sm" key={i}>{e.row ? `Row ${e.row}: ` : ''}{uk(e.message)}</Text>)}{plan.errors.length > 30 && <Text size="sm">…and {plan.errors.length - 30} more</Text>}</Stack></Alert>}
            {plan.warnings.length > 0 && <Alert color="yellow" title="Check these"><Stack gap={2}>{plan.warnings.slice(0, 20).map((e, i) => <Text size="sm" key={i}>{e.row ? `Row ${e.row}: ` : ''}{uk(e.message)}</Text>)}</Stack></Alert>}
            {plan.errors.length === 0 && c && (
              <Group gap="xs">
                <Badge color="teal" variant="light">{c.newBands} new</Badge><Badge color="blue" variant="light">{c.changedBands} changed</Badge><Badge color="violet" variant="light">{c.updatedBands} replaced</Badge>
                <Badge color="gray" variant="light">{c.unchangedBands} no change</Badge>{c.blockedBands > 0 && <Badge color="red" variant="light">{c.blockedBands} blocked</Badge>}
                {c.newProviders > 0 && <Badge color="orange" variant="light">{c.newProviders} new provider{c.newProviders > 1 ? 's' : ''}</Badge>}
                {c.newServices > 0 && <Badge color="orange" variant="light">{c.newServices} new service{c.newServices > 1 ? 's' : ''}</Badge>}
                {c.skippedRows > 0 && <Badge color="gray" variant="outline">{c.skippedRows} row{c.skippedRows > 1 ? 's' : ''} not current, skipped</Badge>}
              </Group>
            )}
            {plan.errors.length === 0 && !plan.canImport && c && c.blockedBands === 0 && <Text size="sm" c="dimmed">Nothing in the file would change anything.</Text>}
            {shown.length > 0 && (
              <ScrollArea.Autosize mah={320}>
                <Table verticalSpacing="xs" stickyHeader>
                  <Table.Thead><Table.Tr><Table.Th>Service</Table.Th><Table.Th>Weights</Table.Th><Table.Th ta="right">Cost</Table.Th><Table.Th ta="right">Sell</Table.Th><Table.Th>What happens</Table.Th></Table.Tr></Table.Thead>
                  <Table.Tbody>
                    {shown.map((b) => (
                      <Table.Tr key={b.key}>
                        <Table.Td>{b.provider} – {b.service} <Text span size="xs" c="dimmed">({b.format})</Text></Table.Td>
                        <Table.Td>{bandLabel(b.minWeightG, b.maxWeightG)}</Table.Td>
                        <Table.Td ta="right">{b.before && b.before.cost !== b.cost ? `${money(b.before.cost)} → ` : ''}{money(b.cost)}</Table.Td>
                        <Table.Td ta="right">{b.before && b.before.sellPrice !== b.sellPrice ? `${money(b.before.sellPrice)} → ` : ''}{money(b.sellPrice)}</Table.Td>
                        <Table.Td><Badge color={ACTION[b.action].color} variant="light">{ACTION[b.action].label}</Badge>{b.message && <Text size="xs" c={b.action === 'blocked' ? 'red' : 'dimmed'}>{uk(b.message)}</Text>}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ScrollArea.Autosize>
            )}
          </Stack>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          {!plan && <Button disabled={!file || !start} loading={busy} onClick={() => go(false)}>Check file</Button>}
          {plan && <Button disabled={!plan.canImport} loading={busy} onClick={() => go(true)}>Import prices</Button>}
        </Group>
      </Stack>
    </Modal>
  );
}
