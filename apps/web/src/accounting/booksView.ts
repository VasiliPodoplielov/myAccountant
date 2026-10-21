import {
  kpirBook,
  kpirContributions,
  kpirFromDocuments,
  kpirTotals,
  vatDeclaration,
  vatRegistersByMonth,
  vatTotals,
  type FxTables,
  type KpirEntry,
  type KpirTotals,
  type LedgerDocument,
  type MonthResult,
  type PurchaseVatField,
  type SalesVatField,
  type VatPurchaseRow,
  type VatSalesRow,
} from '@jdg/core';

export interface MonthBooks {
  /** Записи KPiR місяця; Lp. наскрізний з початку року, як у книзі */
  kpir: KpirEntry[];
  kpirTotals: KpirTotals;
  /** Наростаючий підсумок KPiR з початку року по цей місяць включно (кол. 9–16) */
  kpirYearToDate: KpirTotals;
  sales: VatSalesRow[];
  purchases: VatPurchaseRow[];
  salesTotals: Partial<Record<SalesVatField, number>>;
  purchaseTotals: Partial<Record<PurchaseVatField, number>>;
  /** VAT декларації: кожна позиція округлена до злотих окремо */
  declaration: { output: number; input: number; reverseCharge: number };
}

/**
 * KPiR і реєстри VAT за місяць з документів. Книга нумерується наскрізно за рік (Lp. не починається
 * з 1 у кожному місяці), тож записи будуються за весь рік, а потім відбирається місяць.
 * Без розрахунку року (results = null) записів «Składki ZUS» немає: книга неповна.
 */
export function monthBooks(
  docs: readonly (LedgerDocument & { id: string })[],
  results: readonly MonthResult[] | null,
  year: number,
  month: number,
  fx: FxTables = {},
): MonthBooks {
  const drafts = [...kpirFromDocuments(docs, year, { fx }), ...(results ? kpirContributions(year, results) : [])];
  const book = kpirBook(drafts);
  const kpir = book.filter((e) => Number(e.date.slice(5, 7)) === month);
  const yearToDate = book.filter((e) => Number(e.date.slice(5, 7)) <= month);

  const registers = vatRegistersByMonth(docs, year, { fx })[month - 1];
  return {
    kpir,
    kpirTotals: kpirTotals(kpir),
    kpirYearToDate: kpirTotals(yearToDate),
    sales: registers.sales,
    purchases: registers.purchases,
    salesTotals: vatTotals(registers.sales),
    purchaseTotals: vatTotals(registers.purchases),
    declaration: vatDeclaration(registers),
  };
}

/** Поля реєстру продажу в порядку ewidencji JPK_V7M(3) */
export const SALES_FIELD_ORDER: SalesVatField[] = [
  'K_10',
  'K_11',
  'K_12',
  'K_13',
  'K_15',
  'K_16',
  'K_17',
  'K_18',
  'K_19',
  'K_20',
  'K_27',
  'K_28',
  'K_29',
  'K_30',
];

export const PURCHASE_FIELD_ORDER: PurchaseVatField[] = ['K_42', 'K_43'];

/** Поля, що справді є в рядках: порожніх колонок на екрані й у CSV немає */
export function usedFields<F extends string>(order: readonly F[], totals: Partial<Record<F, number>>): F[] {
  return order.filter((f) => totals[f] !== undefined);
}

/** Кол. 5 KPiR: ідентифікатор з кодом країни; порожньо, якщо його немає */
export function kpirTaxId(e: KpirEntry): string {
  return e.contractorTaxId ? `${e.contractorCountry ?? ''}${e.contractorTaxId}` : '';
}

/** Контрагент для кол. 5–7 KPiR: ідентифікатор з кодом країни й назва */
export function kpirContractor(e: KpirEntry): string {
  return [kpirTaxId(e), e.contractorName].filter(Boolean).join(' · ');
}
