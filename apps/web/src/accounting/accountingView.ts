import {
  dueDates,
  jpkPeriod,
  documentDates,
  valueDocument,
  type FxTables,
  type LedgerDocument,
  type MonthResult,
} from '@jdg/core';

/** Підсумок року: суми місяців; надвишку VAT і накопичувані показники не складаємо */
export interface YearTotals {
  income: number;
  costs: number;
  vatDue: number;
  zus: number;
  health: number;
  pitAdvance: number;
  totalToPay: number;
  netCash: number;
  missingFxRates: number;
}

/**
 * Koszty місяця, як у KPiR (кол. 15): koszty PIT із документів плюс FP і zdrowotna в kosztach, сплачені
 * в цьому місяці. Саме цю суму порівнює «Звірка».
 */
export const kpirCosts = (r: MonthResult): number => r.pitCosts + r.fpPaid + r.healthInCosts;

export function yearTotals(results: readonly MonthResult[]): YearTotals {
  const total: YearTotals = {
    income: 0,
    costs: 0,
    vatDue: 0,
    zus: 0,
    health: 0,
    pitAdvance: 0,
    totalToPay: 0,
    netCash: 0,
    missingFxRates: 0,
  };
  for (const r of results) {
    total.income += r.income;
    total.costs += kpirCosts(r);
    total.vatDue += r.vatDue;
    total.zus += r.zusTotal;
    total.health += r.health;
    total.pitAdvance += r.pitAdvance;
    total.totalToPay += r.totalToPay;
    total.netCash += r.netCash;
    total.missingFxRates += r.missingFxRates;
  }
  return total;
}

export interface Payment {
  key: 'zus' | 'health' | 'pit' | 'vat';
  label: string;
  amount: number;
  /** Термін сплати, 'YYYY-MM-DD' */
  due: string;
}

/** Що і до якого числа платити за місяць (ZUS, zdrowotna, PIT — до 20-го M+1; VAT — до 25-го) */
export function monthPayments(year: number, result: MonthResult): Payment[] {
  const due = dueDates(year, result.month);
  return [
    { key: 'zus', label: 'ZUS: społeczne + FP', amount: result.zusTotal, due: due.zus },
    { key: 'health', label: 'ZUS: zdrowotna', amount: result.health, due: due.health },
    { key: 'pit', label: 'Zaliczka PIT', amount: result.pitAdvance, due: due.pit },
    { key: 'vat', label: 'VAT (JPK_V7M)', amount: result.vatDue, due: due.vat },
  ];
}

export interface MonthDocumentRow {
  id: string;
  kind: LedgerDocument['kind'];
  number: string;
  /** Назва контрагента; для внутрішнього документа — порожньо */
  contractor: string;
  description?: string;
  pitDate: string;
  vatDate: string | null;
  /** Przychód (дохід) або koszt PIT; для внутрішнього — сума зі знаком колонки (10 — дохід, 15 — витрата) */
  pitAmount: number | null;
  /** VAT документа; null — немає */
  vat: number | null;
  /** Документ потрапляє в KPiR цього місяця (за датою PIT) */
  inKpir: boolean;
  /** Документ потрапляє в реєстр VAT цього місяця */
  inVat: boolean;
  /** Валютний документ без курсу: не враховано в сумах */
  missingFx: boolean;
}

/**
 * Документи, що стосуються місяця: за датою події для PIT (KPiR) або за датою VAT (реєстр).
 * Від найранішої дати до найпізнішої.
 */
export function monthDocuments(
  docs: readonly (LedgerDocument & { id: string })[],
  year: number,
  month: number,
  fx: FxTables = {},
): MonthDocumentRow[] {
  const key = jpkPeriod({ year, month });
  const rows: MonthDocumentRow[] = [];
  for (const doc of docs) {
    const dates = documentDates(doc);
    const inKpir = dates.pit.startsWith(key);
    const inVat = dates.vat?.startsWith(key) ?? false;
    if (!inKpir && !inVat) continue;

    const base = {
      id: doc.id,
      kind: doc.kind,
      number: doc.number,
      description: doc.description,
      pitDate: dates.pit,
      vatDate: dates.vat,
      inKpir,
      inVat,
    };
    if (doc.kind === 'internal') {
      rows.push({
        ...base,
        contractor: '',
        pitAmount: doc.column === 10 ? doc.amount : -doc.amount,
        vat: null,
        missingFx: false,
      });
      continue;
    }
    const value = valueDocument(doc, fx);
    rows.push({
      ...base,
      contractor: doc.contractor.name,
      pitAmount: value?.pitAmount ?? null,
      vat: value ? value.vat : null,
      missingFx: value === null,
    });
  }
  return rows.sort((a, b) => a.pitDate.localeCompare(b.pitDate) || a.number.localeCompare(b.number));
}

/** Рядок про термін: «20.11.2026» */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}
