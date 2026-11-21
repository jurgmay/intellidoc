import type { ReactNode } from 'react';
import { Paper, Select, Table, Text } from '@mantine/core';
import { setInheritance, type CustomerDetail, type InheritMode, type SettingKey } from '../../api/customers';
import { run } from './shared';

interface Props {
  detail: CustomerDetail;
  setting: SettingKey;
  label: string;
  /** What the group is called in the choices, for example "list" or "settings". */
  noun: string;
  /** What taking the parent's means for this group, shown under the choice. */
  hint: string;
  reload: () => Promise<void>;
  /** Shown under the choice. */
  children?: ReactNode;
}

const changedText = (label: string): string => { const what = label.replace(/^Where the /, '').replace(/ comes? from$/, ''); return `${what.charAt(0).toUpperCase()}${what.slice(1)} changed`; };

/** The choice every group of settings has: its own, the parent's, or the parent's plus its own. */
export function ModeSelect({ detail, setting, label, noun, hint, reload, children }: Props) {
  const mode = detail.modes[setting];
  const hasParent = detail.parent !== null;
  const change = async (m: string | null) => {
    if (m === null || m === mode) return;
    const res = await run(() => setInheritance(detail.id, setting, m as InheritMode), changedText(label));
    if (res.ok) await reload();
  };
  return (
    <Paper withBorder p="md">
      <Select label={label} allowDeselect={false} disabled={!hasParent} maw={420} value={mode} onChange={change}
        data={[{ value: 'OWN', label: `This customer's own ${noun}` }, { value: 'INHERIT', label: `The parent's ${noun}` }, { value: 'EXTEND', label: `The parent's ${noun} plus this customer's own` }]}
        description={hasParent ? `The parent is ${detail.parent!.name} (${detail.parent!.code}). ${hint}` : 'Choose a parent customer on the Details tab to take these from it.'} />
      {children}
    </Paper>
  );
}

/** A read-only table of what comes from the parents, with where each row comes from. */
export function FromParent({ head, rows }: { head: string[]; rows: { key: string; cells: ReactNode[]; from: string }[] }) {
  if (rows.length === 0) return null;
  return (
    <Paper withBorder>
      <Text fw={600} px="md" pt="sm">From the parent</Text>
      <Table verticalSpacing="sm" c="dimmed">
        <Table.Thead><Table.Tr>{head.map((h) => <Table.Th key={h}>{h}</Table.Th>)}<Table.Th>From</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {rows.map((r) => <Table.Tr key={r.key}>{r.cells.map((c, i) => <Table.Td key={i}>{c}</Table.Td>)}<Table.Td>{r.from}</Table.Td></Table.Tr>)}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}
