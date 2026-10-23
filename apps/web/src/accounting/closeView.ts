import { jpkPeriod, type MonthResult, type PeriodRecord } from '@jdg/core';

/** Показники знімка місяця, які показуємо після закриття */
export const SNAPSHOT_ROWS: { key: keyof MonthResult; label: string }[] = [
  { key: 'income', label: 'Przychód' },
  { key: 'pitCosts', label: 'Koszty PIT (документи)' },
  { key: 'vatDue', label: 'VAT до сплати' },
  { key: 'zusTotal', label: 'ZUS: społeczne + FP' },
  { key: 'health', label: 'Zdrowotna' },
  { key: 'pitAdvance', label: 'Zaliczka PIT' },
  { key: 'totalToPay', label: 'Разом до сплати' },
];

/** Підписи для показників, що змінилися після закриття; невідомий ключ показується як є */
export function driftLabel(key: keyof MonthResult): string {
  return SNAPSHOT_ROWS.find((r) => r.key === key)?.label ?? key;
}

/** Показники-лічильники, не гроші */
export const isCountKey = (key: keyof MonthResult) => key === 'month' || key === 'missingFxRates';

/** Усі місяці з записом `closed`, що йдуть після вказаного ('YYYY-MM'); їхні знімки може зачепити повторне відкриття */
export function laterClosedPeriods(periods: Readonly<Record<string, PeriodRecord>>, period: string): string[] {
  return Object.keys(periods)
    .filter((p) => p > period && periods[p]!.status === 'closed')
    .sort();
}

/** Ключ місяця 'YYYY-MM' */
export const periodKey = (year: number, month: number) => jpkPeriod({ year, month });
