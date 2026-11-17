/**
 * Сховище на емуляторі Firestore: npm test запускає його через firebase emulators:exec
 * (FIRESTORE_EMULATOR_HOST). Без емулятора тести пропускаються.
 */

import { ksefInboxItem, type KsefInvoiceRef } from '@jdg/core';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { firestoreStore } from './firestore';

const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
const UID = `owner-${Date.now()}`;

const REF: KsefInvoiceRef = {
  ksefNumber: '7770000000-20261001-0A1B2C3D4E5F-AB',
  invoiceNumber: 'F/1',
  issueDate: '2026-10-01',
  acquisitionDate: '2026-10-01T08:00:00Z',
  permanentStorageDate: '2026-10-01T08:00:05Z',
  invoiceHash: 'aGFzaA==',
  sellerNip: '7770000000',
  currency: 'PLN',
  gross: 1230,
  formCode: 'FA',
  invoiceType: 'Vat',
};

describe.runIf(emulator)('firestoreStore (emulator)', () => {
  let app: App;
  let db: Firestore;

  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-jdg-ledger' }, `store-${UID}`);
    db = getFirestore(app);
  });
  afterAll(async () => {
    await deleteApp(app);
  });

  it('creates an inbox item once and never overwrites it', async () => {
    const store = firestoreStore(db, UID);
    const item = ksefInboxItem(REF, 'cost', 'not xml', {}, '2026-10-29T10:00:00Z');
    expect(await store.add(item)).toBe(true);

    const ref = db.doc(`users/${UID}/ksefInbox/${REF.ksefNumber}`);
    await ref.update({ status: 'accepted' });
    expect(await store.add({ ...item, invoiceNumber: 'changed' })).toBe(false);

    const saved = (await ref.get()).data();
    expect(saved).toMatchObject({
      status: 'accepted',
      invoiceNumber: 'F/1',
      role: 'cost',
      parseError: expect.any(String),
    });
    expect(await store.existing([REF.ksefNumber, 'missing-number'])).toEqual(new Set([REF.ksefNumber]));
    expect(await store.existing([])).toEqual(new Set());
  });

  it('keeps continuation points per role and the last run', async () => {
    const store = firestoreStore(db, UID);
    expect(await store.loadState()).toEqual({});
    await store.saveState('cost', { from: '2026-10-29T09:00:00Z', updatedAt: '2026-10-29T10:00:00Z' });
    await store.saveState('income', { from: '2026-10-28T09:00:00Z', updatedAt: '2026-10-29T10:00:00Z' });
    await store.saveState('cost', { from: '2026-10-30T09:00:00Z', updatedAt: '2026-10-30T10:00:00Z' });
    await store.saveLastRun({ at: '2026-10-30T10:00:00Z', ok: true, summary: 'нових: 0' });
    expect(await store.loadState()).toEqual({
      cost: { from: '2026-10-30T09:00:00Z', updatedAt: '2026-10-30T10:00:00Z' },
      income: { from: '2026-10-28T09:00:00Z', updatedAt: '2026-10-29T10:00:00Z' },
    });
    expect((await db.doc(`users/${UID}/ksefSync/state`).get()).get('lastRun.summary')).toBe('нових: 0');
  });

  it('reads vendor rules with decoded keys', async () => {
    await db.doc(`users/${UID}/vendorRules/7770000000`).set({ category: 'carMixed' });
    await db.doc(`users/${UID}/vendorRules/${encodeURIComponent('Sklep A/B')}`).set({ category: 'office' });
    expect(await firestoreStore(db, UID).vendorRules()).toEqual({
      '7770000000': { category: 'carMixed' },
      'Sklep A/B': { category: 'office' },
    });
  });
});
