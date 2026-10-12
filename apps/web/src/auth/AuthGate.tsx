import { Alert, Button, Center, Code, List, Loader, Stack, Text, Title } from '@mantine/core';
import { useState, type ReactNode } from 'react';
import { missingConfig } from '../firebase/app';
import { useAuth } from './AuthContext';

const POPUP_CANCELLED = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request'];

/** Показує вміст лише після входу */
export function AuthGate({ children }: { children: ReactNode }) {
  const { state, signIn } = useAuth();
  const [error, setError] = useState<string | null>(null);

  if (missingConfig.length > 0) {
    return (
      <Center mih="100vh" p="md">
        <Alert color="red" title="Firebase не налаштований" maw={480}>
          <Text size="sm">Задайте змінні середовища (див. .env.example):</Text>
          <List size="sm" mt="xs">
            {missingConfig.map((name) => (
              <List.Item key={name}>
                <Code>{name}</Code>
              </List.Item>
            ))}
          </List>
        </Alert>
      </Center>
    );
  }

  if (state.status === 'loading') {
    return (
      <Center mih="100vh">
        <Loader aria-label="Завантаження" />
      </Center>
    );
  }

  if (state.status === 'signedOut') {
    return (
      <Center mih="100vh" p="md">
        <Stack align="center" gap="sm">
          <Title order={1} size="h3">
            JDG Ledger
          </Title>
          <Button
            onClick={() => {
              setError(null);
              signIn().catch((e: unknown) => {
                // закрите вікно входу — не помилка
                if (POPUP_CANCELLED.includes((e as { code?: string }).code ?? '')) return;
                setError(e instanceof Error ? e.message : String(e));
              });
            }}
          >
            Увійти через Google
          </Button>
          {error && (
            <Text c="red" size="sm" role="alert">
              {error}
            </Text>
          )}
        </Stack>
      </Center>
    );
  }

  return children;
}
