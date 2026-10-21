import { calcYearFromDocuments, TAX_CONFIG, type KpirEntry, type LedgerDocument, type YearSettings } from '@jdg/core';
import { describe, expect, it } from 'vitest';
import { kpirContractor, monthBooks, PURCHASE_FIELD_ORDER, SALES_FIELD_ORDER, usedFields } from './booksView';

const cfg = TAX_CONFIG[2026]!;
const settings: YearSettings = {
  chorobowe: false,
  prevDecemberIncome: null,
  prevDecemberContributions: null,
  contributionHolidayMonth: 2,
};
const pl = { name: 'Firma', nip: '1111111111', country: 'PL' };

type Doc = LedgerDocument & { id: string };
const income = (id: string, number: string, issueDate: string, net: number): Doc => ({
  id,
  kind: 'income',
  number,
  issueDate,
  contractor: pl,
  currency: 'PLN',
  lines: [{ net, vatRate: '23', vat: Math.round(net * 0.23) }],
  source: 'import',
});
const cost = (id: string, number: string, issueDate: string, category: 'office' | 'carMixed', net: number): Doc => ({
  id,
  kind: 'cost',
  category,
  number,
  issueDate,
  contractor: pl,
  currency: 'PLN',
  lines: [{ net, vatRate: '23', vat: Math.round(net * 0.23) }],
  source: 'import',
});

const docs: Doc[] = [
  income('s1', 'FV 1', '2026-01-10', 1_000_000),
  cost('c1', 'F 1', '2026-01-15', 'office', 10_000),
  cost('c2', 'F 2', '2026-02-03', 'carMixed', 20_000),
  income('s2', 'FV 2', '2026-02-05', 500_000),
];
const results = calcYearFromDocuments(docs, settings, cfg);

describe('monthBooks: KPiR', () => {
  it('нумерує Lp. наскрізно за рік, а не з 1 у кожному місяці', () => {
    const jan = monthBooks(docs, results, 2026, 1);
    const feb = monthBooks(docs, results, 2026, 2);
    const janLast = Math.max(...jan.kpir.map((e) => e.lp));
    expect(jan.kpir[0].lp).toBe(1);
    expect(Math.min(...feb.kpir.map((e) => e.lp))).toBe(janLast + 1);
  });

  it('бере в місяць лише записи з його датою події', () => {
    const feb = monthBooks(docs, results, 2026, 2);
    expect(feb.kpir.every((e) => e.date.startsWith('2026-02-'))).toBe(true);
    expect(feb.kpir.filter((e) => e.origin === 'document').map((e) => e.docNumber)).toEqual(['F 2', 'FV 2']);
  });

  it('підсумок місяця й наростаючий підсумок з початку року', () => {
    const jan = monthBooks(docs, results, 2026, 1);
    const feb = monthBooks(docs, results, 2026, 2);
    expect(jan.kpirTotals.col9).toBe(1_000_000);
    expect(feb.kpirTotals.col9).toBe(500_000);
    expect(feb.kpirYearToDate.col9).toBe(1_500_000);
    expect(feb.kpirYearToDate.col15).toBe(jan.kpirTotals.col15 + feb.kpirTotals.col15);
    expect(feb.kpirTotals.col11).toBe(feb.kpirTotals.col9 + feb.kpirTotals.col10);
    expect(feb.kpirTotals.col16).toBe(feb.kpirTotals.col14 + feb.kpirTotals.col15);
  });

  it('додає składki з розрахунку року в кол. 15 і збігається з koszty розрахунку', () => {
    for (const month of [1, 2, 3]) {
      const r = results[month - 1];
      const books = monthBooks(docs, results, 2026, month);
      expect(books.kpirTotals.col15).toBe(r.pitCosts + r.fpPaid + r.healthInCosts);
    }
    const march = monthBooks(docs, results, 2026, 3);
    expect(march.kpir.some((e) => e.origin === 'contribution')).toBe(true);
  });

  it('без розрахунку року книга лише з документів', () => {
    const books = monthBooks(docs, null, 2026, 3);
    expect(books.kpir).toEqual([]);
    expect(monthBooks(docs, null, 2026, 2).kpir.every((e) => e.origin !== 'contribution')).toBe(true);
  });

  it('порожній місяць дає нульові підсумки', () => {
    const books = monthBooks([], null, 2026, 6);
    expect(books.kpirTotals).toEqual({
      col9: 0,
      col10: 0,
      col11: 0,
      col12: 0,
      col13: 0,
      col14: 0,
      col15: 0,
      col16: 0,
    });
    expect(books.sales).toEqual([]);
    expect(books.purchases).toEqual([]);
  });
});

describe('monthBooks: реєстри VAT', () => {
  it('продаж у K_19/K_20, закупівля в K_42/K_43, з підсумками й сумами декларації', () => {
    const jan = monthBooks(docs, results, 2026, 1);
    expect(jan.sales).toHaveLength(1);
    expect(jan.salesTotals).toEqual({ K_19: 1_000_000, K_20: 230_000 });
    expect(jan.purchases).toHaveLength(1);
    expect(jan.purchaseTotals).toEqual({ K_42: 10_000, K_43: 2_300 });
    expect(jan.declaration).toEqual({ output: 230_000, input: 2_300, reverseCharge: 0 });
  });

  it('авто мішане: половина netto й VAT у реєстрі закупівлі', () => {
    const feb = monthBooks(docs, results, 2026, 2);
    expect(feb.purchaseTotals).toEqual({ K_42: 10_000, K_43: 2_300 });
  });

  it('usedFields лишає тільки заповнені поля в порядку ewidencji', () => {
    const jan = monthBooks(docs, results, 2026, 1);
    expect(usedFields(SALES_FIELD_ORDER, jan.salesTotals)).toEqual(['K_19', 'K_20']);
    expect(usedFields(PURCHASE_FIELD_ORDER, jan.purchaseTotals)).toEqual(['K_42', 'K_43']);
    expect(usedFields(SALES_FIELD_ORDER, {})).toEqual([]);
  });
});

describe('kpirContractor', () => {
  const base = { lp: 1, date: '2026-01-01', docNumber: 'X' } as KpirEntry;
  it('ідентифікатор з кодом країни й назва', () => {
    expect(kpirContractor({ ...base, contractorCountry: 'PL', contractorTaxId: '123', contractorName: 'Firma' })).toBe(
      'PL123 · Firma',
    );
  });
  it('без NIP — лише назва; запис без контрагента — порожньо', () => {
    expect(kpirContractor({ ...base, contractorName: 'Firma' })).toBe('Firma');
    expect(kpirContractor(base)).toBe('');
  });
});
