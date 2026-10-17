import type { ForeignCurrency, LedgerDocument, YearSettings } from '@jdg/core';
import { deleteDoc, doc, setDoc, writeBatch } from 'firebase/firestore';
import { useAuth } from '../auth/AuthContext';
import { db } from '../firebase/app';
import { paths } from '../firebase/paths';
import { useCollectionData, useDocData, type SnapshotState } from '../firebase/useSnapshot';
import { fxTable, type FxRateDoc } from './fxRates';
import { useMemo } from 'react';

/** uid поточного користувача або null до входу: тоді підписки немає */
function useOwnUid(): string | null {
  const { state } = useAuth();
  return state.status === 'signedIn' ? state.user.uid : null;
}

function requireDb() {
  if (!db) throw new Error('Firebase не налаштований');
  return db;
}

// ---------------------------------------------------------------- settings/{year}

/** Налаштування року; data = null, якщо ще не заповнені */
export function useYearSettings(year: number): SnapshotState<YearSettings | null> {
  const uid = useOwnUid();
  return useDocData<YearSettings>(uid ? paths.settings(uid, year) : null);
}

export function saveYearSettings(uid: string, year: number, settings: YearSettings): Promise<void> {
  return setDoc(doc(requireDb(), paths.settings(uid, year).join('/')), settings);
}

// ---------------------------------------------------------------- documents/{id}

/** Первинні документи: з них `@jdg/core` виводить KPiR, реєстри VAT і розрахунок року */
export function useDocuments(): SnapshotState<(LedgerDocument & { id: string })[]> {
  const uid = useOwnUid();
  return useCollectionData<LedgerDocument>(uid ? paths.documentsCollection(uid) : null);
}

export function saveDocument(uid: string, id: string, data: LedgerDocument): Promise<void> {
  return setDoc(doc(requireDb(), paths.document(uid, id).join('/')), data);
}

export function deleteDocument(uid: string, id: string): Promise<void> {
  return deleteDoc(doc(requireDb(), paths.document(uid, id).join('/')));
}

// ---------------------------------------------------------------- fxRates/{date}

/** Кеш курсів NBP для однієї валюти: 'YYYY-MM-DD' → mid */
export function useFxRates(currency: ForeignCurrency): SnapshotState<Record<string, number>> {
  const uid = useOwnUid();
  const state = useCollectionData<FxRateDoc>(uid ? paths.fxRatesCollection(uid) : null);
  return useMemo(
    () => (state.status === 'ready' ? { status: 'ready', data: fxTable(state.data, currency) } : state),
    [state, currency],
  );
}

/** Дописує курси в кеш; merge, щоб EUR і USD того самого дня не затирали одне одного */
export async function saveFxRates(uid: string, currency: ForeignCurrency, rates: Record<string, number>) {
  const firestore = requireDb();
  const entries = Object.entries(rates);
  // ліміт Firestore: 500 операцій на пакет
  for (let i = 0; i < entries.length; i += 500) {
    const batch = writeBatch(firestore);
    for (const [date, mid] of entries.slice(i, i + 500)) {
      batch.set(doc(firestore, paths.fxRate(uid, date).join('/')), { [currency]: mid }, { merge: true });
    }
    await batch.commit();
  }
}
