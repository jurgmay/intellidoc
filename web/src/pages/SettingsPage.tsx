import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Group, Loader, Paper, Stack, Tabs, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle, IconEye } from '@tabler/icons-react';
import { getSettings, removeSecret, saveSettings, type SettingsPayload, type SettingValue } from '../api/settings';
import { ApiError } from '../api/client';
import { SettingRow } from './SettingRow';
import { BatchCodeCard } from './BatchCodeCard';
import { MarksPreviewModal } from './MarksPreviewModal';
import { ChangeLog } from './ChangeLog';
import { PostalRatesTab } from './PostalRatesTab';
import { AnonymousTab, PaperTab, PostalFormatsTab } from './ReferenceTabs';

/** The settings on the Control marks tab: the page and envelope window, where the marks go on the page (sequence number, Data Matrix, pack start dot) and the MRDF page codes (Data Matrix, OCR code). */
/** The settings on the Network tab: network access, the workflow server, the IntelliDoc and Bluecrest folders and postal docketing. */
const NETWORK = /^(network|workflow|folder|bluecrest|dockets)/;
const CONTROL_MARK = /^(page|window|markSeq|markDm|markDot|mrdfDm|mrdfOcr)/;

export function SettingsPage() {
  const [data, setData] = useState<SettingsPayload | null>(null);
  const [draft, setDraft] = useState<Record<string, SettingValue>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('general');
  const [previewing, setPreviewing] = useState(false);
  const [logVersion, setLogVersion] = useState(0);
  /** The other tabs fetch their data only once they have been opened. */
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());

  const apply = useCallback((p: SettingsPayload) => {
    setData(p);
    setDraft(Object.fromEntries(p.settings.map((s) => [s.key, s.value])));
    setErrors({});
  }, []);

  useEffect(() => { getSettings().then(apply).catch((e: Error) => setLoadError(e.message)); }, [apply]);

  const dirty = useMemo(() => (data ? data.settings.filter((s) => draft[s.key] !== s.value).map((s) => s.key) : []), [data, draft]);

  if (loadError) return <Alert color="red" icon={<IconAlertCircle />} title="Could not load the settings">{loadError}</Alert>;
  if (!data) return <Loader />;

  const save = async () => {
    setSaving(true);
    try {
      const res = await saveSettings(Object.fromEntries(dirty.map((k) => [k, draft[k]!])));
      apply(res);
      setLogVersion((v) => v + 1);
      notifications.show({ color: 'teal', title: 'Settings saved', message: `${res.changed} change${res.changed === 1 ? '' : 's'} saved` });
    } catch (e) {
      if (e instanceof ApiError && e.fieldErrors) setErrors(e.fieldErrors);
      notifications.show({ color: 'red', title: 'Not saved', message: (e as Error).message });
    } finally { setSaving(false); }
  };

  /** Removes a saved password now (it is its own action, so it does not wait for Save changes); other unsaved edits stay. */
  const removeSaved = async (key: string) => {
    try {
      setData(await removeSecret(key));
      setDraft((d) => ({ ...d, [key]: '' }));
      setLogVersion((v) => v + 1);
      notifications.show({ color: 'teal', title: 'Password removed', message: 'The saved password has been removed' });
    } catch (e) { notifications.show({ color: 'red', title: 'Not removed', message: (e as Error).message }); }
  };

  /** The settings of each group that pass `keep`, as cards; a group with none left is not shown. */
  const groups = (keep: (s: SettingsPayload['settings'][number]) => boolean) => data.groups.map((g) => {
    const rows = data.settings.filter((s) => s.group === g && keep(s));
    if (!rows.length) return null;
    return (
      <Paper key={g} withBorder p="lg">
        <Title order={4} mb="md" c="brand.6">{g}</Title>
        <Stack gap="xl">
          {rows.map((s) => (
            <SettingRow key={s.key} setting={s} value={draft[s.key]!} changed={dirty.includes(s.key)} error={errors[s.key]}
              onChange={(v) => setDraft((d) => ({ ...d, [s.key]: v }))} onRemoveSecret={s.type === 'secret' ? () => removeSaved(s.key) : undefined} />
          ))}
        </Stack>
      </Paper>
    );
  });
  const saveBar = (
          <Paper withBorder p="md" mt="lg" pos="sticky" bottom={0} style={{ zIndex: 5 }}>
            <Group justify="space-between">
              <Text size="sm" c={dirty.length ? undefined : 'dimmed'}>{dirty.length ? `${dirty.length} unsaved change${dirty.length === 1 ? '' : 's'}` : 'No unsaved changes'}</Text>
              <Group>
                <Button variant="default" disabled={!dirty.length || saving} onClick={() => apply(data)}>Discard</Button>
                <Button disabled={!dirty.length} loading={saving} onClick={save}>Save changes</Button>
              </Group>
            </Group>
          </Paper>
  );

  return (
    <Stack gap="lg" maw={1100}>
      <div>
        <Title order={2}>Settings</Title>
        <Text c="dimmed" size="sm">What each setting does and where the app uses it. Changes are recorded in the change log.</Text>
      </div>
      <Tabs value={tab} onChange={(v) => { if (v) { setTab(v); setSeen((x) => new Set(x).add(v)); } }}>
        <Tabs.List>
          <Tabs.Tab value="general">General</Tabs.Tab>
          <Tabs.Tab value="marks">Control marks</Tabs.Tab>
          <Tabs.Tab value="network">Network</Tabs.Tab>
          <Tabs.Tab value="postal">Postal rates</Tabs.Tab>
          <Tabs.Tab value="formats">Postal formats</Tabs.Tab>
          <Tabs.Tab value="papers">Paper</Tabs.Tab>
          <Tabs.Tab value="anonymous">Anonymous addressees</Tabs.Tab>
          <Tabs.Tab value="log">Change log</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="general" pt="lg">
          <Stack gap="xl">
            {groups((s) => !CONTROL_MARK.test(s.key) && !NETWORK.test(s.key))}
            <BatchCodeCard info={data.batchCode} onChanged={(b) => { setData({ ...data, batchCode: b }); setLogVersion((v) => v + 1); }} />
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="marks" pt="lg">
          <Stack gap="xl">
            <Group justify="space-between" align="center">
              <Text size="sm" c="dimmed" maw={640}>Positions are in millimetres from the top left of the page. Use the preview to see where everything falls.</Text>
              <Button variant="light" leftSection={<IconEye size={16} />} onClick={() => setPreviewing(true)}>Preview positions</Button>
            </Group>
            {groups((s) => CONTROL_MARK.test(s.key))}
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="network" pt="lg">
          <Stack gap="xl">
            <Text size="sm" c="dimmed" maw={760}>Folders and the sign-in the app uses on the network. These are stored here for now; nothing reads them yet.</Text>
            {groups((s) => NETWORK.test(s.key))}
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="postal" pt="lg">{seen.has('postal') && <PostalRatesTab />}</Tabs.Panel>
        <Tabs.Panel value="formats" pt="lg">{seen.has('formats') && <PostalFormatsTab />}</Tabs.Panel>
        <Tabs.Panel value="papers" pt="lg">{seen.has('papers') && <PaperTab />}</Tabs.Panel>
        <Tabs.Panel value="anonymous" pt="lg">{seen.has('anonymous') && <AnonymousTab />}</Tabs.Panel>
        <Tabs.Panel value="log" pt="lg"><ChangeLog version={logVersion} /></Tabs.Panel>
      </Tabs>
      {(tab === 'general' || tab === 'marks' || tab === 'network') && saveBar}
      <MarksPreviewModal opened={previewing} onClose={() => setPreviewing(false)} values={Object.fromEntries(Object.entries(draft).filter(([k]) => CONTROL_MARK.test(k)))} />
    </Stack>
  );
}
