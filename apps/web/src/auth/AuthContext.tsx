import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { auth } from '../firebase/app';

type AuthState = { status: 'loading' } | { status: 'signedOut' } | { status: 'signedIn'; user: User };

interface AuthApi {
  state: AuthState;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Без конфігу Firebase слухати нічого: AuthGate покаже помилку конфігурації
  const [state, setState] = useState<AuthState>(auth ? { status: 'loading' } : { status: 'signedOut' });

  useEffect(() => {
    if (!auth) return;
    return onAuthStateChanged(auth, (user) => setState(user ? { status: 'signedIn', user } : { status: 'signedOut' }));
  }, []);

  const api = useMemo<AuthApi>(
    () => ({
      state,
      signIn: async () => {
        if (!auth) throw new Error('Firebase не налаштований');
        await signInWithPopup(auth, new GoogleAuthProvider());
      },
      signOut: async () => {
        if (auth) await signOut(auth);
      },
    }),
    [state],
  );

  return <AuthContext value={api}>{children}</AuthContext>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth поза AuthProvider');
  return ctx;
}

/** uid поточного користувача; викликати лише під AuthGate */
export function useUid(): string {
  const { state } = useAuth();
  if (state.status !== 'signedIn') throw new Error('useUid без входу');
  return state.user.uid;
}
