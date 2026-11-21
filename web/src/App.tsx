import { AppShell, Group, Image, NavLink, Text } from '@mantine/core';
import { IconSettings } from '@tabler/icons-react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { SettingsPage } from './pages/SettingsPage';

const NAV = [{ to: '/settings', label: 'Settings', icon: IconSettings }];

export function App() {
  const { pathname } = useLocation();
  return (
    <AppShell header={{ height: 64 }} navbar={{ width: 220, breakpoint: 'sm' }} padding="lg">
      <AppShell.Header>
        <Group h="100%" px="lg" justify="space-between">
          <Image src="/intellidoc-logo.svg" alt="Intellidoc" h={40} w="auto" />
          <Text size="xs" c="dimmed">Not signed in (sign-in comes later)</Text>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="sm">
        {NAV.map((n) => (
          <NavLink key={n.to} component={Link} to={n.to} label={n.label} leftSection={<n.icon size={18} />} active={pathname.startsWith(n.to)} />
        ))}
      </AppShell.Navbar>
      <AppShell.Main>
        <Routes>
          <Route path="/" element={<Navigate to="/settings" replace />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Text>Page not found.</Text>} />
        </Routes>
      </AppShell.Main>
    </AppShell>
  );
}
