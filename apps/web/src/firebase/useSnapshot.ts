import { collection, doc, onSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { db } from './app';
import type { Path } from './paths';

export type SnapshotState<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; error: Error };

interface Tagged<T> {
  key: string;
  state: SnapshotState<T>;
}

// один об'єкт на всі рендери, щоб стан loading не скидав useMemo у споживачів
const LOADING = { status: 'loading' } as const;

/** Відповідь застаріла, якщо шлях змінився після неї: тоді знову loading */
function current<T>(tagged: Tagged<T> | null, key: string | null): SnapshotState<T> {
  return tagged && tagged.key === key ? tagged.state : LOADING;
}

/** Живий документ. path = null → підписки немає. data = null, якщо документа нема. */
export function useDocData<T>(path: Path | null): SnapshotState<T | null> {
  const key = path ? path.join('/') : null;
  const [tagged, setTagged] = useState<Tagged<T | null> | null>(null);

  useEffect(() => {
    if (!db || key === null) return;
    return onSnapshot(
      doc(db, key),
      (snap) => setTagged({ key, state: { status: 'ready', data: snap.exists() ? (snap.data() as T) : null } }),
      (error) => setTagged({ key, state: { status: 'error', error } }),
    );
  }, [key]);

  return current(tagged, key);
}

/** Жива колекція; кожен елемент отримує id документа */
export function useCollectionData<T>(path: Path | null): SnapshotState<(T & { id: string })[]> {
  const key = path ? path.join('/') : null;
  const [tagged, setTagged] = useState<Tagged<(T & { id: string })[]> | null>(null);

  useEffect(() => {
    if (!db || key === null) return;
    return onSnapshot(
      collection(db, key),
      (snap) =>
        setTagged({
          key,
          state: { status: 'ready', data: snap.docs.map((d) => ({ ...(d.data() as T), id: d.id })) },
        }),
      (error) => setTagged({ key, state: { status: 'error', error } }),
    );
  }, [key]);

  return current(tagged, key);
}

/** Відмова правил доступу (чужий акаунт, не в allowlist) */
export function isPermissionDenied(error: Error): boolean {
  return (error as { code?: string }).code === 'permission-denied';
}
