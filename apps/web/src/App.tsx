import { AppShell, Burger, Group, NavLink, Text, Title } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Navigate, NavLink as RouterNavLink, Route, Routes } from 'react-router';

const pages = [
  { path: '/', label: 'Рік' },
  { path: '/settings', label: 'Налаштування' },
];

function Placeholder({ title }: { title: string }) {
  return (
    <>
      <Title order={2}>{title}</Title>
      <Text c="dimmed" mt="xs">
        Тут поки порожньо.
      </Text>
    </>
  );
}

export function App() {
  const [opened, { toggle, close }] = useDisclosure();

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
            <Route key={page.path} path={page.path} element={<Placeholder title={page.label} />} />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell.Main>
    </AppShell>
  );
}
