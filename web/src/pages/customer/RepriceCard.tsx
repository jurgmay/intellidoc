import { useState } from 'react';
import { Alert, Button, Group, Paper, Stack, Switch, Text, TextInput } from '@mantine/core';
import { previewReprice, runReprice, type RepricePreview, type RepriceResult } from '../../api/costing';
import { orNull, run } from './shared';

const n = (v: number): string => v.toLocaleString('en-GB');

/** Prices mail that has no price yet (or prices it again), for this customer and everything below it. Always previews first. */
export function RepriceCard({ customerId, onDone }: { customerId: number; onDone?: () => void }) {
  const [f, setF] = useState({ from: '', to: '', overwrite: false });
  const [preview, setPreview] = useState<RepricePreview | null>(null);
  const [done, setDone] = useState<RepriceResult | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const input = () => ({ from: orNull(f.from), to: orNull(f.to), overwrite: f.overwrite });
  const edit = (patch: Partial<typeof f>) => { setF((x) => ({ ...x, ...patch })); setPreview(null); setDone(null); setErrors({}); };

  const check = async () => {
    setBusy(true); setDone(null);
    try { setPreview(await previewReprice(customerId, input())); setErrors({}); }
    catch (e) { setPreview(null); setErrors((e as { fieldErrors?: Record<string, string> }).fieldErrors ?? { _: (e as Error).message }); }
    finally { setBusy(false); }
  };
  const go = async () => {
    setBusy(true);
    let result: RepriceResult | null = null;
    const res = await run(async () => { result = await runReprice(customerId, input()); }, 'Mail priced');
    setBusy(false);
    if (res.ok && result) { setDone(result); setPreview(null); onDone?.(); }
  };

  return (
    <Paper withBorder p="md">
      <Stack gap="sm">
        <div>
          <Text fw={600}>Price mail again</Text>
          <Text size="sm" c="dimmed">For mail that arrived before a costing model existed, or after a model was corrected. Each mailpiece is priced with the model that was in force on the day it was made, for this customer and everything below it. By default only mail without a price is priced.</Text>
        </div>
        <Group align="flex-start">
          <TextInput label="From (first day)" type="date" value={f.from} onChange={(e) => edit({ from: e.currentTarget.value })} error={errors['from']} />
          <TextInput label="To (last day)" type="date" value={f.to} onChange={(e) => edit({ to: e.currentTarget.value })} error={errors['to']} />
        </Group>
        <Switch label="Also price mail that already has a price" description="Replaces the existing prices with the model in force on each mailpiece's day." checked={f.overwrite} onChange={(e) => edit({ overwrite: e.currentTarget.checked })} />
        {errors['_'] && <Alert color="red">{errors['_']}</Alert>}
        <Group>
          <Button variant="default" loading={busy && !preview} onClick={check}>Check how much mail this covers</Button>
        </Group>
        {preview && (
          <Alert color={preview.wouldPrice > 0 ? 'blue' : 'gray'} title="What a run would do">
            <Stack gap={4}>
              <Text size="sm">{n(preview.inScope)} mailpiece{preview.inScope === 1 ? '' : 's'} in this range, {n(preview.alreadyPriced)} already priced.</Text>
              <Text size="sm" fw={600}>{n(preview.wouldPrice)} would be priced{f.overwrite ? ' (existing prices replaced)' : ''}.</Text>
              {preview.noModel > 0 && <Text size="sm">{n(preview.noModel)} left as they are: no costing model covered the day they were made.</Text>}
              {preview.unknownColours > 0 && <Text size="sm">{n(preview.unknownColours)} left as they are: the colours of their pages are not known yet.</Text>}
              <Group mt="xs"><Button disabled={preview.wouldPrice === 0} loading={busy} onClick={go}>Price {n(preview.wouldPrice)} mailpiece{preview.wouldPrice === 1 ? '' : 's'}</Button></Group>
            </Stack>
          </Alert>
        )}
        {done && <Alert color="teal" title="Done">{n(done.priced)} priced.{done.noModel > 0 ? ` ${n(done.noModel)} had no costing model.` : ''}{done.unknownColours > 0 ? ` ${n(done.unknownColours)} have unknown page colours.` : ''}</Alert>}
      </Stack>
    </Paper>
  );
}
