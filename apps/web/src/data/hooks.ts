import type { ContractorRule, ForeignCurrency, LedgerDocument, MonthReference, YearSettings } from '@jdg/core';
import { deleteDoc, deleteField, doc, setDoc, writeBatch, type Firestore, type WriteBatch } from 'firebase/firestore';
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

// ---------------------------------------------------------------- batches

/** Пише операції пакетами: ліміт Firestore — 500 операцій на пакет */
async function inBatches<T>(firestore: Firestore, items: readonly T[], op: (batch: WriteBatch, item: T) => void) {
  for (let i = 0; i < items.length; i += 500) {
    const batch = writeBatch(firestore);
    for (const item of items.slice(i, i + 500)) op(batch, item);
    await batch.commit();
  }
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
  await inBatches(firestore, Object.entries(rates), (batch, [date, mid]) =>
    batch.set(doc(firestore, paths.fxRate(uid, date).join('/')), { [currency]: mid }, { merge: true }),
  );
}

// ---------------------------------------------------------------- vendorRules/{key}

/** Правила контрагентів: ключ — NIP або назва (id документа декодується назад) */
export function useVendorRules(): SnapshotState<Record<string, ContractorRule>> {
  const uid = useOwnUid();
  const state = useCollectionData<ContractorRule>(uid ? paths.vendorRulesCollection(uid) : null);
  return useMemo(
    () =>
      state.status === 'ready'
        ? {
            status: 'ready',
            data: Object.fromEntries(state.data.map(({ id, ...rule }) => [decodeURIComponent(id), rule])),
          }
        : state,
    [state],
  );
}

// ---------------------------------------------------------------- reference/{yyyy-mm}

/** Еталон бухгалтера за місяці: 'YYYY-MM' → еталон */
export function useReferences(): SnapshotState<Record<string, MonthReference>> {
  const uid = useOwnUid();
  const state = useCollectionData<MonthReference>(uid ? paths.referenceCollection(uid) : null);
  return useMemo(
    () =>
      state.status === 'ready'
        ? { status: 'ready', data: Object.fromEntries(state.data.map(({ id, ...ref }) => [id, ref])) }
        : state,
    [state],
  );
}

type ReferencePart = keyof Omit<MonthReference, 'notes'> | 'notes';

/**
 * Записує лише вказані частини еталона, решту лишає: JPK не затирає внесене вручну з KPiR і DRA.
 * Частина без значення видаляється.
 */
export function saveReferenceParts(
  uid: string,
  period: string,
  parts: Partial<MonthReference>,
  fields: readonly ReferencePart[],
): Promise<void> {
  const data = Object.fromEntries(fields.map((f) => [f, parts[f] ?? deleteField()]));
  return setDoc(doc(requireDb(), paths.reference(uid, period).join('/')), data, { mergeFields: [...fields] });
}

// ---------------------------------------------------------------- JPK import

export interface ImportWrite {
  rules: Record<string, ContractorRule>;
  documents: (LedgerDocument & { id: string })[];
  /** Документи попереднього імпорту, яких у нових файлах уже немає */
  remove: string[];
  references: Record<string, Pick<MonthReference, 'vat' | 'sales' | 'purchases'>>;
}

/** Імпорт JPK: правила контрагентів, документи (id стабільні, тож повтор перезаписує), еталон з JPK */
export async function saveJpkImport(uid: string, write: ImportWrite): Promise<void> {
  const firestore = requireDb();
  const ops: ((batch: WriteBatch) => void)[] = [
    ...Object.entries(write.rules).map(
      ([key, rule]) =>
        (b: WriteBatch) =>
          b.set(doc(firestore, paths.vendorRule(uid, key).join('/')), rule),
    ),
    ...write.documents.map(
      ({ id, ...data }) =>
        (b: WriteBatch) =>
          b.set(doc(firestore, paths.document(uid, id).join('/')), data),
    ),
    ...write.remove.map((id) => (b: WriteBatch) => b.delete(doc(firestore, paths.document(uid, id).join('/')))),
    ...Object.entries(write.references).map(
      ([period, ref]) =>
        (b: WriteBatch) =>
          b.set(
            doc(firestore, paths.reference(uid, period).join('/')),
            {
              vat: ref.vat ?? deleteField(),
              sales: ref.sales ?? deleteField(),
              purchases: ref.purchases ?? deleteField(),
            },
            { mergeFields: ['vat', 'sales', 'purchases'] },
          ),
    ),
  ];
  await inBatches(firestore, ops, (batch, op) => op(batch));
}
