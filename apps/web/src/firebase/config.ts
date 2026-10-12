export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

const KEYS = {
  apiKey: 'VITE_FIREBASE_API_KEY',
  authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
  projectId: 'VITE_FIREBASE_PROJECT_ID',
  storageBucket: 'VITE_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'VITE_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'VITE_FIREBASE_APP_ID',
} as const satisfies Record<keyof FirebaseWebConfig, string>;

export type ConfigResult = { ok: true; config: FirebaseWebConfig } | { ok: false; missing: string[] };

/** Читає web-config з env; повертає перелік відсутніх змінних замість падіння при старті */
export function readFirebaseConfig(env: Record<string, unknown>): ConfigResult {
  const missing: string[] = [];
  const config = {} as FirebaseWebConfig;
  for (const [field, envKey] of Object.entries(KEYS) as [keyof FirebaseWebConfig, string][]) {
    const value = env[envKey];
    if (typeof value === 'string' && value.trim() !== '') config[field] = value.trim();
    else missing.push(envKey);
  }
  return missing.length === 0 ? { ok: true, config } : { ok: false, missing };
}
