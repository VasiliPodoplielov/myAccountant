import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { readFirebaseConfig } from './config';

const result = readFirebaseConfig(import.meta.env);

/** Імена відсутніх VITE_FIREBASE_* або порожній масив, якщо конфіг повний */
export const missingConfig = result.ok ? [] : result.missing;

const app = result.ok ? initializeApp(result.config) : null;

export const auth = app ? getAuth(app) : null;

/** Офлайн-кеш у IndexedDB: дані читаються без мережі, запис синхронізується при поверненні */
export const db = app
  ? initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) })
  : null;
