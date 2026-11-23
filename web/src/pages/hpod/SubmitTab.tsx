import { useState } from 'react';
import { Alert, Button, Checkbox, FileInput, Group, Select, Stack, Table, Text, Textarea, TextInput, Title } from '@mantine/core';
import { IconCircleCheck } from '@tabler/icons-react';
import { fileToBase64, submitDocument, type HpodResult, type SubmitOutcome } from '../../api/hpod';
import { ConfirmModal, ErrorAlert, useAction, type Run } from './shared';

interface Opt { guid: string; name: string; isDefault: boolean }
/** Which list of the configuration feeds which print option. The names are matched loosely, as the lists are named by H-POD. */
const FIELDS = [
  { key: 'paper', label: 'Paper', match: /paper/i }, { key: 'envelope', label: 'Envelope', match: /envelope/i }, { key: 'ink', label: 'Ink', match: /\bink/i },
  { key: 'duplex', label: 'Duplex', match: /duplex/i }, { key: 'packMode', label: 'Pack mode', match: /pack ?mode/i }, { key: 'delivery', label: 'Delivery', match: /deliver/i },
] as const;
type FieldKey = (typeof FIELDS)[number]['key'];

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const optionsIn = (config: unknown, match: RegExp): Opt[] => {
  if (!config || typeof config !== 'object') return [];
  for (const [k, v] of Object.entries(config as Record<string, unknown>)) {
    if (!match.test(k) || !Array.isArray(v)) continue;
    const list = v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof (x as { guid?: unknown }).guid === 'string');
    if (list.length) return list.map((x) => ({ guid: String(x['guid']), name: String(x['name'] ?? x['guid']), isDefault: x['isDefault'] === true }));
  }
  return [];
};

/** Guided submission: load the account's print options, choose them, pick a PDF, and send it (start, parts, commit). */
export function SubmitTab({ run, onTrack }: { run: Run; onTrack: (jobGuid: string) => void }) {
  const [options, setOptions] = useState<Record<FieldKey, Opt[]>>({ paper: [], envelope: [], ink: [], duplex: [], packMode: [], delivery: [] });
  const [chosen, setChosen] = useState<Partial<Record<FieldKey, string>>>({});
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState('Demo letter');
  const [clientId, setClientId] = useState('demo-1');
  const [file, setFile] = useState<File | null>(null);
  const [extract, setExtract] = useState(true);
  const [abort, setAbort] = useState(true);
  const [address, setAddress] = useState('');
  const [postcode, setPostcode] = useState('');
  const [extraText, setExtraText] = useState('');
  const [confirming, setConfirming] = useState(false);
  const load = useAction<HpodResult>();
  const sub = useAction<SubmitOutcome>();

  const loadConfig = () => void load.run(async () => {
    const r = await run({ operation: 'printConfiguration' });
    const next = { paper: [], envelope: [], ink: [], duplex: [], packMode: [], delivery: [] } as Record<FieldKey, Opt[]>;
    const pre: Partial<Record<FieldKey, string>> = {};
    for (const f of FIELDS) { next[f.key] = optionsIn(r.body, f.match); const d = next[f.key].find((o) => o.isDefault) ?? next[f.key][0]; if (d) pre[f.key] = d.guid; }
    setOptions(next); setChosen(pre); setLoaded(true);
    return r;
  });

  let extraError: string | null = null; let extra: Record<string, unknown> | undefined;
  if (extraText.trim()) { try { extra = JSON.parse(extraText) as Record<string, unknown>; } catch (e) { extraError = `Not valid JSON: ${(e as Error).message}`; } }
  const guidsOk = FIELDS.every((f) => GUID.test(chosen[f.key] ?? ''));
  const ready = !!file && guidsOk && !!name.trim() && !!clientId.trim() && !extraError;

  const submit = () => void sub.run(async () => {
    const lines = address.split('\n').map((l) => l.trim()).filter(Boolean);
    const o = Object.fromEntries(FIELDS.map((f) => [f.key, { name: options[f.key].find((x) => x.guid === chosen[f.key])?.name ?? '', guid: chosen[f.key] }]));
    return submitDocument({
      options: { name: name.trim(), clientId: clientId.trim(), ...o, ...(extra ? { extra } : {}) }, fileName: file!.name, data: await fileToBase64(file!), confirm: true,
      commit: { extractAddress: extract, abortOnValidationFailure: abort, ...(lines.length || postcode.trim() ? { recipients: [{ address: lines, addressType: 'Postal', postcode: postcode.trim(), countryCode: 'GB' }] } : {}) },
    });
  });

  return (
    <Stack>
      <Title order={4}>1. Print options</Title>
      <Group><Button variant="light" loading={load.busy} onClick={loadConfig}>Load the account's options</Button><Text size="xs" c="dimmed">Paper, envelope, ink and so on are set up in H-POD; they change very rarely.</Text></Group>
      {load.error && <ErrorAlert message={load.error} />}
      {loaded && (
        <Group grow align="flex-start">
          {FIELDS.map((f) => options[f.key].length > 0
            ? <Select key={f.key} label={f.label} data={options[f.key].map((o) => ({ value: o.guid, label: o.name }))} value={chosen[f.key] ?? null} onChange={(v) => setChosen({ ...chosen, [f.key]: v ?? undefined })} allowDeselect={false} />
            : <TextInput key={f.key} label={`${f.label} (GUID)`} description="Not in the options loaded" value={chosen[f.key] ?? ''} onChange={(e) => setChosen({ ...chosen, [f.key]: e.currentTarget.value.trim() })} />)}
        </Group>
      )}
      <Title order={4}>2. The document</Title>
      <Group grow align="flex-start">
        <TextInput label="Name" value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <TextInput label="Client ID" description="Your own reference for the submission" value={clientId} onChange={(e) => setClientId(e.currentTarget.value)} />
      </Group>
      <FileInput label="PDF file" placeholder="Choose a PDF" accept="application/pdf" clearable value={file} onChange={setFile} />
      <Group><Checkbox label="Find the address in the document" checked={extract} onChange={(e) => setExtract(e.currentTarget.checked)} /><Checkbox label="Stop if the address is not valid" checked={abort} onChange={(e) => setAbort(e.currentTarget.checked)} /></Group>
      <Group grow align="flex-start">
        <Textarea label="Recipient address (optional, one line per row)" autosize minRows={2} value={address} onChange={(e) => setAddress(e.currentTarget.value)} />
        <TextInput label="Postcode (optional)" value={postcode} onChange={(e) => setPostcode(e.currentTarget.value)} />
      </Group>
      <Textarea label="Other print options (optional JSON)" description="Anything else the API allows, such as delayUntil or inserts, sent as it is." autosize minRows={1} error={extraError} styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }} value={extraText} onChange={(e) => setExtraText(e.currentTarget.value)} />
      <Group><Button disabled={!ready} loading={sub.busy} onClick={() => setConfirming(true)}>Submit to H-POD</Button>{!guidsOk && <Text size="xs" c="dimmed">Load the options (or enter their GUIDs) first.</Text>}</Group>
      {sub.error && <ErrorAlert message={sub.error} />}
      {sub.value && (
        <Stack gap="xs">
          <Alert color={sub.value.ok ? 'teal' : 'red'} icon={sub.value.ok ? <IconCircleCheck /> : undefined} role="status">{sub.value.message}</Alert>
          <Table withTableBorder>
            <Table.Thead><Table.Tr><Table.Th>Step</Table.Th><Table.Th>Result</Table.Th><Table.Th>Time</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{sub.value.steps.map((s, i) => <Table.Tr key={i}><Table.Td>{s.label}</Table.Td><Table.Td>{s.ok ? `OK (${s.status})` : `Failed${s.status ? ` (${s.status})` : ''}: ${s.message ?? ''}`}</Table.Td><Table.Td>{s.durationMs} ms</Table.Td></Table.Tr>)}</Table.Tbody>
          </Table>
          {sub.value.jobGuid && <Group><Text size="sm">Job GUID: <b>{sub.value.jobGuid}</b></Text><Button size="compact-sm" variant="light" onClick={() => onTrack(sub.value!.jobGuid!)}>Track this job</Button></Group>}
        </Stack>
      )}
      <ConfirmModal opened={confirming} title="Submit this document to H-POD?" confirmLabel="Yes, submit it" onCancel={() => setConfirming(false)} onConfirm={() => { setConfirming(false); submit(); }}>
        <Text size="sm">"{file?.name}" will be sent to H-POD and committed, so depending on the account's settings it can be printed and posted.</Text>
      </ConfirmModal>
    </Stack>
  );
}
