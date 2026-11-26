import { Badge, Box, Button, Checkbox, Group, Paper, Table, Text } from '@mantine/core';
import { IconChevronRight } from '@tabler/icons-react';
import { ukDate } from '../dates';
import type { RecipientRow } from '../api/recipients';

/** The address under the name, in one line: the lines after the addressee, then the postcode (unless the lines already end with it). */
export const addressLine = (lines: string[], postcode: string): string => [...lines.slice(1), ...(postcode && !lines.includes(postcode) ? [postcode] : [])].join(', ');

/** A small labelled value in a header band. */
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Text size="xs" c="dimmed">{label}</Text><div style={{ fontSize: 'var(--mantine-font-size-sm)' }}>{children}</div></div>;
}

/** One mailpiece: a header band with what is common to the envelope (click it to show or hide the letters), then the letters in the order they go in. */
export function MailpieceCard({ row: r, open, onToggle, onPrice, showSequence = false, select }: {
  row: RecipientRow; open: boolean; onToggle: () => void; onPrice?: (mailpieceId: number) => void;
  /** A tick box in the header, to choose mailpieces (used when reviewing matches for the audit report). */
  select?: { checked: boolean; onChange: (checked: boolean) => void };
  /** Show the mailpiece's place in the batch's print order (used inside a batch). */
  showSequence?: boolean;
}) {
  const who = r.addressLines[0] ?? 'this recipient';
  return (
    <Paper withBorder data-testid="mailpiece" aria-label={`Mailpiece to ${who}`}>
      <Group role="button" tabIndex={0} aria-expanded={open} aria-label={`${open ? 'Hide' : 'Show'} the letters for ${who}`} justify="space-between" align="flex-start" wrap="nowrap" p="sm" bg="var(--mantine-color-default-hover)"
        style={{ cursor: 'pointer', borderBottom: open ? '1px solid var(--mantine-color-default-border)' : undefined }}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onToggle(); } }}>
        {select && <Checkbox checked={select.checked} onChange={(e) => select.onChange(e.currentTarget.checked)} onClick={(e) => e.stopPropagation()} aria-label={`Include the mailpiece to ${who} in the report`} mt={2} />}
        <IconChevronRight size={18} style={{ flex: 'none', marginTop: 4, transition: 'transform 150ms', transform: open ? 'rotate(90deg)' : undefined }} aria-hidden />
        <div style={{ minWidth: 0, flex: '1 1 18rem' }}>
          <Group gap="xs" wrap="nowrap">
            {showSequence && <Badge size="sm" variant="outline" aria-label={`Print order ${r.sequenceNumber ?? 'none'}`}>{r.sequenceNumber ?? '–'}</Badge>}
            <Text fw={600}>{r.addressLines[0]}</Text>{r.isCancelled && <Badge size="xs" color="red" variant="light">Cancelled</Badge>}
          </Group>
          <Text size="sm" c="dimmed">{addressLine(r.addressLines, r.postcode)}</Text>
        </div>
        <Group gap="xl" align="flex-start" wrap="wrap" style={{ flex: '2 1 24rem' }}>
          <Field label="Letters">{r.packs.length}</Field>
          <Field label="Released">{ukDate(r.releaseDate)}</Field>
          {!showSequence && <Field label="Job">{r.job}</Field>}
          {!showSequence && <Field label="Batch">{r.batchCode !== null ? <Group gap={6}><span>{r.batchCode}</span><Badge size="xs" variant="light">{r.batchStatus}</Badge></Group> : <Text size="sm" c="dimmed">Not in a batch</Text>}</Field>}
          <Field label="Sent from">{r.accountPath}{r.brand && <Text size="xs" c="dimmed">{r.brand}</Text>}</Field>
          <Field label="Invoiced to">{r.invoicingName ?? '–'}</Field>
        </Group>
        {onPrice && <Button size="compact-sm" variant="light" color={r.priceIncomplete ? 'orange' : undefined} title={r.priceIncomplete ? 'Part of the price is missing. Click to see what.' : undefined} aria-label={`Price of the mailpiece to ${who}`} onClick={(e) => { e.stopPropagation(); onPrice(r.mailpieceId); }}>{r.priceSell == null ? 'Not priced' : `£${r.priceSell.toFixed(2)}`}</Button>}
      </Group>
      {/* the letters in the envelope, in the order they go in: what is specific to each */}
      {open && <Box p="sm">
        <Table withTableBorder withColumnBorders aria-label="Letters in the envelope">
          <Table.Thead>
            <Table.Tr><Table.Th w={70}>Letter</Table.Th><Table.Th w={110}>Sequence</Table.Th><Table.Th w={130}>Pages</Table.Th><Table.Th w={110}>Released</Table.Th><Table.Th>Fields</Table.Th><Table.Th>GUIDs</Table.Th></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {r.packs.map((k) => (
              <Table.Tr key={k.packId} data-testid="pack">
                <Table.Td><Badge size="sm" variant="outline" aria-label={`Letter ${k.position}`}>{k.position}</Badge></Table.Td>
                <Table.Td>{k.sequence === null ? <Text size="sm" c="dimmed">Not in the sequence</Text> : k.sequence}</Table.Td>
                <Table.Td>{k.pageCount} {k.pageCount === 1 ? 'page' : 'pages'}<Text size="xs" c="dimmed">from page {k.startPage}</Text></Table.Td>
                <Table.Td>{ukDate(k.releaseDate)}</Table.Td>
                <Table.Td>{Object.keys(k.references).length === 0 ? <Text size="sm" c="dimmed">None</Text> : Object.entries(k.references).map(([key, v]) => <div key={key}><Text span size="xs" c="dimmed">{key}: </Text>{v}</div>)}</Table.Td>
                <Table.Td><Text size="xs" ff="monospace">{k.packGuid}</Text><Text size="xs" c="dimmed" ff="monospace">job {k.jobGuid}</Text></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Box>}
    </Paper>
  );
}
