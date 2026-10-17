/**
 * Записи KPiR за взірцем, чинним з 1 січня 2026 (rozporządzenie MFiG z 6.09.2025, Dz.U. 2025 poz. 1299).
 * Книга окремо не зберігається: записи виводяться з документів, а FP — із розрахунку року.
 * Колонки 17 (вільна), 18 (koszty B+R) і 19 (uwagi) не ведуться.
 */

import {
  documentDates,
  fxDifference,
  valueDocument,
  type LedgerDocument,
  type LedgerOptions,
  type Stored,
} from './document';
import { CATEGORY_RULES, dueDates, type CostCategory, type MonthResult } from './tax';

export interface KpirEntry {
  /** Кол. 1 */
  lp: number;
  /** Кол. 2: data zdarzenia gospodarczego */
  date: string;
  /** Кол. 3: numer KSeF фактури */
  ksefNumber?: string;
  /** Кол. 4: numer dowodu księgowego */
  docNumber: string;
  /** Кол. 5: identyfikator podatkowy kontrahenta і код країни, що його надала */
  contractorCountry?: string;
  contractorTaxId?: string;
  /** Кол. 6–7: якщо заповнено кол. 5, у книзі необов'язкові */
  contractorName?: string;
  contractorAddress?: string;
  /** Кол. 8: opis zdarzenia gospodarczego */
  description: string;
  /** Кол. 9: wartość sprzedanych towarów i usług */
  col9: number;
  /** Кол. 10: pozostałe przychody */
  col10: number;
  /** Кол. 12: zakup towarów handlowych i materiałów */
  col12: number;
  /** Кол. 13: koszty uboczne zakupu */
  col13: number;
  /** Кол. 14: wynagrodzenia w gotówce i w naturze */
  col14: number;
  /** Кол. 15: pozostałe wydatki */
  col15: number;
  /** Звідки запис: документ, курсова різниця за ним або składki з розрахунку року */
  origin: 'document' | 'fxDifference' | 'contribution';
  documentId?: string;
}

/** Запис до нумерації: Lp. дає kpirBook */
export type KpirDraft = Omit<KpirEntry, 'lp'>;

type KpirAmounts = Pick<KpirEntry, 'col9' | 'col10' | 'col12' | 'col13' | 'col14' | 'col15'>;

/** Підсумок колонок; кол. 11 = 9 + 10, кол. 16 = 14 + 15 */
export interface KpirTotals extends KpirAmounts {
  col11: number;
  col16: number;
}

/** Типовий опис для кол. 8; книга ведеться польською (§ 6 ust. 1) */
const COST_DESCRIPTION: Record<CostCategory, string> = {
  carMixed: 'Eksploatacja samochodu',
  importServices: 'Import usług',
  office: 'Wydatki biurowe',
  other: 'Pozostałe wydatki',
};

function amountIn(column: 9 | 10 | 12 | 13 | 14 | 15, amount: number): KpirAmounts {
  const amounts: KpirAmounts = { col9: 0, col10: 0, col12: 0, col13: 0, col14: 0, col15: 0 };
  amounts[`col${column}` as const] = amount;
  return amounts;
}

/**
 * Записи року з документів: за датою події для PIT. Валютний документ без курсу пропускається.
 * Курсові різниці (art. 24c) дають окремий запис у день оплати: додатні в кол. 10, від'ємні в кол. 15.
 */
export function kpirFromDocuments(
  docs: readonly Stored<LedgerDocument>[],
  year: number,
  opts: LedgerOptions = {},
): KpirDraft[] {
  const drafts: KpirDraft[] = [];

  for (const doc of docs) {
    if (doc.kind === 'internal') {
      drafts.push({
        ...amountIn(doc.column, doc.amount),
        date: documentDates(doc).pit,
        docNumber: doc.number,
        description: doc.description ?? 'Dowód wewnętrzny',
        origin: 'document',
        documentId: doc.id,
      });
      continue;
    }

    const value = valueDocument(doc, opts.fx);
    if (!value) continue;
    drafts.push({
      ...(doc.kind === 'income'
        ? amountIn(9, value.pitAmount)
        : amountIn(CATEGORY_RULES[doc.category].kpirColumn, value.pitAmount)),
      date: value.dates.pit,
      ksefNumber: doc.ksefNumber,
      docNumber: doc.number,
      contractorCountry: doc.contractor.country,
      contractorTaxId: doc.contractor.nip,
      contractorName: doc.contractor.name,
      contractorAddress: doc.contractor.address,
      description: doc.description ?? (doc.kind === 'income' ? 'Sprzedaż usług' : COST_DESCRIPTION[doc.category]),
      origin: 'document',
      documentId: doc.id,
    });

    const diff = opts.fxDifferences === false ? null : fxDifference(doc, opts.fx);
    if (diff && diff.amount !== 0) {
      drafts.push({
        ...(diff.amount > 0 ? amountIn(10, diff.amount) : amountIn(15, -diff.amount)),
        date: diff.date,
        docNumber: `RK ${doc.number}`,
        description: `Różnice kursowe: ${doc.number}`,
        origin: 'fxDifference',
        documentId: doc.id,
      });
    }
  }

  return drafts.filter((d) => d.date.startsWith(`${year}-`));
}

/**
 * Składki в кол. 15 у місяці сплати — із розрахунку року (calcYear), щоб не вести їх ще й документом:
 * FP і zdrowotna, яку розрахунок вніс у koszty (healthInCosts). Społeczne в книгу не йдуть: вони
 * відлічуються від доходу. Дата запису — термін сплати.
 */
export function kpirContributions(year: number, results: readonly MonthResult[]): KpirDraft[] {
  const amountOf = (r: MonthResult) => r.fpPaid + r.healthInCosts;
  return results
    .filter((r) => amountOf(r) !== 0)
    .map((r): KpirDraft => {
      const forYear = r.month === 1 ? year - 1 : year;
      const forMonth = r.month === 1 ? 12 : r.month - 1;
      const period = `${String(forMonth).padStart(2, '0')}/${forYear}`;
      return {
        ...amountIn(15, amountOf(r)),
        date: dueDates(forYear, forMonth).zus,
        docNumber: `ZUS DRA ${period}`,
        description:
          r.healthInCosts > 0 ? `Składki ZUS (FP i zdrowotna) za ${period}` : `Składka na Fundusz Pracy za ${period}`,
        origin: 'contribution',
      };
    });
}

/** Книга: записи за датою, далі за номером документа, з наскрізною нумерацією */
export function kpirBook(drafts: readonly KpirDraft[]): KpirEntry[] {
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  return [...drafts]
    .sort((a, b) => cmp(a.date, b.date) || cmp(a.docNumber, b.docNumber))
    .map((d, i) => ({ ...d, lp: i + 1 }));
}

/** Підсумок колонок за місяць (1..12) або за всі записи, якщо місяць не вказано */
export function kpirTotals(entries: readonly KpirDraft[], month?: number): KpirTotals {
  const totals: KpirTotals = { col9: 0, col10: 0, col11: 0, col12: 0, col13: 0, col14: 0, col15: 0, col16: 0 };
  for (const e of entries) {
    if (month !== undefined && Number(e.date.slice(5, 7)) !== month) continue;
    totals.col9 += e.col9;
    totals.col10 += e.col10;
    totals.col12 += e.col12;
    totals.col13 += e.col13;
    totals.col14 += e.col14;
    totals.col15 += e.col15;
  }
  totals.col11 = totals.col9 + totals.col10;
  totals.col16 = totals.col14 + totals.col15;
  return totals;
}
