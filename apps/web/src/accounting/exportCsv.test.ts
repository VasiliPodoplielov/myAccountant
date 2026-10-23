import {
  calcYearFromDocuments,
  TAX_CONFIG,
  type KpirEntry,
  type MonthReport,
  type StoredDocument,
  type YearSettings,
} from '@jdg/core';
import { describe, expect, it } from 'vitest';
import { toCsv } from '../csv';
import { kpirCosts } from './accountingView';
import {
  DOCUMENTS_CSV_HEADER,
  KPIR_CSV_HEADER,
  RECONCILIATION_CSV_HEADER,
  YEAR_CSV_HEADER,
  documentsCsvRows,
  kpirCsvRows,
  reconciliationCsvRows,
  vatRegisterCsv,
  yearCsvRows,
} from './exportCsv';

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

describe('kpirCsvRows', () => {
  const entry: KpirEntry = {
    lp: 3,
    date: '2026-02-05',
    docNumber: 'FV 2',
    contractorCountry: 'PL',
    contractorTaxId: '1111111111',
    contractorName: 'Firma; "A"',
    description: 'Sprzedaż usług',
    col9: 123_456,
    col10: 100,
    col12: 0,
    col13: 0,
    col14: 0,
    col15: 5,
    origin: 'document',
  };

  it('має стільки комірок, скільки колонок у заголовку, і рахує кол. 11 та 16', () => {
    const [row] = kpirCsvRows([entry]);
    expect(row).toHaveLength(KPIR_CSV_HEADER.length);
    expect(row[KPIR_CSV_HEADER.indexOf('col11')]).toBe('1235.56');
    expect(row[KPIR_CSV_HEADER.indexOf('col16')]).toBe('0.05');
    expect(row[KPIR_CSV_HEADER.indexOf('contractor_tax_id')]).toBe('PL1111111111');
  });

  it('без контрагента й KSeF комірки порожні', () => {
    const [row] = kpirCsvRows([{ ...entry, contractorTaxId: undefined, contractorName: undefined }]);
    expect(row[KPIR_CSV_HEADER.indexOf('contractor_tax_id')]).toBe('');
    expect(row[KPIR_CSV_HEADER.indexOf('contractor_name')]).toBe('');
  });
});

describe('vatRegisterCsv', () => {
  const rows = [
    {
      date: '2026-02-05',
      docNumber: 'FV 2',
      contractor: { name: 'Firma', nip: '1111111111' },
      ksefNumber: '123-KSEF',
      fields: { K_19: 500_000, K_20: 115_000 },
    },
    { date: '2026-02-06', docNumber: 'FV 3', contractor: { name: 'Inna' }, marker: 'BFK', fields: { K_19: 100 } },
  ];

  it('колонки полів, порожні комірки для відсутніх полів і рядок TOTAL', () => {
    const csv = vatRegisterCsv(rows, ['K_19', 'K_20'], { K_19: 500_100, K_20: 115_000 });
    expect(csv.header).toEqual([
      'date',
      'doc_number',
      'contractor_nip',
      'contractor_name',
      'ksef_or_marker',
      'K_19',
      'K_20',
    ]);
    expect(csv.rows[0]).toEqual(['2026-02-05', 'FV 2', '1111111111', 'Firma', '123-KSEF', '5000.00', '1150.00']);
    expect(csv.rows[1]).toEqual(['2026-02-06', 'FV 3', '', 'Inna', 'BFK', '1.00', '']);
    expect(csv.rows[2]).toEqual(['', 'TOTAL', '', '', '', '5001.00', '1150.00']);
  });

  it('порожній реєстр дає лише рядок TOTAL з нулями', () => {
    const csv = vatRegisterCsv([], ['K_42', 'K_43'], {});
    expect(csv.rows).toEqual([['', 'TOTAL', '', '', '', '0.00', '0.00']]);
  });
});

describe('documentsCsvRows', () => {
  const base = { contractor: { name: 'Firma; A', nip: '1111111111', country: 'PL' }, currency: 'PLN' as const };
  const docs: StoredDocument[] = [
    {
      ...base,
      id: 'c1',
      kind: 'cost',
      category: 'carMixed',
      number: 'F 2',
      issueDate: '2026-03-04',
      lines: [
        { net: 10_000, vatRate: '23', vat: 2_300 },
        { net: 5_000, vatRate: '8', vat: 400 },
      ],
      source: 'import',
    },
    {
      ...base,
      id: 'i1',
      kind: 'income',
      number: 'FV 1',
      issueDate: '2026-03-01',
      lines: [{ net: 100_000, vatRate: 'np' }],
      source: 'manual',
    },
    {
      id: 'w1',
      kind: 'internal',
      number: 'WEW 1',
      issueDate: '2026-03-31',
      description: 'Składki',
      column: 15,
      amount: -700,
      source: 'manual',
    },
  ];

  it('рядки за датою документа, суми позицій у злотих', () => {
    const rows = documentsCsvRows(docs);
    expect(rows.map((r) => r[0])).toEqual(['i1', 'c1', 'w1']);
    expect(rows[1]!.slice(10)).toEqual(['150.00', '27.00', 'carMixed', 'import']);
  });

  it('позиції без VAT дають порожнє поле VAT, дохід — порожню категорію', () => {
    expect(documentsCsvRows(docs)[0]!.slice(10)).toEqual(['1000.00', '', '', 'manual']);
  });

  it('внутрішній документ: сума зі знаком у net, без VAT і контрагента', () => {
    const internal = documentsCsvRows(docs)[2]!;
    expect(internal[4]).toBe('2026-03-31');
    expect(internal.slice(6)).toEqual(['Składki', '', '', 'PLN', '-7.00', '', '', 'manual']);
  });

  it('рядок відповідає заголовку за кількістю колонок і екранує крапку з комою', () => {
    const rows = documentsCsvRows(docs);
    expect(rows.every((r) => r.length === DOCUMENTS_CSV_HEADER.length)).toBe(true);
    expect(toCsv(DOCUMENTS_CSV_HEADER, rows)).toContain('"Firma; A"');
  });
});
