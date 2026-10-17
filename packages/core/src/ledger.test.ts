import { describe, expect, it } from 'vitest';
import { cost, importEu, income, internal } from './fixtures/builders';
import { calcYearFromDocuments, documentMonthSums } from './ledger';
import { TAX_CONFIG, calcYear, categoryMonthSums, type YearSettings } from './tax';

const cfg = TAX_CONFIG[2026]!;
const settings: YearSettings = {
  chorobowe: false,
  prevDecemberIncome: 1_500_000,
  prevDecemberContributions: { social: 151_898, fp: 12_749, health: 50_000 },
};
const car = (net: number, vat: number, issueDate: string) =>
  cost({ category: 'carMixed', issueDate, lines: [{ net, vatRate: '23', vat }] });

describe('розрахунок року з документів', () => {
  it('дає той самий результат, що й суми за категоріями', () => {
    const fromCategories = calcYear(
      {
        incomes: [
          { month: 1, net: 2_000_000 },
          { month: 2, net: 1_800_000 },
        ],
        costs: [
          { month: 1, currency: 'PLN', amount: 500_000, vatRate: 0.23, category: 'office' },
          { month: 2, currency: 'PLN', amount: 100_000, vatRate: 0.23, category: 'carMixed' },
          { month: 5, currency: 'EUR', amount: 10_000, vatRate: 0.23, category: 'importServices', fxRate: 4.25 },
        ],
        settings,
      },
      cfg,
    );
    const fromDocuments = calcYearFromDocuments(
      [
        income({ issueDate: '2026-01-31', lines: [{ net: 2_000_000, vatRate: '23' }] }),
        income({ issueDate: '2026-02-27', lines: [{ net: 1_800_000, vatRate: '23' }] }),
        cost({ issueDate: '2026-01-14', lines: [{ net: 500_000, vatRate: '23' }] }),
        car(100_000, 23_000, '2026-02-03'),
        importEu({ issueDate: '2026-05-10', fxRatePit: 4.25, fxRateVat: 4.25 }),
      ],
      settings,
      cfg,
    );
    expect(fromDocuments).toEqual(fromCategories);
  });
  it('рік без документів дорівнює порожньому року', () => {
    expect(calcYearFromDocuments([], settings, cfg)).toEqual(calcYear({ incomes: [], costs: [], settings }, cfg));
  });
});

describe('місячні суми з документів', () => {
  it('koszty округлюються по документу, а не по місяцю', () => {
    // по документах: 156,38 + 203,93; по місяцю було б 360,3225 → 360,32
    const sums = documentMonthSums([car(18_701, 4_301, '2026-03-05'), car(24_387, 5_609, '2026-03-19')], 2026);
    expect(sums[2].pitCosts).toBe(15_638 + 20_393);
    const byMonth = categoryMonthSums(
      {
        incomes: [],
        costs: [18_701, 24_387].map((amount) => ({
          month: 3,
          currency: 'PLN' as const,
          amount,
          vatRate: 0.23,
          category: 'carMixed' as const,
        })),
      },
      cfg,
    );
    expect(byMonth[2].pitCosts).toBe(36_032);
  });
  it('PIT і VAT одного документа можуть потрапити в різні місяці', () => {
    const sums = documentMonthSums([cost({ issueDate: '2026-01-30', receivedDate: '2026-02-02' })], 2026);
    expect([sums[0].pitCosts, sums[0].vatInput]).toEqual([10_000, 0]);
    expect([sums[1].pitCosts, sums[1].vatInput]).toEqual([0, 2_300]);
  });
  it('на межі року кожен податок бере лише свою частину', () => {
    const doc = cost({ issueDate: '2025-12-30', receivedDate: '2026-01-05' });
    expect(documentMonthSums([doc], 2026)[0]).toMatchObject({ pitCosts: 0, cashCosts: 0, vatInput: 2_300 });
    expect(documentMonthSums([doc], 2025)[11]).toMatchObject({ pitCosts: 10_000, cashCosts: 10_000, vatInput: 0 });
  });
  it('VAT у сумах уже округлений до злотих; import usług — і należny, і naliczony', () => {
    const sums = documentMonthSums([importEu({ fxRatePit: 4.2512, fxRateVat: 4.2512 })], 2026);
    expect(sums[2]).toMatchObject({ vatOutput: 9_800, vatInput: 9_800, reverseChargeVat: 9_778, pitCosts: 42_512 });
  });
  it('грошові витрати: netto з невідліченим VAT, без частки 75%', () => {
    const sums = documentMonthSums([car(24_382, 5_608, '2026-03-05')], 2026);
    expect(sums[2]).toMatchObject({ pitCosts: 20_390, cashCosts: 27_186 });
  });
  it('валютний документ без курсу не враховано і пораховано', () => {
    const sums = documentMonthSums([importEu({ issueDate: '2026-04-10' }), cost({ issueDate: '2026-04-11' })], 2026);
    expect(sums[3]).toMatchObject({ missingFxRates: 1, pitCosts: 10_000, vatInput: 2_300, vatOutput: 0 });
  });
  it("курсові різниці: від'ємна — у koszty й грошові витрати, додатна — у дохід", () => {
    const claude = importEu({ issueDate: '2026-03-10', fxRatePit: 4.2512, fxRateVat: 4.2512, paidAt: '2026-04-02' });
    const negative = documentMonthSums([{ ...claude, paidPln: 43_105 }], 2026);
    expect(negative[2]).toMatchObject({ pitCosts: 42_512, cashCosts: 42_512, income: 0 });
    expect(negative[3]).toMatchObject({ pitCosts: 593, cashCosts: 593, income: 0 });
    const positive = documentMonthSums([{ ...claude, paidPln: 42_000 }], 2026);
    expect(positive[3]).toMatchObject({ pitCosts: 0, cashCosts: 0, income: 512 });
    const off = documentMonthSums([{ ...claude, paidPln: 43_105 }], 2026, { fxDifferences: false });
    expect(off[3]).toMatchObject({ pitCosts: 0, cashCosts: 0 });
  });
  it('внутрішній документ: кол. 10 — дохід, кол. 15 — koszty без грошових витрат', () => {
    const sums = documentMonthSums(
      [internal({ column: 10, amount: 5_000 }), internal({ column: 15, amount: 150_000 })],
      2026,
    );
    expect(sums[2]).toMatchObject({ income: 5_000, pitCosts: 150_000, cashCosts: 0, vatOutput: 0, vatInput: 0 });
  });
  it('завжди 12 місяців, порожні — з нулями', () => {
    const sums = documentMonthSums([], 2026);
    expect(sums.map((s) => s.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(sums[6]).toEqual({
      month: 7,
      income: 0,
      vatOutput: 0,
      vatInput: 0,
      reverseChargeVat: 0,
      pitCosts: 0,
      cashCosts: 0,
      missingFxRates: 0,
    });
  });
});
