import { Anchor, AppShell, Group, Image, NavLink, Text } from '@mantine/core';
import { IconActivity, IconChartBar, IconFiles, IconPackage, IconPlugConnected, IconSearch, IconSettings, IconUsers } from '@tabler/icons-react';
import { signOut, useIsAdmin, useMe } from './auth';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ActivityPage } from './pages/ActivityPage';
import { CustomerPage } from './pages/CustomerPage';
import { CustomersPage } from './pages/CustomersPage';
import { HpodPage } from './pages/HpodPage';
import { JobsPage } from './pages/JobsPage';
import { ReportsPage } from './pages/ReportsPage';
import { RecipientSearchPage } from './pages/RecipientSearchPage';
import { BatchesPage } from './pages/BatchesPage';
import { SettingsPage } from './pages/SettingsPage';

const NAV = [{ to: '/activity', label: 'Activity', icon: IconActivity }, { to: '/customers', label: 'Customers', icon: IconUsers }, { to: '/jobs', label: 'Jobs', icon: IconFiles }, { to: '/batches', label: 'Batches', icon: IconPackage }, { to: '/mailpieces', label: 'Mailpieces', icon: IconSearch }, { to: '/reports', label: 'Reports', icon: IconChartBar }, { to: '/hpod', label: 'H-POD', icon: IconPlugConnected }, { to: '/settings', label: 'Settings', icon: IconSettings }];

export function App() {
  const { pathname } = useLocation();
  const me = useMe();
  const isAdmin = useIsAdmin();
  const nav = isAdmin ? NAV : NAV.filter((n) => n.to !== '/settings');
  return (
    <AppShell header={{ height: 64 }} navbar={{ width: 220, breakpoint: 'sm' }} padding="lg">
      <AppShell.Header>
        <Group h="100%" px="lg" justify="space-between">
          <Image src="/intellidoc-logo.svg" alt="Intellidoc" h={56} w="auto" />
          {me && (
            <Group gap="sm">
              <Text size="sm" title={me.email}>{me.name}{me.isAdmin ? ' (administrator)' : ''}</Text>
              {me.signedInByDevelopmentBypass ? <Text size="xs" c="dimmed">sign-in is off</Text> : <Anchor component="button" type="button" size="sm" onClick={() => void signOut()}>Sign out</Anchor>}
            </Group>
          )}
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="sm">
        {nav.map((n) => (
          <NavLink key={n.to} component={Link} to={n.to} label={n.label} leftSection={<n.icon size={18} />} active={pathname.startsWith(n.to)} />
        ))}
      </AppShell.Navbar>
      <AppShell.Main>
        <Routes>
          <Route path="/" element={<Navigate to="/customers" replace />} />
          <Route path="/customers" element={<CustomersPage />} />
          <Route path="/customers/:id" element={<CustomerPage />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/batches" element={<BatchesPage />} />
          <Route path="/mailpieces" element={<RecipientSearchPage />} />
          <Route path="/search" element={<Navigate to="/mailpieces" replace />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/margin" element={<Navigate to="/reports" replace />} />
          <Route path="/hpod" element={<HpodPage />} />
          <Route path="/settings" element={isAdmin ? <SettingsPage /> : <Text>Settings are for administrators.</Text>} />
          <Route path="*" element={<Text>Page not found.</Text>} />
        </Routes>
      </AppShell.Main>
    </AppShell>
  );
}
