import { describe, expect, it } from 'vitest';
import { readFirebaseConfig } from './config';

const full = {
  VITE_FIREBASE_API_KEY: 'k',
  VITE_FIREBASE_AUTH_DOMAIN: 'a.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'p',
  VITE_FIREBASE_STORAGE_BUCKET: 'p.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '1',
  VITE_FIREBASE_APP_ID: '1:1:web:1',
};

describe('readFirebaseConfig', () => {
  it('збирає конфіг з повного env', () => {
    expect(readFirebaseConfig(full)).toEqual({
      ok: true,
      config: {
        apiKey: 'k',
        authDomain: 'a.firebaseapp.com',
        projectId: 'p',
        storageBucket: 'p.appspot.com',
        messagingSenderId: '1',
        appId: '1:1:web:1',
      },
    });
  });

  it('порожній env: усі шість змінних відсутні', () => {
    const r = readFirebaseConfig({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toHaveLength(6);
  });

  it('порожній рядок і пробіли вважаються відсутніми', () => {
    const r = readFirebaseConfig({ ...full, VITE_FIREBASE_API_KEY: '  ', VITE_FIREBASE_APP_ID: '' });
    expect(r).toEqual({ ok: false, missing: ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_APP_ID'] });
  });

  it('не-рядкове значення вважається відсутнім', () => {
    const r = readFirebaseConfig({ ...full, VITE_FIREBASE_PROJECT_ID: undefined });
    expect(r).toEqual({ ok: false, missing: ['VITE_FIREBASE_PROJECT_ID'] });
  });

  it('обрізає пробіли навколо значень', () => {
    const r = readFirebaseConfig({ ...full, VITE_FIREBASE_API_KEY: ' k ' });
    expect(r.ok && r.config.apiKey).toBe('k');
  });
});
