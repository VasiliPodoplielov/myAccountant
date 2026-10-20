import { calcYearFromDocuments, TAX_CONFIG, type MonthReport, type YearSettings } from '@jdg/core';
import { describe, expect, it } from 'vitest';
import { toCsv } from '../csv';
import { kpirCosts } from './accountingView';
import { RECONCILIATION_CSV_HEADER, YEAR_CSV_HEADER, reconciliationCsvRows, yearCsvRows } from './exportCsv';

const cfg = TAX_CONFIG[2026]!;
const settings: YearSettings = {
  chorobowe: false,
  prevDecemberIncome: 1_000_000,
  prevDecemberContributions: null,
  contributionHolidayMonth: 2,
};

describe('kpirCosts', () => {
  it('koszty PIT плюс FP і zdrowotna в kosztach, сплачені в місяці (як кол. 15 у «Звірці»)', () => {
    const [jan, feb] = calcYearFromDocuments([], settings, cfg);
    // у січні нічого не сплачено, у лютому сплачено FP і zdrowotną за січень
    expect(kpirCosts(jan!)).toBe(0);
    expect(feb!.fpPaid).toBeGreaterThan(0);
    expect(feb!.healthInCosts).toBeGreaterThan(0);
    expect(kpirCosts(feb!)).toBe(feb!.fpPaid + feb!.healthInCosts);
  });
});

describe('yearCsvRows', () => {
  const results = calcYearFromDocuments([], settings, cfg);
  const rows = yearCsvRows(results);

  it('12 місяців, у кожному рядку стільки значень, скільки колонок', () => {
    expect(rows).toHaveLength(12);
    for (const r of rows) expect(r).toHaveLength(YEAR_CSV_HEADER.length);
  });

  it('суми в злотих з крапкою; kpir_costs збігається з kpirCosts', () => {
    const col = YEAR_CSV_HEADER.indexOf('kpir_costs');
    expect(rows[1]![col]).toBe(
      `${Math.floor(kpirCosts(results[1]!) / 100)}.${String(kpirCosts(results[1]!) % 100).padStart(2, '0')}`,
    );
    expect(toCsv(YEAR_CSV_HEADER, rows).split('\r\n')[0]).toBe(YEAR_CSV_HEADER.join(';'));
  });
});

describe('reconciliationCsvRows', () => {
  const months: MonthReport[] = [
    {
      month: 1,
      period: '2026-01',
      hasReference: true,
      unexplained: 1,
      rows: [
        { metric: 'kpir.col15', app: 172775, reference: 172000, diff: 775 },
        { metric: 'vat.due', app: 100, reference: 100, diff: 0, note: 'ok; "так"' },
      ],
    },
    { month: 2, period: '2026-02', hasReference: false, unexplained: 0, rows: [] },
  ];

  it('рядок на показник, місяць без еталона — один рядок з has_reference = 0', () => {
    const rows = reconciliationCsvRows(months);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual([
      '2026-01',
      1,
      'kpir.col15',
      'KPiR, кол. 15: pozostałe wydatki',
      '1727.75',
      '1720.00',
      '7.75',
      '',
    ]);
    expect(rows[2]).toEqual(['2026-02', 0, '', '', '', '', '', '']);
    for (const r of rows) expect(r).toHaveLength(RECONCILIATION_CSV_HEADER.length);
  });

  it('примітка з крапкою з комою й лапками екранується', () => {
    const csv = toCsv(RECONCILIATION_CSV_HEADER, reconciliationCsvRows(months));
    expect(csv).toContain('"ok; ""так"""');
  });
});
