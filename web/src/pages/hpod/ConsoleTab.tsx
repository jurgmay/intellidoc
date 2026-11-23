import { useMemo, useState } from 'react';
import { Alert, Badge, Button, FileInput, Group, Select, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { fileToBase64, type HpodOperation, type HpodResult } from '../../api/hpod';
import { ConfirmModal, ErrorAlert, pretty, ResultPanel, useAction, type Run } from './shared';

/** Every operation of the API: pick one, fill in what it takes, send it, and see exactly what went out and what came back. */
export function ConsoleTab({ operations, groups, run }: { operations: HpodOperation[]; groups: string[]; run: Run }) {
  const [opId, setOpId] = useState<string | null>('printConfiguration');
  const op = operations.find((o) => o.id === opId) ?? null;
  const [path, setPath] = useState<Record<string, string>>({});
  const [query, setQuery] = useState<Record<string, string>>({});
  const [bodyText, setBodyText] = useState('');
  const [bearer, setBearer] = useState('');
  const [idem, setIdem] = useState('');
  const [confirming, setConfirming] = useState(false);
  const act = useAction<HpodResult>();

  const data = useMemo(() => groups.map((g) => ({ group: g, items: operations.filter((o) => o.group === g).map((o) => ({ value: o.id, label: `${o.summary} (${o.method} ${o.path})` })) })).filter((g) => g.items.length), [operations, groups]);
  const pick = (id: string | null) => {
    setOpId(id); setPath({}); setQuery({}); setBearer(''); setIdem(''); act.clear();
    const o = operations.find((x) => x.id === id);
    setBodyText(o?.body ? JSON.stringify(o.body.sample, null, 2) : '');
  };

  /** The body as an object, or null (with the error shown) when it is not JSON. */
  const parseBody = (): { ok: true; body: unknown } | { ok: false } => {
    if (!op?.body) return { ok: true, body: undefined };
    try { return { ok: true, body: JSON.parse(bodyText || '{}') }; } catch (e) { void act.run(() => Promise.reject(new Error(`The body is not valid JSON: ${(e as Error).message}`))); return { ok: false }; }
  };
  const send = (confirm: boolean) => {
    if (!op) return;
    const b = parseBody();
    if (!b.ok) return;
    void act.run(() => run({ operation: op.id, path, query, body: b.body, idempotencyKey: idem || undefined, bearerOverride: bearer || undefined, confirm: confirm || undefined }));
  };
  const onSend = () => { if (!op || !parseBody().ok) return; if (op.live) setConfirming(true); else send(false); };
  const onFile = async (file: File | null) => {
    if (!file) return;
    setBodyText(JSON.stringify({ data: await fileToBase64(file), filename: file.name, mimeType: file.type || 'application/octet-stream' }, null, 2));
  };

  return (
    <Stack>
      <Select label="Operation" searchable data={data} value={opId} onChange={pick} allowDeselect={false} />
      {op && (
        <Stack gap="sm">
          <Group gap="xs">
            <Badge color={op.method === 'GET' ? 'blue' : 'orange'}>{op.method}</Badge><Text ff="monospace" size="sm">{op.path}</Text>
            {op.auth === 'none' && <Badge variant="light" color="gray">no token</Badge>}
            {op.deprecated && <Badge color="yellow">deprecated</Badge>}
            {op.throttle && <Badge variant="light" color="gray">limit: {op.throttle}</Badge>}
          </Group>
          <Text size="sm">{op.description}</Text>
          {op.live && <Alert color="orange" icon={<IconAlertTriangle />}>{op.live}</Alert>}
          {(op.pathParams ?? []).map((p) => (
            <TextInput key={p.name} label={p.label} placeholder={p.fromSettings ? 'Empty: the instance in Settings' : p.example} required={p.required && !p.fromSettings} value={path[p.name] ?? ''} onChange={(e) => setPath({ ...path, [p.name]: e.currentTarget.value })} />
          ))}
          {(op.query ?? []).map((p) => (
            <TextInput key={p.name} label={p.label} placeholder={p.example} required={p.required} value={query[p.name] ?? ''} onChange={(e) => setQuery({ ...query, [p.name]: e.currentTarget.value })} />
          ))}
          {op.filePicker && <FileInput label="Choose a file to fill in the body" clearable onChange={(f) => void onFile(f)} />}
          {op.body && <Textarea label={op.body.kind === 'form' ? 'Form fields (JSON, sent as a form; empty values are left out)' : 'Body (JSON)'} autosize minRows={4} maxRows={16} styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }} value={bodyText} onChange={(e) => setBodyText(e.currentTarget.value)} />}
          {op.auth === 'bearer' && <TextInput label="Token override (optional)" description="Sends this token instead of the signed-in one, to try a call with another token." value={bearer} onChange={(e) => setBearer(e.currentTarget.value)} />}
          {op.method !== 'GET' && op.auth !== 'settings' && <TextInput label="Idempotency key (optional)" description="Made up for you when empty. Send the same key twice to see H-POD recognise a repeat." value={idem} onChange={(e) => setIdem(e.currentTarget.value)} />}
          <Group><Button loading={act.busy} onClick={onSend}>Send</Button></Group>
        </Stack>
      )}
      {act.error && <ErrorAlert message={act.error} />}
      {act.value && <ResultPanel result={act.value} />}
      <ConfirmModal opened={confirming} title={`${op?.summary ?? ''}: are you sure?`} confirmLabel="Yes, send it" onCancel={() => setConfirming(false)} onConfirm={() => { setConfirming(false); send(true); }}>
        <Text size="sm">{op?.live}</Text>
        <Text size="sm" c="dimmed">This goes to the H-POD account signed in on this page.</Text>
        {op?.body && <Text size="xs" ff="monospace" style={{ whiteSpace: 'pre-wrap' }}>{pretty(safeParse(bodyText)).slice(0, 600)}</Text>}
      </ConfirmModal>
    </Stack>
  );
}

function safeParse(s: string): unknown { try { return JSON.parse(s || '{}'); } catch { return s; } }
