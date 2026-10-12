import { describe, expect, it } from 'vitest';
import { fetchNbpRates, nbpUrl, splitRange, type FetchLike } from './nbp';
import { costNetPln, nbpRateFor } from './tax';

const ok = (rates: { effectiveDate: string; mid: number }[]) => ({
  ok: true,
  status: 200,
  json: async () => ({ rates }),
});

describe('NBP клієнт', () => {
  it('будує URL для EUR і USD', () => {
    expect(nbpUrl('EUR', '2026-01-01', '2026-01-31')).toBe(
      'https://api.nbp.pl/api/exchangerates/rates/a/eur/2026-01-01/2026-01-31/?format=json',
    );
    expect(nbpUrl('USD', '2026-01-01', '2026-01-31')).toContain('/usd/');
  });

  it('перетворює відповідь на мапу date → mid', async () => {
    const urls: string[] = [];
    const fetchFn: FetchLike = async (url) => {
      urls.push(url);
      return ok([
        { effectiveDate: '2026-03-02', mid: 4.25 },
        { effectiveDate: '2026-03-03', mid: 4.26 },
      ]);
    };
    const table = await fetchNbpRates('EUR', '2026-03-01', '2026-03-31', fetchFn);
    expect(table).toEqual({ '2026-03-02': 4.25, '2026-03-03': 4.26 });
    expect(urls).toHaveLength(1);
  });

  it('курс USD працює з nbpRateFor і costNetPln', async () => {
    const fetchFn: FetchLike = async () => ok([{ effectiveDate: '2026-03-06', mid: 3.7 }]); // пʼятниця
    const table = await fetchNbpRates('USD', '2026-03-01', '2026-03-31', fetchFn);
    const found = nbpRateFor('2026-03-09', table); // понеділок → попередній робочий день
    expect(found).toEqual({ rate: 3.7, date: '2026-03-06' });
    expect(
      costNetPln({
        month: 3,
        currency: 'USD',
        amount: 1_000,
        vatRate: 0.23,
        category: 'importServices',
        fxRate: found!.rate,
      }),
    ).toBe(3_700);
  });

  it('ділить довгий період на запити по ≤367 днів і зводить результат', async () => {
    const calls: string[] = [];
    const fetchFn: FetchLike = async (url) => {
      calls.push(url);
      return ok([{ effectiveDate: `2026-01-0${calls.length}`, mid: 4 + calls.length }]);
    };
    const table = await fetchNbpRates('EUR', '2025-01-01', '2026-12-31', fetchFn);
    expect(calls).toHaveLength(2);
    expect(Object.keys(table)).toHaveLength(2);
  });

  it('splitRange не залишає прогалин і не перекриває відрізки', () => {
    const chunks = splitRange('2025-01-01', '2026-12-31');
    expect(chunks[0][0]).toBe('2025-01-01');
    expect(chunks[chunks.length - 1][1]).toBe('2026-12-31');
    expect(chunks[0][1]).toBe('2026-01-02'); // 367 днів включно
    expect(chunks[1][0]).toBe('2026-01-03');
  });

  it('404 (немає публікацій у періоді) дає порожню мапу', async () => {
    const fetchFn: FetchLike = async () => ({ ok: false, status: 404, json: async () => ({}) });
    expect(await fetchNbpRates('EUR', '2026-01-01', '2026-01-01', fetchFn)).toEqual({});
  });

  it('інші HTTP-помилки кидають виняток', async () => {
    const fetchFn: FetchLike = async () => ({ ok: false, status: 500, json: async () => ({}) });
    await expect(fetchNbpRates('EUR', '2026-01-01', '2026-01-31', fetchFn)).rejects.toThrow('HTTP 500');
  });

  it('відхиляє некоректні дати і перевернутий період', async () => {
    const fetchFn: FetchLike = async () => ok([]);
    await expect(fetchNbpRates('EUR', '2026-13-01', '2026-01-31', fetchFn)).rejects.toThrow('некоректна дата');
    await expect(fetchNbpRates('EUR', '2026-02-01', '2026-01-31', fetchFn)).rejects.toThrow('пізніше');
  });
});
