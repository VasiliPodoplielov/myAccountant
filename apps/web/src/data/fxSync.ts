import { fetchNbpRates, type ForeignCurrency } from '@jdg/core';
import { saveFxRates } from './hooks';
import { missingFxRates } from './fxRates';

/**
 * Тягне курси NBP за період і дописує в кеш лише ті дати, яких там ще немає.
 * cached — таблиця цієї валюти з useFxRates(currency).
 */
export async function syncFxRates(
  uid: string,
  currency: ForeignCurrency,
  from: string,
  to: string,
  cached: Record<string, number>,
): Promise<number> {
  const fresh = missingFxRates(cached, await fetchNbpRates(currency, from, to));
  await saveFxRates(uid, currency, fresh);
  return Object.keys(fresh).length;
}
