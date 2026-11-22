import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Alert, Button, Group, Loader, Modal, Paper, Stack, Table, Text, TextInput } from '@mantine/core';
import { IconAlertCircle, IconPlus } from '@tabler/icons-react';
import {
  addAnonymous, deleteAnonymous, deletePaper, getAnonymous, getFormats, getPapers, getReferenceHistory, saveFormat, savePaper,
  type Paper as PaperRow, type PostalFormat, type ReferenceHistoryRow,
} from '../api/reference';
import { orNull, run } from './customer/shared';

/** Loads a list and its change history; `reload` after every change. */
function useLoaded<T>(fetcher: () => Promise<T>): { data: T | null; history: ReferenceHistoryRow[]; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null); const [history, setHistory] = useState<ReferenceHistoryRow[]>([]); const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => { Promise.all([fetcher(), getReferenceHistory()]).then(([d, h]) => { setData(d); setHistory(h.rows); }).catch((e: Error) => setError(e.message)); }, [fetcher]);
  useEffect(reload, [reload]);
  return { data, history, error, reload };
}

function Shell({ what, intro, state, children, history }: { what: string; intro: ReactNode; state: { data: unknown; error: string | null }; children: ReactNode; history: ReferenceHistoryRow[] }) {
  if (state.error) return <Alert color="red" icon={<IconAlertCircle />} title={`Could not load ${what}`}>{state.error}</Alert>;
  if (!state.data) return <Loader />;
  return (
    <Stack>
      <Text size="sm" c="dimmed" maw={720}>{intro}</Text>
      {children}
      {history.length > 0 && (
        <Paper withBorder p="md" mt="md">
          <Text fw={600} mb="xs">Recent changes</Text>
          <Table verticalSpacing="xs"><Table.Tbody>
            {history.slice(0, 10).map((h) => (
              <Table.Tr key={h.id}><Table.Td w={170}>{new Date(h.changedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</Table.Td><Table.Td w={140}>{h.changedBy}</Table.Td><Table.Td>{h.summary}</Table.Td></Table.Tr>
            ))}
          </Table.Tbody></Table>
        </Paper>
      )}
    </Stack>
  );
}

function ConfirmDelete({ label, onConfirm, onClose }: { label: string; onConfirm: () => Promise<{ ok: boolean; message?: string }>; onClose: () => void }) {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Modal opened onClose={onClose} title="Delete">
      <Stack>{msg && <Alert color="red">{msg}</Alert>}
        <Text>Delete {label}? This cannot be undone.</Text>
        <Group justify="flex-end"><Button variant="default" onClick={onClose}>Cancel</Button>
          <Button color="red" onClick={async () => { const r = await onConfirm(); if (!r.ok) setMsg(r.message ?? 'Could not delete'); }}>Delete</Button></Group></Stack>
    </Modal>
  );
}

// ---- Paper ----
function PaperDialog({ paper, onClose, onDone }: { paper: PaperRow; onClose: () => void; onDone: () => void }) {
  const [batchName, setBatchName] = useState(paper.batchName); const [code, setCode] = useState(paper.paperCode ?? '');
  const [err, setErr] = useState<Record<string, string>>({}); const [msg, setMsg] = useState<string | null>(null);
  const save = async () => {
    const res = await run(() => savePaper(paper.id, { batchName, paperCode: orNull(code) }), 'Paper saved');
    if (res.ok) onDone(); else { setErr(res.fieldErrors ?? {}); setMsg(res.fieldErrors ? null : res.message ?? null); }
  };
  return (
    <Modal opened onClose={onClose} title={`Edit ${paper.name}`}>
      <Stack>{msg && <Alert color="red">{msg}</Alert>}
        <TextInput label="Batch name" description="Papers with the same batch name go in the same batches." value={batchName} onChange={(e) => setBatchName(e.currentTarget.value)} error={err['batchName']} data-autofocus />
        <TextInput label="Paper code" value={code} onChange={(e) => setCode(e.currentTarget.value)} error={err['paperCode']} placeholder="not set" />
        <Group justify="flex-end"><Button variant="default" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></Group></Stack>
    </Modal>
  );
}

export function PaperTab() {
  const s = useLoaded(useCallback(async () => (await getPapers()).papers, []));
  const [edit, setEdit] = useState<PaperRow | null>(null); const [del, setDel] = useState<PaperRow | null>(null);
  const done = () => { setEdit(null); setDel(null); s.reload(); };
  return (
    <Shell what="the papers" state={s} history={s.history}
      intro={<>Papers arrive in the XML and are added here when first seen. The <b>batch name</b> decides which papers are printed together: &ldquo;A4 Plain&rdquo; and &ldquo;A4 White&rdquo; both set to A4 WHITE go in the same batches. A change applies to the next job imported; batches already made keep theirs.</>}>
      <Table withTableBorder striped verticalSpacing="xs">
        <Table.Thead><Table.Tr><Table.Th>Paper (as received)</Table.Th><Table.Th>Batch name</Table.Th><Table.Th>Paper code</Table.Th><Table.Th>Used by</Table.Th><Table.Th /></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(s.data ?? []).map((p) => (
            <Table.Tr key={p.id}>
              <Table.Td>{p.name}</Table.Td><Table.Td>{p.batchName}</Table.Td><Table.Td>{p.paperCode ?? <Text span c="dimmed">—</Text>}</Table.Td>
              <Table.Td>{p.usedBy === 0 ? <Text span c="dimmed">Nothing</Text> : `${p.usedBy} print option${p.usedBy === 1 ? '' : 's'}`}</Table.Td>
              <Table.Td><Group gap="xs" justify="flex-end">
                <Button size="xs" variant="default" onClick={() => setEdit(p)}>Edit</Button>
                <Button size="xs" variant="subtle" color="red" disabled={p.usedBy > 0} title={p.usedBy > 0 ? 'In use' : undefined} onClick={() => setDel(p)}>Delete</Button>
              </Group></Table.Td>
            </Table.Tr>
          ))}
          {s.data?.length === 0 && <Table.Tr><Table.Td colSpan={5}><Text c="dimmed" ta="center" py="sm">No papers yet.</Text></Table.Td></Table.Tr>}
        </Table.Tbody>
      </Table>
      {edit && <PaperDialog paper={edit} onClose={() => setEdit(null)} onDone={done} />}
      {del && <ConfirmDelete label={`the paper ${del.name}`} onClose={() => setDel(null)} onConfirm={async () => { const r = await run(() => deletePaper(del.id), 'Paper deleted'); if (r.ok) done(); return r; }} />}
    </Shell>
  );
}

// ---- Postal formats ----
function FormatDialog({ f, onClose, onDone }: { f: PostalFormat; onClose: () => void; onDone: () => void }) {
  const [w, setW] = useState(String(f.maxWeightG)); const [t, setT] = useState(f.maxThicknessMm === null ? '' : String(f.maxThicknessMm)); const [n, setN] = useState(f.maxSheets === null ? '' : String(f.maxSheets));
  const [mw, setMw] = useState(String(f.maxWidthMm)); const [mh, setMh] = useState(String(f.maxHeightMm));
  const [err, setErr] = useState<Record<string, string>>({}); const [msg, setMsg] = useState<string | null>(null);
  const num = (s: string): number | null => (s.trim() === '' ? null : Number(s));
  const save = async () => {
    const res = await run(() => saveFormat(f.id, { maxWeightG: w.trim() === '' ? NaN : Number(w), maxThicknessMm: num(t), maxSheets: num(n), maxWidthMm: mw.trim() === '' ? NaN : Number(mw), maxHeightMm: mh.trim() === '' ? NaN : Number(mh) }), 'Postal format saved');
    if (res.ok) onDone(); else { setErr(res.fieldErrors ?? {}); setMsg(res.fieldErrors ? null : res.message ?? null); }
  };
  return (
    <Modal opened onClose={onClose} title={`Edit ${f.name}`}>
      <Stack>{msg && <Alert color="red">{msg}</Alert>}
        <TextInput label="Most weight (g)" inputMode="numeric" value={w} onChange={(e) => setW(e.currentTarget.value)} error={err['maxWeightG']} data-autofocus />
        <TextInput label="Most thickness (mm)" inputMode="decimal" placeholder="no limit" value={t} onChange={(e) => setT(e.currentTarget.value)} error={err['maxThicknessMm']} />
        <TextInput label="Most sheets" inputMode="numeric" placeholder="no limit" value={n} onChange={(e) => setN(e.currentTarget.value)} error={err['maxSheets']} />
        <TextInput label="Most width (mm)" description="The longer side." inputMode="decimal" value={mw} onChange={(e) => setMw(e.currentTarget.value)} error={err['maxWidthMm']} />
        <TextInput label="Most height (mm)" description="The shorter side." inputMode="decimal" value={mh} onChange={(e) => setMh(e.currentTarget.value)} error={err['maxHeightMm']} />
        <Group justify="flex-end"><Button variant="default" onClick={onClose}>Cancel</Button><Button onClick={save}>Save</Button></Group></Stack>
    </Modal>
  );
}

export function PostalFormatsTab() {
  const s = useLoaded(useCallback(async () => (await getFormats()).formats, []));
  const [edit, setEdit] = useState<PostalFormat | null>(null);
  return (
    <Shell what="the postal formats" state={s} history={s.history}
      intro={<>The size limits of each postal format. At import a mailpiece is put in the smallest format whose limits it is within (weight, thickness and sheets), then the next one up. Width is the longer side and height the shorter, so a 240 x 165 letter is the same either way round. Larger formats cannot have lower limits than smaller ones. Width and height are recorded for each format but the import does not check them yet. The names are fixed because the app refers to them. A change applies to the next job imported.</>}>
      <Table withTableBorder striped verticalSpacing="xs">
        <Table.Thead><Table.Tr><Table.Th>Format</Table.Th><Table.Th ta="right">Most weight</Table.Th><Table.Th ta="right">Most thickness</Table.Th><Table.Th ta="right">Most sheets</Table.Th><Table.Th ta="right">Most width</Table.Th><Table.Th ta="right">Most height</Table.Th><Table.Th>Services</Table.Th><Table.Th /></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(s.data ?? []).map((f) => (
            <Table.Tr key={f.id}>
              <Table.Td>{f.name}</Table.Td><Table.Td ta="right">{f.maxWeightG} g</Table.Td>
              <Table.Td ta="right">{f.maxThicknessMm === null ? <Text span c="dimmed">no limit</Text> : `${f.maxThicknessMm} mm`}</Table.Td>
              <Table.Td ta="right">{f.maxSheets === null ? <Text span c="dimmed">no limit</Text> : f.maxSheets}</Table.Td>
              <Table.Td ta="right">{f.maxWidthMm} mm</Table.Td><Table.Td ta="right">{f.maxHeightMm} mm</Table.Td>
              <Table.Td>{f.usedBy}</Table.Td>
              <Table.Td><Group justify="flex-end"><Button size="xs" variant="default" onClick={() => setEdit(f)}>Edit</Button></Group></Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      {edit && <FormatDialog f={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); s.reload(); }} />}
    </Shell>
  );
}

// ---- Anonymous addressees ----
export function AnonymousTab() {
  const s = useLoaded(useCallback(async () => (await getAnonymous()).names, []));
  const [text, setText] = useState(''); const [err, setErr] = useState<string | null>(null); const [del, setDel] = useState<string | null>(null);
  const add = async () => {
    const res = await run(() => addAnonymous(text), 'Added');
    if (res.ok) { setText(''); setErr(null); s.reload(); } else setErr(res.fieldErrors?.['text'] ?? res.message ?? null);
  };
  return (
    <Shell what="the anonymous addressees" state={s} history={s.history}
      intro={<>Mail addressed to one of these, such as &ldquo;The Occupier&rdquo;, is never merged with other mail: each gets its own envelope. Type a name in any spelling; it is stored in capitals with spaces and punctuation removed, which is how addressees are compared. A change applies to the next job imported.</>}>
      <Group align="flex-end">
        <TextInput label="New anonymous addressee" placeholder="e.g. The Homeowner" value={text} onChange={(e) => setText(e.currentTarget.value)} error={err} onKeyDown={(e) => { if (e.key === 'Enter') void add(); }} w={320} />
        <Button leftSection={<IconPlus size={14} />} onClick={add}>Add</Button>
      </Group>
      <Table withTableBorder striped verticalSpacing="xs" maw={520}>
        <Table.Thead><Table.Tr><Table.Th>Stored as</Table.Th><Table.Th /></Table.Tr></Table.Thead>
        <Table.Tbody>
          {(s.data ?? []).map((n) => (
            <Table.Tr key={n}><Table.Td>{n}</Table.Td><Table.Td><Group justify="flex-end"><Button size="xs" variant="subtle" color="red" onClick={() => setDel(n)}>Remove</Button></Group></Table.Td></Table.Tr>
          ))}
          {s.data?.length === 0 && <Table.Tr><Table.Td colSpan={2}><Text c="dimmed" ta="center" py="sm">No anonymous addressees. Every addressee can be merged.</Text></Table.Td></Table.Tr>}
        </Table.Tbody>
      </Table>
      {del && <ConfirmDelete label={del} onClose={() => setDel(null)} onConfirm={async () => { const r = await run(() => deleteAnonymous(del), 'Removed'); if (r.ok) { setDel(null); s.reload(); } return r; }} />}
    </Shell>
  );
}
