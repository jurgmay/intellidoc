import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert, Anchor, Badge, Group, Loader, Stack, Tabs, Text, Title } from '@mantine/core';
import { IconAlertCircle, IconArrowLeft } from '@tabler/icons-react';
import { getCustomer, getLookups, saveDetails, type CustomerDetail, type DetailsInput, type Lookups } from '../api/customers';
import { AccountsTab } from './customer/AccountsTab';
import { BrandsTab } from './customer/BrandsTab';
import { DetailsTab } from './customer/DetailsTab';
import { EnvelopesTab } from './customer/EnvelopesTab';
import { HistoryTab } from './customer/HistoryTab';
import { MatchingTab } from './customer/MatchingTab';
import { NotificationsTab } from './customer/NotificationsTab';
import { run, type TabProps } from './customer/shared';

export function CustomerPage() {
  const id = Number(useParams().id);
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [lookups, setLookups] = useState<Lookups | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const reload = useCallback(async () => {
    setDetail(await getCustomer(id));
    setLookups(await getLookups()); // new passthrough keys and delivery bands appear as they are used
    setVersion((v) => v + 1);
  }, [id]);

  useEffect(() => { reload().catch((e: Error) => setError(e.message)); }, [reload]);

  if (error) return <Alert color="red" icon={<IconAlertCircle />} title="Could not load this customer">{error}</Alert>;
  if (!detail || !lookups) return <Loader />;

  const patchDetails = async (patch: Partial<DetailsInput>): Promise<void> => {
    const body: DetailsInput = {
      code: detail.code, name: detail.name, misJobNumber: detail.misJobNumber, returnAddress: detail.returnAddress,
      flags: detail.flags, batchingKey: detail.batchingKey, packSequenceKey: detail.packSequenceKey, parentId: detail.parent?.id ?? null, ...patch,
    };
    const res = await run(() => saveDetails(id, body), 'Customer saved');
    if (!res.ok) throw Object.assign(new Error(res.message), { fieldErrors: res.fieldErrors });
    await reload();
  };
  const props: TabProps = { detail, lookups, reload, patchDetails };

  return (
    <Stack gap="lg" maw={1100}>
      <div>
        <Anchor component={Link} to="/customers" size="sm"><Group gap={4}><IconArrowLeft size={14} />All customers</Group></Anchor>
        <Group mt="xs" gap="sm">
          <Title order={2}>{detail.name}</Title>
          <Badge variant="outline">{detail.code}</Badge>
          {detail.flags.isDeleted && <Badge color="gray">Deleted</Badge>}
        </Group>
        {detail.parent && <Text size="sm" mt={4}>Part of <Anchor component={Link} to={`/customers/${detail.parent.id}`}>{detail.parent.name}</Anchor> ({detail.parent.code})</Text>}
        <Text c="dimmed" size="sm">Changes are saved as soon as you press Save on a tab, and take effect for the next file imported.</Text>
      </div>
      <Tabs defaultValue="details" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="details">Details</Tabs.Tab>
          <Tabs.Tab value="accounts">Accounts ({detail.accounts.filter((a) => !a.isDeleted).length + detail.children.filter((c) => !c.isDeleted).length})</Tabs.Tab>
          <Tabs.Tab value="brands">Brands ({detail.brands.length})</Tabs.Tab>
          <Tabs.Tab value="envelopes">Envelopes ({detail.envelopes.length})</Tabs.Tab>
          <Tabs.Tab value="matching">Matching &amp; batching</Tabs.Tab>
          <Tabs.Tab value="notifications">Notifications</Tabs.Tab>
          <Tabs.Tab value="history">History</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="details" pt="lg"><DetailsTab key={version} {...props} /></Tabs.Panel>
        <Tabs.Panel value="accounts" pt="lg"><AccountsTab {...props} /></Tabs.Panel>
        <Tabs.Panel value="brands" pt="lg"><BrandsTab {...props} /></Tabs.Panel>
        <Tabs.Panel value="envelopes" pt="lg"><EnvelopesTab {...props} /></Tabs.Panel>
        <Tabs.Panel value="matching" pt="lg"><MatchingTab key={version} {...props} /></Tabs.Panel>
        <Tabs.Panel value="notifications" pt="lg"><NotificationsTab key={version} {...props} /></Tabs.Panel>
        <Tabs.Panel value="history" pt="lg"><HistoryTab key={version} customerId={id} /></Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
