import { describe, expect, it } from 'vitest';
import { cost, importEu, income, internal } from './fixtures/builders';
import { kpirBook, kpirContributions, kpirFromDocuments, kpirTotals } from './kpir';
import { TAX_CONFIG, calcYear } from './tax';

const EUR = { '2026-03-09': 4.2512 };

describe('записи KPiR з документів', () => {
  it('дохід іде в кол. 9 з даними контрагента і номером KSeF', () => {
    const [entry] = kpirFromDocuments([{ ...income({ ksefNumber: 'KSEF-1' }), id: 'd1' }], 2026);
    expect(entry).toMatchObject({
      date: '2026-03-31',
      ksefNumber: 'KSEF-1',
      docNumber: 'FV 1/2026',
      contractorCountry: 'PL',
      contractorTaxId: '5250000000',
      contractorName: 'Klient sp. z o.o.',
      description: 'Sprzedaż usług',
      col9: 1_000_000,
      col10: 0,
      col15: 0,
      origin: 'document',
      documentId: 'd1',
    });
  });
  it('усі категорії витрат ідуть у кол. 15, опис — за категорією', () => {
    const docs = [
      cost({ category: 'office' }),
      cost({ category: 'other' }),
      cost({ category: 'carMixed', lines: [{ net: 24_382, vatRate: '23', vat: 5_608 }] }),
      importEu({ fxRatePit: 4.3, fxRateVat: 4.3 }),
    ];
    const entries = kpirFromDocuments(docs, 2026);
    expect(entries.map((e) => e.col15)).toEqual([10_000, 10_000, 20_390, 43_000]);
    expect(entries.map((e) => e.description)).toEqual([
      'Wydatki biurowe',
      'Pozostałe wydatki',
      'Eksploatacja samochodu',
      'Import usług',
    ]);
    expect(entries.every((e) => e.col9 === 0 && e.col12 === 0 && e.col13 === 0 && e.col14 === 0)).toBe(true);
  });
  it('опис із документа має перевагу', () => {
    expect(kpirFromDocuments([cost({ description: 'Paliwo' })], 2026)[0].description).toBe('Paliwo');
  });
  it('внутрішній документ іде у вказану колонку', () => {
    const entries = kpirFromDocuments([internal({ column: 10, amount: 5_000 }), internal({ amount: -2_000 })], 2026);
    expect(entries.map((e) => [e.col10, e.col15])).toEqual([
      [5_000, 0],
      [0, -2_000],
    ]);
  });
  it('запис датується днем події для PIT і потрапляє лише у свій рік', () => {
    const docs = [
      cost({ issueDate: '2025-12-30', receivedDate: '2026-01-05' }),
      cost({ issueDate: '2026-12-31' }),
      income({ saleDate: '2026-12-31', issueDate: '2027-01-04' }),
      income({ issueDate: '2027-01-04' }),
    ];
    expect(kpirFromDocuments(docs, 2026).map((e) => e.date)).toEqual(['2026-12-31', '2026-12-31']);
    expect(kpirFromDocuments(docs, 2025).map((e) => e.date)).toEqual(['2025-12-30']);
  });
  it('валютний документ без курсу пропускається', () => {
    expect(kpirFromDocuments([importEu()], 2026)).toEqual([]);
  });
  it('без документів — порожня книга', () => {
    expect(kpirFromDocuments([], 2026)).toEqual([]);
    expect(kpirBook([])).toEqual([]);
  });
});

describe('курсові різниці в KPiR', () => {
  const claude = importEu({ number: 'INV-7', issueDate: '2026-03-10', paidAt: '2026-03-12' });

  it("від'ємна різниця — окремий запис у кол. 15 у день оплати", () => {
    const entries = kpirFromDocuments([{ ...claude, paidPln: 43_105 }], 2026, { fx: { EUR } });
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({
      date: '2026-03-12',
      docNumber: 'RK INV-7',
      description: 'Różnice kursowe: INV-7',
      col10: 0,
      col15: 593,
      origin: 'fxDifference',
    });
  });
  it('додатна різниця — у кол. 10', () => {
    const entries = kpirFromDocuments([{ ...claude, paidPln: 42_000 }], 2026, { fx: { EUR } });
    expect(entries[1]).toMatchObject({ col10: 512, col15: 0 });
  });
  it('нульова різниця запису не дає', () => {
    expect(kpirFromDocuments([{ ...claude, paidPln: 42_512 }], 2026, { fx: { EUR } })).toHaveLength(1);
  });
  it('вимикається опцією fxDifferences', () => {
    const entries = kpirFromDocuments([{ ...claude, paidPln: 43_105 }], 2026, { fx: { EUR }, fxDifferences: false });
    expect(entries).toHaveLength(1);
  });
  it('оплата в наступному році: різниця належить тому року', () => {
    const doc = { ...claude, issueDate: '2026-12-30', fxRatePit: 4.2512, fxRateVat: 4.2512, paidAt: '2027-01-04' };
    const withPayment = { ...doc, paidPln: 43_105 };
    expect(kpirFromDocuments([withPayment], 2026).map((e) => e.origin)).toEqual(['document']);
    expect(kpirFromDocuments([withPayment], 2027).map((e) => e.origin)).toEqual(['fxDifference']);
  });
});

describe('FP у KPiR', () => {
  const cfg = TAX_CONFIG[2026]!;
  const settings = {
    chorobowe: false,
    prevDecemberIncome: null,
    prevDecemberContributions: { social: 151_898, fp: 12_749, health: 50_000 },
  };

  it('без zdrowotnej в kosztach — лише FP у кол. 15: у січні за грудень попереднього року', () => {
    const results = calcYear({ incomes: [], costs: [], settings: { ...settings, healthAsCost: false } }, cfg);
    const entries = kpirContributions(2026, results);
    expect(entries).toHaveLength(12);
    expect(entries[0]).toMatchObject({
      date: '2026-01-20',
      docNumber: 'ZUS DRA 12/2025',
      description: 'Składka na Fundusz Pracy za 12/2025',
      col15: 12_749,
      origin: 'contribution',
    });
    expect(entries[1]).toMatchObject({ date: '2026-02-20', docNumber: 'ZUS DRA 01/2026', col15: 13_847 });
    expect(entries[11]).toMatchObject({ date: '2026-12-20', docNumber: 'ZUS DRA 11/2026' });
  });
  it('типово zdrowotna в kosztach: один запис FP + zdrowotna за попередній місяць', () => {
    const results = calcYear({ incomes: [], costs: [], settings }, cfg);
    const entries = kpirContributions(2026, results);
    expect(entries[1]).toMatchObject({
      date: '2026-02-20',
      docNumber: 'ZUS DRA 01/2026',
      description: 'Składki ZUS (FP i zdrowotna) za 01/2026',
      col15: 13_847 + 31_496,
    });
  });
  it('без składek за грудень у січні запису немає', () => {
    const results = calcYear(
      { incomes: [], costs: [], settings: { ...settings, prevDecemberContributions: null } },
      cfg,
    );
    const entries = kpirContributions(2026, results);
    expect(entries).toHaveLength(11);
    expect(entries[0].date).toBe('2026-02-20');
  });
});

describe('книга й підсумки', () => {
  const drafts = kpirFromDocuments(
    [
      income({ number: 'FV 2/2026', issueDate: '2026-03-31' }),
      cost({ number: 'B', issueDate: '2026-03-10' }),
      cost({ number: 'A', issueDate: '2026-03-10', lines: [{ net: 5_000, vatRate: '23' }] }),
      income({ number: 'FV 1/2026', issueDate: '2026-02-28', lines: [{ net: 300_000, vatRate: '23' }] }),
      internal({ column: 10, amount: 700, issueDate: '2026-03-15' }),
    ],
    2026,
  );

  it('записи за датою, потім за номером, з наскрізним Lp.', () => {
    const book = kpirBook(drafts);
    expect(book.map((e) => [e.lp, e.date, e.docNumber])).toEqual([
      [1, '2026-02-28', 'FV 1/2026'],
      [2, '2026-03-10', 'A'],
      [3, '2026-03-10', 'B'],
      [4, '2026-03-15', 'DW 1/2026'],
      [5, '2026-03-31', 'FV 2/2026'],
    ]);
  });
  it('підсумок місяця: кол. 11 = 9 + 10, кол. 16 = 14 + 15', () => {
    expect(kpirTotals(drafts, 3)).toEqual({
      col9: 1_000_000,
      col10: 700,
      col11: 1_000_700,
      col12: 0,
      col13: 0,
      col14: 0,
      col15: 15_000,
      col16: 15_000,
    });
  });
  it('підсумок за рік і за місяць без записів', () => {
    expect(kpirTotals(drafts).col11).toBe(1_300_700);
    expect(kpirTotals(drafts, 7)).toEqual({
      col9: 0,
      col10: 0,
      col11: 0,
      col12: 0,
      col13: 0,
      col14: 0,
      col15: 0,
      col16: 0,
    });
  });
});
