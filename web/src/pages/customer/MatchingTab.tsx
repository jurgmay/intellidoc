import { useState } from 'react';
import { ActionIcon, Autocomplete, Button, Group, Paper, Select, Stack, Switch, Table, Text, TextInput, Title } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { saveMatchRules, saveSequenceRules, type MatchRule, type SequenceRule } from '../../api/customers';
import { FromParent, ModeSelect } from './ModeSelect';
import { orNull, run, type TabProps } from './shared';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function MatchingTab({ detail, lookups, reload, patchDetails }: TabProps) {
  const lockedM = detail.modes.matching === 'INHERIT', lockedQ = detail.modes.sequence === 'INHERIT';
  const inhM = detail.inherited.matching, inhQ = detail.inherited.sequence;
  const seqKeyShown = lockedQ ? inhQ?.key ?? null : detail.packSequenceKey;
  const [matching, setMatching] = useState(detail.flags.isAddressMatching);
  const [rules, setRules] = useState<MatchRule[]>(detail.matchRules);
  const [ruleErrors, setRuleErrors] = useState<Record<string, string>>({});
  const [batchKey, setBatchKey] = useState(detail.batchingKey ?? '');
  const [seqKey, setSeqKey] = useState(detail.packSequenceKey ?? '');
  const [seq, setSeq] = useState<SequenceRule[]>(detail.sequenceRules);
  const [seqErrors, setSeqErrors] = useState<Record<string, string>>({});

  const saveMatching = async () => {
    try { await patchDetails({ flags: { ...detail.flags, isAddressMatching: matching } }); } catch { /* shown by the page */ }
  };
  const saveRules = async () => {
    const res = await run(() => saveMatchRules(detail.id, rules.map((r) => ({ ...r, key: r.key.trim(), value: r.isInclude ? null : orNull(r.value ?? '') }))), 'Matching rules saved');
    if (res.ok) await reload(); else setRuleErrors(res.fieldErrors ?? {});
  };
  const saveKeys = async () => { try { await patchDetails({ batchingKey: orNull(batchKey), packSequenceKey: orNull(seqKey) }); } catch { /* shown by the page */ } };
  const saveSeq = async () => {
    const res = await run(() => saveSequenceRules(detail.id, seq.map((r) => ({ value: r.value.trim(), number: Number(r.number) }))), 'Pack sequence saved');
    if (res.ok) await reload(); else setSeqErrors(res.fieldErrors ?? {});
  };
  const setRule = (i: number, patch: Partial<MatchRule>) => setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const setSeqRow = (i: number, patch: Partial<SequenceRule>) => setSeq((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Stack gap="lg">
      <ModeSelect detail={detail} setting="matching" label="Where the matching settings come from" noun="settings" reload={reload}
        hint="Covers address matching on or off, the matching rules and the batching key. With the parent's plus this customer's own, the rules add up; address matching and the batching key stay this customer's own.">
        {lockedM && <Text size="sm" c="dimmed" mt="sm">Address matching, the matching rules and the batching key below are the parent&apos;s and cannot be changed here.</Text>}
      </ModeSelect>
      <ModeSelect detail={detail} setting="sequence" label="Where the pack order comes from" noun="settings" reload={reload}
        hint="Covers the pack sequence key and its order. With the parent's plus this customer's own, the order adds up; the key stays this customer's own. A number set here for the same value replaces the parent's.">
        {lockedQ && <Text size="sm" c="dimmed" mt="sm">The pack sequence key and order below are the parent&apos;s and cannot be changed here.</Text>}
      </ModeSelect>
      <Paper withBorder p="lg">
        <Title order={4} mb={4} c="brand.6">Address matching</Title>
        <Text size="sm" c="dimmed" mb="md">
          When on, packs in a file for the same recipient at the same address share one envelope. The recipient&apos;s name is part of the match, so two different people never share an envelope, and anonymous addressees (for example &quot;The Occupier&quot;) never merge. A pack with an IMPORTANT NOTICE ENCLOSED line is never merged. Batches never combine across envelopes or brands.
        </Text>
        <Group justify="space-between">
          <Switch label="Match addresses for this customer" disabled={lockedM} checked={lockedM ? inhM?.isAddressMatching ?? false : matching} onChange={(e) => setMatching(e.currentTarget.checked)} />
          <Button onClick={saveMatching} disabled={lockedM || matching === detail.flags.isAddressMatching}>Save</Button>
        </Group>
      </Paper>

      <Paper withBorder p="lg">
        <Title order={4} mb={4} c="brand.6">Matching rules</Title>
        <Text size="sm" c="dimmed" mb="md">
          <b>Include</b> adds a passthrough value to the match, so packs only merge when that value is the same. <b>Exclude</b> stops a pack with a given value from merging at all, so it always gets its own envelope.
        </Text>
        {lockedM ? <Text c="dimmed" size="sm">This customer takes the parent&apos;s rules, shown below.</Text> : (<>
        <Stack gap="xs">
          {rules.map((r, i) => (
            <Group key={i} align="flex-start" gap="sm">
              <Select aria-label={`Rule ${i + 1} type`} w={240} allowDeselect={false} data={[{ value: 'include', label: 'Include in match' }, { value: 'exclude', label: 'Exclude from matching' }]}
                value={r.isInclude ? 'include' : 'exclude'} onChange={(v) => setRule(i, { isInclude: v === 'include' })} />
              <Autocomplete aria-label={`Rule ${i + 1} passthrough key`} placeholder="Passthrough key" w={220} data={lookups.passthroughKeys} value={r.key} onChange={(v) => setRule(i, { key: v })} />
              <TextInput aria-label={`Rule ${i + 1} value`} placeholder={r.isInclude ? 'Not needed' : 'Value that excludes a pack'} w={260} disabled={r.isInclude} value={r.value ?? ''} onChange={(e) => setRule(i, { value: e.currentTarget.value })} />
              <ActionIcon variant="subtle" color="red" mt={4} aria-label={`Remove rule ${i + 1}`} onClick={() => setRules((rs) => rs.filter((_, j) => j !== i))}><IconTrash size={16} /></ActionIcon>
              {ruleErrors[`rules.${i}`] && <Text c="red" size="sm" w="100%">{ruleErrors[`rules.${i}`]}</Text>}
            </Group>
          ))}
          {rules.length === 0 && <Text c="dimmed" size="sm">No rules. Packs merge on name and address alone.</Text>}
        </Stack>
        <Group justify="space-between" mt="md">
          <Button variant="default" leftSection={<IconPlus size={16} />} onClick={() => setRules([...rules, { isInclude: true, key: '', value: null }])}>Add rule</Button>
          <Button onClick={saveRules} disabled={same(rules, detail.matchRules)}>Save rules</Button>
        </Group>
        </>)}
      </Paper>
      <FromParent head={['Rule']} rows={detail.inherited.matchRules.map((r, i) => ({ key: `m${i}`, cells: [r.isInclude ? `Include ${r.key} in the match` : `Exclude ${r.key} = "${r.value ?? ''}"`], from: r.from.name }))} />

      <Paper withBorder p="lg">
        <Title order={4} mb={4} c="brand.6">Batching and pack order</Title>
        <Text size="sm" c="dimmed" mb="md">
          A batch is one customer, outer envelope, postal service, format, brand, inserts, batching key, paper and route. The batching key is a passthrough key from the XML that splits batches further (for example Department). The pack sequence key decides the order of packs inside a merged envelope.
        </Text>
        <Group align="flex-start" grow>
          <Autocomplete label="Batching key" description="Leave empty to batch without one." disabled={lockedM} data={lookups.passthroughKeys} value={lockedM ? inhM?.batchingKey ?? '' : batchKey} onChange={setBatchKey} />
          <Autocomplete label="Pack sequence key" disabled={lockedQ} data={lookups.passthroughKeys} value={lockedQ ? inhQ?.key ?? '' : seqKey} onChange={setSeqKey} />
        </Group>
        <Group justify="flex-end" mt="md"><Button onClick={saveKeys} disabled={(lockedM && lockedQ) || (orNull(batchKey) === detail.batchingKey && orNull(seqKey) === detail.packSequenceKey)}>Save keys</Button></Group>
      </Paper>

      <Paper withBorder p="lg">
        <Title order={4} mb={4} c="brand.6">Pack sequence</Title>
        <Text size="sm" c="dimmed" mb="md">
          The order of packs inside a merged envelope, by the value of the pack sequence key{seqKeyShown ? ` (${seqKeyShown})` : ''}.
        </Text>
        {lockedQ ? <Text c="dimmed" size="sm">This customer takes the parent&apos;s order, shown below.</Text> : (<>
        <Table verticalSpacing="xs">
          <Table.Tbody>
            {seq.map((r, i) => (
              <Table.Tr key={i}>
                <Table.Td w={110}><TextInput aria-label={`Position ${i + 1}`} type="number" min={1} value={r.number} onChange={(e) => setSeqRow(i, { number: Number(e.currentTarget.value) })} /></Table.Td>
                <Table.Td><TextInput aria-label={`Value ${i + 1}`} placeholder="Value" value={r.value} onChange={(e) => setSeqRow(i, { value: e.currentTarget.value })} error={seqErrors[`rules.${i}`]} /></Table.Td>
                <Table.Td w={50}><ActionIcon variant="subtle" color="red" aria-label={`Remove row ${i + 1}`} onClick={() => setSeq((rs) => rs.filter((_, j) => j !== i))}><IconTrash size={16} /></ActionIcon></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        {seq.length === 0 && <Text c="dimmed" size="sm">No order set.</Text>}
        <Group justify="space-between" mt="md">
          <Button variant="default" leftSection={<IconPlus size={16} />} onClick={() => setSeq([...seq, { value: '', number: Math.max(0, ...seq.map((s) => Number(s.number) || 0)) + 1 }])}>Add row</Button>
          <Button onClick={saveSeq} disabled={same(seq, detail.sequenceRules)}>Save order</Button>
        </Group>
        </>)}
      </Paper>
      <FromParent head={['Position', 'Value']} rows={detail.inherited.sequenceRules.map((r) => ({ key: r.value, cells: [r.number, r.value], from: r.from.name }))} />
    </Stack>
  );
}
