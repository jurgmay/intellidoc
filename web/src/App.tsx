import { AppShell, Group, Image, NavLink, Text } from '@mantine/core';
import { IconActivity, IconChartBar, IconFiles, IconPlugConnected, IconReportMoney, IconSearch, IconSettings, IconUsers } from '@tabler/icons-react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ActivityPage } from './pages/ActivityPage';
import { CustomerPage } from './pages/CustomerPage';
import { CustomersPage } from './pages/CustomersPage';
import { HpodPage } from './pages/HpodPage';
import { JobsPage } from './pages/JobsPage';
import { MarginPage } from './pages/MarginPage';
import { ReportsPage } from './pages/ReportsPage';
import { RecipientSearchPage } from './pages/RecipientSearchPage';
import { SettingsPage } from './pages/SettingsPage';

const NAV = [{ to: '/customers', label: 'Customers', icon: IconUsers }, { to: '/activity', label: 'Activity', icon: IconActivity }, { to: '/jobs', label: 'Jobs', icon: IconFiles }, { to: '/search', label: 'Recipient search', icon: IconSearch }, { to: '/reports', label: 'Usage report', icon: IconChartBar }, { to: '/margin', label: 'Margin report', icon: IconReportMoney }, { to: '/hpod', label: 'H-POD', icon: IconPlugConnected }, { to: '/settings', label: 'Settings', icon: IconSettings }];

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
          <Route path="/search" element={<RecipientSearchPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/margin" element={<MarginPage />} />
          <Route path="/hpod" element={<HpodPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Text>Page not found.</Text>} />
        </Routes>
      </AppShell.Main>
    </AppShell>
  );
}
