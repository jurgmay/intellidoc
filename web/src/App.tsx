import { AppShell, Group, Image, NavLink, Text } from '@mantine/core';
import { IconActivity, IconChartBar, IconFiles, IconPackage, IconPlugConnected, IconSearch, IconSettings, IconUsers } from '@tabler/icons-react';
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

const NAV = [{ to: '/customers', label: 'Customers', icon: IconUsers }, { to: '/activity', label: 'Activity', icon: IconActivity }, { to: '/jobs', label: 'Jobs', icon: IconFiles }, { to: '/batches', label: 'Batches', icon: IconPackage }, { to: '/mailpieces', label: 'Mailpieces', icon: IconSearch }, { to: '/reports', label: 'Reports', icon: IconChartBar }, { to: '/hpod', label: 'H-POD', icon: IconPlugConnected }, { to: '/settings', label: 'Settings', icon: IconSettings }];

export function App() {
  const { pathname } = useLocation();
  return (
    <AppShell header={{ height: 64 }} navbar={{ width: 220, breakpoint: 'sm' }} padding="lg">
      <AppShell.Header>
        <Group h="100%" px="lg" justify="space-between">
          <Image src="/intellidoc-logo.svg" alt="Intellidoc" h={48} w="auto" />
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
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Text>Page not found.</Text>} />
        </Routes>
      </AppShell.Main>
    </AppShell>
  );
}
