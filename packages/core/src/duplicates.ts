/**
 * Пошук уже внесеного документа з тим самим номером і контрагентом: форма «Додати документ» показує його,
 * щоб один рахунок не потрапив у облік двічі (кожне збереження створює новий запис з новим id).
 */

import { documentDates, type LedgerDocument } from './document';

export interface DocumentKey {
  kind: 'income' | 'cost';
  number: string;
  contractorName: string;
  contractorNip?: string;
}

const normalizeText = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
const normalizeNip = (s: string | undefined) => (s ?? '').replace(/[\s-]/g, '').replace(/^PL/i, '');

/**
 * Документи з таким самим видом і номером від того самого контрагента. Контрагент збігається за NIP,
 * якщо він є в обох, інакше за назвою. Порожній номер чи назва нічого не знаходять.
 */
export function findSameDocuments<T extends LedgerDocument>(
  key: DocumentKey,
  existing: readonly T[],
): (T & { kind: 'income' | 'cost' })[] {
  const number = normalizeText(key.number);
  const name = normalizeText(key.contractorName);
  if (!number || !name) return [];
  const nip = normalizeNip(key.contractorNip);
  return existing.filter((doc): doc is T & { kind: 'income' | 'cost' } => {
    if (doc.kind === 'internal' || doc.kind !== key.kind) return false;
    if (normalizeText(doc.number) !== number) return false;
    const otherNip = normalizeNip(doc.contractor.nip);
    return nip && otherNip ? nip === otherNip : normalizeText(doc.contractor.name) === name;
  });
}

/** Місяць 'YYYY-MM', у якому документ видно на екрані «Місяць» (за датою PIT) */
export const documentMonth = (doc: LedgerDocument): string => documentDates(doc).pit.slice(0, 7);
