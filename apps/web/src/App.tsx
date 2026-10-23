import { AppShell, Burger, Button, Group, NavLink, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useAuth } from './auth/AuthContext';
import { ColorSchemeToggle } from './ColorSchemeToggle';
import { AddDocumentPage } from './accounting/AddDocumentPage';
import { BooksPage } from './accounting/BooksPage';
import { CalendarPage } from './accounting/CalendarPage';
import { ClosePage } from './accounting/ClosePage';
import { MonthPage } from './accounting/MonthPage';
import { YearPage } from './accounting/YearPage';
import { BackupPage } from './backup/BackupPage';
import { ImportPage } from './import/ImportPage';
import { ReconciliationPage } from './reconciliation/ReconciliationPage';
import { SettingsPage } from './settings/SettingsPage';
import { Navigate, NavLink as RouterNavLink, Route, Routes } from 'react-router';

const pages = [
  { path: '/', label: 'Облік', element: <YearPage /> },
  { path: '/add', label: 'Додати документ', element: <AddDocumentPage /> },
  { path: '/import', label: 'Імпорт JPK', element: <ImportPage /> },
  { path: '/reconciliation', label: 'Звірка', element: <ReconciliationPage /> },
  { path: '/calendar', label: 'Календар термінів', element: <CalendarPage /> },
  { path: '/backup', label: 'Бекап', element: <BackupPage /> },
  { path: '/settings', label: 'Налаштування', element: <SettingsPage /> },
];

export function App() {
  const [opened, { toggle, close }] = useDisclosure();
  const { signOut } = useAuth();

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 220, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md">
          <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" aria-label="Меню" />
          <Title order={1} size="h4">
            JDG Ledger
          </Title>
          <Group ml="auto" gap="xs" wrap="nowrap">
            <ColorSchemeToggle />
            <Button variant="subtle" size="xs" onClick={() => void signOut()}>
              Вийти
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        {pages.map((page) => (
          <NavLink key={page.path} component={RouterNavLink} to={page.path} label={page.label} onClick={close} />
        ))}
      </AppShell.Navbar>

      <AppShell.Main>
        <Routes>
          {pages.map((page) => (
            <Route key={page.path} path={page.path} element={page.element} />
          ))}
          <Route path="/month/:year/:month" element={<MonthPage />} />
          <Route path="/books/:year/:month" element={<BooksPage />} />
          <Route path="/close/:year/:month" element={<ClosePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell.Main>
    </AppShell>
  );
}
