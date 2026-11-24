import { useState } from 'react';
import { Alert, Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { endAllPrices, type EndPlan } from '../api/postal';
import { ukDate } from '../dates';
import { run } from './customer/shared';

/** Give every price that runs past a day that day as its last day. Says how many first. */
export function PostalEndPricesModal({ today, onClose, onDone }: { today: string; onClose: () => void; onDone: () => void }) {
  const [day, setDay] = useState(today);
  const [plan, setPlan] = useState<EndPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const check = async () => {
    setError(null);
    try { setPlan((await endAllPrices(day, false)).plan); } catch (e) { setPlan(null); setError((e as Error).message); }
  };
  const apply = async () => { const res = await run(() => endAllPrices(day, true), 'Prices ended'); if (res.ok) onDone(); else setError(res.message ?? 'Not saved'); };
  const n = plan?.rows.length ?? 0;
  return (
    <Modal opened onClose={onClose} title="End all current prices">
      <Stack>
        <Text size="sm" c="dimmed">Sets the last day of every price that is in force or planned and runs past this day. Prices that already end on or before it are left alone. Mail already priced keeps its price.</Text>
        <TextInput label="Last day" type="date" required value={day} onChange={(e) => { setDay(e.currentTarget.value); setPlan(null); setError(null); }} />
        {error && <Alert color="red">{error}</Alert>}
        {plan && <Alert color={n ? 'blue' : 'gray'}>{n ? `${n} price${n === 1 ? '' : 's'} across ${plan.services} service${plan.services === 1 ? '' : 's'} will end on ${ukDate(plan.lastDay)}.` : 'No prices run past that day.'}{plan.startingLater > 0 && ` ${plan.startingLater} price${plan.startingLater === 1 ? ' starts' : 's start'} after it and will not change.`}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          {!plan || n === 0 ? <Button disabled={!day} onClick={check}>Check</Button> : <Button color="red" onClick={apply}>End {n} price{n === 1 ? '' : 's'}</Button>}
        </Group>
      </Stack>
    </Modal>
  );
}
