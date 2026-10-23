import type { PeriodRecord } from '@jdg/core';
import { describe, expect, it } from 'vitest';
import { driftLabel, isCountKey, laterClosedPeriods, periodKey, SNAPSHOT_ROWS } from './closeView';

const rec = (status: PeriodRecord['status']): PeriodRecord => ({ status, confirmations: {} });

describe('closeView', () => {
  it('periodKey доповнює місяць нулем', () => {
    expect(periodKey(2026, 3)).toBe('2026-03');
    expect(periodKey(2026, 12)).toBe('2026-12');
  });

  it('laterClosedPeriods: лише закриті й пізніші, за порядком', () => {
    const periods = {
      '2026-01': rec('closed'),
      '2026-03': rec('closed'),
      '2026-05': rec('open'),
      '2026-04': rec('closed'),
      '2027-01': rec('closed'),
    };
    expect(laterClosedPeriods(periods, '2026-03')).toEqual(['2026-04', '2027-01']);
    expect(laterClosedPeriods(periods, '2027-01')).toEqual([]);
    expect(laterClosedPeriods({}, '2026-03')).toEqual([]);
  });

  it('driftLabel: підпис для показників знімка, ключ як є для решти', () => {
    expect(driftLabel('income')).toBe('Przychód');
    expect(driftLabel('cumulativeIncome')).toBe('cumulativeIncome');
  });

  it('isCountKey: лічильники не форматуються як гроші', () => {
    expect(isCountKey('missingFxRates')).toBe(true);
    expect(isCountKey('income')).toBe(false);
  });

  it('знімок закінчується підсумком до сплати', () => {
    expect(SNAPSHOT_ROWS.at(-1)!.key).toBe('totalToPay');
  });
});
