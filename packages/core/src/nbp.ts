/**
 * Клієнт NBP: середні курси tabela A для EUR і USD.
 * Результат — мапа 'YYYY-MM-DD' → mid, яку приймає nbpRateFor.
 * Кеш у Firestore (fxRates) додається на етапі 3.
 */

import { isIsoDate } from './dates';
import type { Currency } from './tax';

export type ForeignCurrency = Exclude<Currency, 'PLN'>;

export const NBP_BASE_URL = 'https://api.nbp.pl/api/exchangerates/rates/a';

/** API NBP віддає не більше 367 днів за запит */
const MAX_RANGE_DAYS = 367;
const DAY_MS = 86_400_000;

export type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

interface NbpResponse {
  rates: { effectiveDate: string; mid: number }[];
}

/** Пакет без DOM-типів: глобальний fetch (браузер, Node 22) беремо через globalThis */
const defaultFetch: FetchLike = (url) => (globalThis as unknown as { fetch: FetchLike }).fetch(url);

const addDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** Розбиває [from, to] на відрізки, які вкладаються в ліміт NBP */
export function splitRange(from: string, to: string): [string, string][] {
  const chunks: [string, string][] = [];
  let start = from;
  while (start <= to) {
    const end = addDays(start, MAX_RANGE_DAYS - 1);
    chunks.push([start, end < to ? end : to]);
    start = addDays(end, 1);
  }
  return chunks;
}

export function nbpUrl(currency: ForeignCurrency, from: string, to: string): string {
  return `${NBP_BASE_URL}/${currency.toLowerCase()}/${from}/${to}/?format=json`;
}

/**
 * Завантажує курси `currency` за період [from, to] (включно, 'YYYY-MM-DD').
 * Для nbpRateFor беріть `from` приблизно на 10 днів раніше за першу фактуру.
 * Період без публікацій (404 від NBP) дає порожню мапу, інші помилки — виняток.
 */
export async function fetchNbpRates(
  currency: ForeignCurrency,
  from: string,
  to: string,
  fetchFn: FetchLike = defaultFetch,
): Promise<Record<string, number>> {
  if (!isIsoDate(from) || !isIsoDate(to)) throw new Error(`NBP: некоректна дата (${from} – ${to})`);
  if (from > to) throw new Error(`NBP: початок періоду ${from} пізніше за кінець ${to}`);

  const table: Record<string, number> = {};
  for (const [start, end] of splitRange(from, to)) {
    const res = await fetchFn(nbpUrl(currency, start, end));
    if (res.status === 404) continue;
    if (!res.ok) throw new Error(`NBP: HTTP ${res.status} для ${currency} ${start} – ${end}`);
    const body = (await res.json()) as NbpResponse;
    for (const r of body.rates) table[r.effectiveDate] = r.mid;
  }
  return table;
}
