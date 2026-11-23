import { Badge, Button, Grid, Group, NumberInput, PasswordInput, Select, Stack, Switch, Text, TextInput } from '@mantine/core';
import type { SettingValue, SettingView } from '../api/settings';

interface Props { setting: SettingView; value: SettingValue; changed: boolean; error?: string; onChange: (v: SettingValue) => void; /** For a secret that is saved: removes it. */ onRemoveSecret?: () => void }

export function SettingRow({ setting: s, value, changed, error, onChange, onRemoveSecret }: Props) {
  const label = (
    <Group gap="xs">
      <span>{s.label}</span>
      {changed && <Badge size="xs" color="orange" variant="light">changed</Badge>}
    </Group>
  );
  let control;
  switch (s.type) {
    case 'boolean':
      control = <Switch label={label} checked={value as boolean} onChange={(e) => onChange(e.currentTarget.checked)} aria-label={s.label} />;
      break;
    case 'number':
    case 'integer':
      control = s.allowed ? (
        <Select label={label} data={s.allowed.map((n) => ({ value: String(n), label: `${n}${s.unit ?? ''}` }))} value={String(value)} onChange={(v) => v !== null && onChange(Number(v))}
          allowDeselect={false} error={error} />
      ) : (
        <NumberInput label={label} value={value as number} onChange={(v) => onChange(v as number)} min={s.min} max={s.max} step={s.step ?? 1}
          decimalScale={s.type === 'integer' ? 0 : 3} rightSection={<Text size="xs" c="dimmed" pr="xs">{s.unit}</Text>} rightSectionWidth={s.unit ? 80 : undefined}
          error={error} allowNegative={false} />
      );
      break;
    case 'select':
      control = <Select label={label} data={s.options ?? []} value={value as string} onChange={(v) => v && onChange(v)} allowDeselect={false} error={error} />;
      break;
    case 'text':
      control = <TextInput label={label} value={value as string} onChange={(e) => onChange(e.currentTarget.value)} error={error} autoComplete="off" />;
      break;
    case 'secret':
      control = (
        <Stack gap={6}>
          <PasswordInput label={label} value={value as string} onChange={(e) => onChange(e.currentTarget.value)} error={error} autoComplete="new-password"
            placeholder={s.isSet ? 'A password is saved. Type a new one to replace it.' : undefined} />
          {s.isSet && onRemoveSecret && <Button variant="subtle" color="red" size="compact-sm" w="fit-content" onClick={onRemoveSecret}>Remove saved password</Button>}
        </Stack>
      );
      break;
    case 'emails':
      control = <TextInput label={label} value={value as string} onChange={(e) => onChange(e.currentTarget.value)} placeholder="name@latcham.co.uk, name2@latcham.co.uk" error={error} />;
      break;
  }
  return (
    <Grid gap="xl" align="flex-start">
      <Grid.Col span={{ base: 12, md: 5 }}>
        {control}
        {s.type === 'boolean' && error && <Text size="xs" c="red">{error}</Text>}
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 7 }}>
        <Stack gap={4}>
          <Text size="sm">{s.description}</Text>
          <Text size="xs" c="dimmed"><b>Used by:</b> {s.usedBy}</Text>
          <Text size="xs" c="dimmed"><b>Takes effect:</b> {s.appliesTo}</Text>
        </Stack>
      </Grid.Col>
    </Grid>
  );
}
