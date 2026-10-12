import { Alert, Button, Center, Loader, Stack } from '@mantine/core';
import type { ReactNode } from 'react';
import { useYearSettings } from '../data/hooks';
import { isPermissionDenied } from '../firebase/useSnapshot';
import { useAuth } from './AuthContext';

/**
 * Другий рубіж після входу: якщо правила Firestore відмовляють у читанні даних користувача
 * (акаунт не в allowlist), показуємо відмову замість порожніх екранів.
 * Проба — підписка на налаштування поточного року, які додатку потрібні в будь-якому разі.
 */
export function AccessGate({ children }: { children: ReactNode }) {
  const { state, signOut } = useAuth();
  const probe = useYearSettings(new Date().getFullYear());

  if (probe.status === 'error' && isPermissionDenied(probe.error)) {
    const email = state.status === 'signedIn' ? state.user.email : null;
    return (
      <Stack maw={480} p="md" m="auto" mih="100vh" justify="center">
        <Alert color="red" title="Немає доступу" role="alert">
          Акаунт {email ?? ''} не входить до списку дозволених. Увійдіть під іншим акаунтом.
        </Alert>
        <Button variant="default" onClick={() => void signOut()}>
          Вийти
        </Button>
      </Stack>
    );
  }

  // До першої відповіді додаток не показуємо: інакше чужий акаунт на мить бачить екрани
  if (probe.status === 'loading') {
    return (
      <Center mih="100vh">
        <Loader aria-label="Завантаження" />
      </Center>
    );
  }

  return children;
}
