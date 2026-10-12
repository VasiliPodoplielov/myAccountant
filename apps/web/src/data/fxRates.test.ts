import { nbpRateFor } from '@jdg/core';
import { describe, expect, it } from 'vitest';
import { fxTable, missingFxRates } from './fxRates';

const docs = [
  { id: '2026-03-02', EUR: 4.2, USD: 3.9 },
  { id: '2026-03-03', EUR: 4.25 },
  { id: '2026-03-04', USD: 3.95 },
];

describe('fxTable', () => {
  it('бере лише обрану валюту', () => {
    expect(fxTable(docs, 'EUR')).toEqual({ '2026-03-02': 4.2, '2026-03-03': 4.25 });
    expect(fxTable(docs, 'USD')).toEqual({ '2026-03-02': 3.9, '2026-03-04': 3.95 });
  });

  it('порожній кеш дає порожню таблицю', () => {
    expect(fxTable([], 'EUR')).toEqual({});
  });

  it('результат придатний для nbpRateFor: курс з останнього дня перед фактурою', () => {
    expect(nbpRateFor('2026-03-04', fxTable(docs, 'EUR'))).toEqual({ rate: 4.25, date: '2026-03-03' });
  });
});

describe('missingFxRates', () => {
  it('повертає лише дати, яких немає в кеші для цієї валюти', () => {
    const fetched = { '2026-03-02': 4.2, '2026-03-03': 4.25, '2026-03-05': 4.3 };
    expect(missingFxRates(fxTable(docs, 'EUR'), fetched)).toEqual({ '2026-03-05': 4.3 });
  });

  it('день, де є лише інша валюта, вважається відсутнім', () => {
    expect(missingFxRates(fxTable(docs, 'EUR'), { '2026-03-04': 4.1 })).toEqual({ '2026-03-04': 4.1 });
  });

  it('усе вже в кеші: нічого писати', () => {
    expect(missingFxRates(fxTable(docs, 'USD'), { '2026-03-02': 3.9 })).toEqual({});
  });
});
