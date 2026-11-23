import { useCallback, useEffect, useState } from 'react';
import { Alert, Anchor, Badge, Button, Group, Paper, Stack, Tabs, Text, Title } from '@mantine/core';
import { Link } from 'react-router-dom';
import { callOperation, getOperations, getSession, signIn, signOut, type HpodOperation, type HpodStatus } from '../api/hpod';
import { ConsoleTab } from './hpod/ConsoleTab';
import { ErrorAlert, type Run } from './hpod/shared';
import { SubmitTab } from './hpod/SubmitTab';
import { TrackTab } from './hpod/TrackTab';

const stamp = (iso: string): string => new Date(iso).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';

/** Try every call of the H-POD API, and send a document through it, using the sign-in details on Settings > Connectivity. */
export function HpodPage() {
  const [status, setStatus] = useState<HpodStatus | null>(null);
  const [ops, setOps] = useState<{ groups: string[]; operations: HpodOperation[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<string | null>('submit');
  const [jobGuid, setJobGuid] = useState('');

  useEffect(() => { getSession().then(setStatus).catch((e: Error) => setError(e.message)); getOperations().then(setOps).catch((e: Error) => setError(e.message)); }, []);

  const run: Run = useCallback(async (input) => { const r = await callOperation(input); setStatus(r.status); return r.result; }, []);
  const doSignIn = async () => { setBusy(true); setError(null); try { setStatus((await signIn()).status); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const doSignOut = async () => { setBusy(true); try { setStatus(await signOut()); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };

  return (
    <Stack>
      <Title order={2}>H-POD</Title>
      <Text size="sm" c="dimmed">Tries the H-POD print API (v3). The sign-in details are the ones on Settings &gt; Connectivity; the password and token stay on the server.</Text>
      <Paper withBorder p="sm" aria-label="H-POD session">
        {!status ? <Text size="sm">Loading...</Text> : !status.configured ? (
          <Alert color="yellow" title="H-POD is not set up yet">Enter the {status.missing.join(', ')} on <Anchor component={Link} to="/settings">Settings &gt; Connectivity</Anchor> first.</Alert>
        ) : (
          <Group justify="space-between">
            <Group gap="sm">
              <Badge color={status.signedIn ? 'teal' : 'gray'} size="lg">{status.signedIn ? 'Signed in' : 'Not signed in'}</Badge>
              <Text size="sm">{status.username} · account {status.accountLogin} · instance {status.instance} · {status.endpoint}</Text>
              {status.signedIn && status.expiresAt && <Text size="sm" c="dimmed">Token valid until {stamp(status.expiresAt)}</Text>}
            </Group>
            <Group>
              <Button size="xs" loading={busy} onClick={doSignIn}>{status.signedIn ? 'Sign in again' : 'Sign in'}</Button>
              {status.signedIn && <Button size="xs" variant="default" loading={busy} onClick={doSignOut}>Sign out</Button>}
            </Group>
          </Group>
        )}
      </Paper>
      {error && <ErrorAlert message={error} />}
      {status?.configured && ops && (
        <Tabs value={tab} onChange={setTab} keepMounted>
          <Tabs.List><Tabs.Tab value="submit">Submit</Tabs.Tab><Tabs.Tab value="track">Track</Tabs.Tab><Tabs.Tab value="console">Console</Tabs.Tab></Tabs.List>
          <Tabs.Panel value="submit" pt="md"><SubmitTab run={run} onTrack={(g) => { setJobGuid(g); setTab('track'); }} /></Tabs.Panel>
          <Tabs.Panel value="track" pt="md"><TrackTab run={run} jobGuid={jobGuid} setJobGuid={setJobGuid} /></Tabs.Panel>
          <Tabs.Panel value="console" pt="md"><ConsoleTab operations={ops.operations} groups={ops.groups} run={run} /></Tabs.Panel>
        </Tabs>
      )}
    </Stack>
  );
}
