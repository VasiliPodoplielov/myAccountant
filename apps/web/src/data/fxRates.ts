import type { ForeignCurrency } from '@jdg/core';

/** Документ fxRates/{YYYY-MM-DD}: середні курси NBP за день, окремо по валютах */
export type FxRateDoc = Partial<Record<ForeignCurrency, number>>;

/** Таблиця 'YYYY-MM-DD' → mid для однієї валюти, у форматі, який приймає nbpRateFor */
export function fxTable(
  docs: readonly (FxRateDoc & { id: string })[],
  currency: ForeignCurrency,
): Record<string, number> {
  const table: Record<string, number> = {};
  for (const d of docs) {
    const mid = d[currency];
    if (typeof mid === 'number') table[d.id] = mid;
  }
  return table;
}

/** Курси, яких ще немає в кеші цієї валюти (таблиця з fxTable / useFxRates): щоб писати лише нове */
export function missingFxRates(have: Record<string, number>, fetched: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(fetched).filter(([date]) => !(date in have)));
}
