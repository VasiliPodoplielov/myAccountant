import { calcYearFromDocuments, TAX_CONFIG, type LedgerDocument, type MonthResult, type PeriodRecord } from '@jdg/core';
import { useMemo } from 'react';
import { useDocuments, useFxRates, usePeriods, useYearSettings } from '../data/hooks';
import { EMPTY_SETTINGS } from '../settings/settingsForm';

export type LedgerYear =
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | {
      status: 'ready';
      docs: (LedgerDocument & { id: string })[];
      fx: { EUR: Record<string, number>; USD: Record<string, number> };
      /** Стан місяців ('YYYY-MM'); місяця без запису тут немає, і він відкритий */
      periods: Record<string, PeriodRecord>;
      /** Налаштування року ще не заповнені: ZUS і zaliczka рахуються без даних за грудень */
      hasSettings: boolean;
      /** Розрахунок року; null, якщо він не вдався (error) */
      results: MonthResult[] | null;
      error: string | null;
    };

/** Дані року й розрахунок з документів; спільне для екранів «Рік» і «Місяць» */
export function useLedgerYear(year: number): LedgerYear {
  const docs = useDocuments();
  const settings = useYearSettings(year);
  const eur = useFxRates('EUR');
  const usd = useFxRates('USD');
  const periods = usePeriods();

  return useMemo((): LedgerYear => {
    const states = [docs, settings, eur, usd, periods];
    const failed = states.find((s) => s.status === 'error');
    if (failed?.status === 'error') return { status: 'error', error: failed.error };
    if (
      docs.status !== 'ready' ||
      settings.status !== 'ready' ||
      eur.status !== 'ready' ||
      usd.status !== 'ready' ||
      periods.status !== 'ready'
    ) {
      return { status: 'loading' };
    }
    const cfg = TAX_CONFIG[year];
    const fx = { EUR: eur.data, USD: usd.data };
    if (!cfg) {
      return {
        status: 'ready',
        docs: docs.data,
        fx,
        periods: periods.data,
        hasSettings: false,
        results: null,
        error: `Немає ставок на ${year} рік`,
      };
    }
    try {
      const results = calcYearFromDocuments(docs.data, settings.data ?? EMPTY_SETTINGS, cfg, { fx });
      return {
        status: 'ready',
        docs: docs.data,
        fx,
        periods: periods.data,
        hasSettings: settings.data !== null,
        results,
        error: null,
      };
    } catch (e) {
      return {
        status: 'ready',
        docs: docs.data,
        fx,
        periods: periods.data,
        hasSettings: settings.data !== null,
        results: null,
        error: (e as Error).message,
      };
    }
  }, [docs, settings, eur, usd, periods, year]);
}
