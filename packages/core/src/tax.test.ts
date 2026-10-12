import { describe, expect, it } from 'vitest';
import { TAX_CONFIG, calcYear, costNetPln, dueDates, nbpRateFor, zusForMonth, type Cost, type YearInput } from './tax';

const cfg = TAX_CONFIG[2026]!;
const empty = (over: Partial<YearInput> = {}): YearInput => ({
  incomes: [],
  costs: [],
  settings: { chorobowe: false, prevDecemberIncome: null, prevDecemberContributions: null },
  ...over,
});
// Składki за грудень 2025, сплачені в січні 2026
const prevDecemberContributions = { social: 151_898, fp: 12_749, health: 50_000 };
const withPrevDecember = { chorobowe: false, prevDecemberIncome: null, prevDecemberContributions };

describe('ZUS', () => {
  it('duży ZUS без chorobowego = 1 788,29 zł', () => {
    expect(zusForMonth(cfg, false).total).toBe(178_829);
  });
  it('duży ZUS з chorobowym = 1 926,76 zł', () => {
    expect(zusForMonth(cfg, true).total).toBe(192_676);
  });
});

describe('zdrowotna', () => {
  it('мінімум у січні та лютому без доходу', () => {
    const r = calcYear(empty(), cfg);
    expect(r[0].health).toBe(31_496);
    expect(r[1].health).toBe(43_254);
  });
  it('рахується від доходу попереднього місяця', () => {
    const incomes = [1, 2, 3].map((month) => ({ month, net: 2_000_000 }));
    const r = calcYear(empty({ incomes }), cfg);
    const februaryIncome = 2_000_000 - 178_829; // przychód − FP − społeczne, сплачені в лютому
    expect(r[1].health).toBe(98_000); // 4,9% від доходу січня 20 000 zł
    expect(r[1].healthIncome).toBe(februaryIncome);
    expect(r[2].health).toBe(Math.round(februaryIncome * 0.049));
  });
  it('збиток попередніх місяців зменшує базу наступного', () => {
    const r = calcYear(empty({ incomes: [{ month: 3, net: 2_000_000 }] }), cfg);
    // лютий: доходу немає, сплачено składki за січень → збиток 1 788,29 zł
    expect(r[1].monthlyIncomeAfterZus).toBe(-178_829);
    expect(r[1].healthIncome).toBe(0);
    expect(r[2].health).toBe(43_254); // за збитковий лютий — мінімум
    const marchHealthIncome = 2_000_000 - 2 * 178_829; // дохід березня мінус збиток лютого
    expect(r[2].healthIncome).toBe(marchHealthIncome);
    expect(r[3].health).toBe(Math.round(marchHealthIncome * 0.049));
  });
  it('приклад ZUS: збитки −10 000, −5 000, 0, далі дохід 20 000 і 30 000', () => {
    // Суми підібрані так, щоб разом зі składkami, сплаченими з лютого, вийшов дохід з прикладу
    const zus = 178_829;
    const costs: Cost[] = [
      { month: 1, currency: 'PLN', amount: 1_000_000, vatRate: 0, category: 'other' },
      { month: 2, currency: 'PLN', amount: 500_000 - zus, vatRate: 0, category: 'other' },
    ];
    const incomes = [
      { month: 3, net: zus },
      { month: 4, net: 2_000_000 + zus },
      { month: 5, net: 3_000_000 + zus },
    ];
    const r = calcYear(empty({ incomes, costs }), cfg);
    expect(r.slice(0, 5).map((x) => x.cumulativeIncome)).toEqual([
      -1_000_000, -1_500_000, -1_500_000, 500_000, 3_500_000,
    ]);
    expect(r.slice(0, 5).map((x) => x.healthIncome)).toEqual([0, 0, 0, 500_000, 3_000_000]);
  });
  it('відлік обмежений 14 100 zł за рік', () => {
    const incomes = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, net: 6_000_000 }));
    const r = calcYear(empty({ incomes }), cfg);
    expect(r[11].cumulativeHealthDeducted).toBe(1_410_000);
  });
});

describe('składki відлічуються в місяці сплати', () => {
  it('січень відлічує składki за грудень попереднього року з налаштувань', () => {
    const r = calcYear(empty({ incomes: [{ month: 1, net: 2_000_000 }], settings: withPrevDecember }), cfg);
    expect(r[0].monthlyIncomeAfterZus).toBe(2_000_000 - 151_898 - 12_749);
    expect(r[0].healthDeducted).toBe(50_000);
    // podstawa 17 853,53 → 17 854 zł; 19% = 3 392,26 → 3 392 zł
    expect(r[0].pitAdvance).toBe(339_200);
  });
  it('без składek за грудень у січні нічого не відлічується', () => {
    const r = calcYear(empty({ incomes: [{ month: 1, net: 2_000_000 }] }), cfg);
    expect(r[0].monthlyIncomeAfterZus).toBe(2_000_000);
    expect(r[0].healthDeducted).toBe(0);
    expect(r[0].pitAdvance).toBe(380_000);
  });
  it('składki за місяць M зменшують дохід і податок місяця M+1', () => {
    const r = calcYear(empty({ incomes: [{ month: 2, net: 2_000_000 }] }), cfg);
    expect(r[1].zusSocialPaid).toBe(r[0].zusSocial);
    expect(r[1].fpPaid).toBe(r[0].fp);
    expect(r[1].healthPaid).toBe(r[0].health);
    expect(r[1].monthlyIncomeAfterZus).toBe(2_000_000 - 178_829);
    expect(r[1].healthDeducted).toBe(31_496); // zdrowotna за січень, сплачена в лютому
  });
  it('składki за грудень поточного року в цьому році не відлічуються', () => {
    const r = calcYear(empty({ settings: withPrevDecember }), cfg);
    const socialPaid = r.reduce((a, x) => a + x.zusSocialPaid, 0);
    expect(socialPaid).toBe(151_898 + 11 * zusForMonth(cfg, false).social);
    expect(r[11].cumulativeIncome).toBe(-(151_898 + 12_749) - 11 * 178_829);
  });
});

describe('VAT', () => {
  it('23% від продажу, округлення до злотих', () => {
    const r = calcYear(empty({ incomes: [{ month: 1, net: 1_000_050 }] }), cfg);
    expect(r[0].vatDue).toBe(230_000); // 2 300,01 → 2 300
  });
  it('надвишка naliczonego переноситься на наступний місяць', () => {
    const r = calcYear(
      empty({
        incomes: [{ month: 2, net: 1_000_000 }],
        costs: [{ month: 1, currency: 'PLN', amount: 500_000, vatRate: 0.23, category: 'office' }],
      }),
      cfg,
    );
    expect(r[0].vatDue).toBe(0);
    expect(r[0].vatCarryOut).toBe(115_000);
    expect(r[1].vatDue).toBe(230_000 - 115_000);
  });
  it('import usług дає нульове сальдо VAT', () => {
    const r = calcYear(
      empty({
        costs: [{ month: 5, currency: 'EUR', amount: 10_000, vatRate: 0.23, category: 'importServices', fxRate: 4.25 }],
      }),
      cfg,
    );
    expect(r[4].vatOutput).toBe(r[4].vatInput);
    expect(r[4].vatDue).toBe(0);
    expect(r[4].pitCosts).toBe(42_500);
  });
});

describe('авто мішане', () => {
  it('50% VAT до відліку, 75% у koszty разом з невідліченим VAT', () => {
    const r = calcYear(
      empty({ costs: [{ month: 1, currency: 'PLN', amount: 100_000, vatRate: 0.23, category: 'carMixed' }] }),
      cfg,
    );
    // VAT 230 zł: 115 до відліку, 115 у koszty; koszty = 0.75 × (1000 + 115) = 836,25
    expect(r[0].vatInput).toBe(11_500);
    expect(r[0].pitCosts).toBe(83_625);
    expect(r[0].cashCosts).toBe(111_500);
  });
});

describe('PIT наростаючим підсумком', () => {
  it('сума zaliczek дорівнює податку від річної podstawy', () => {
    const incomes = [1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12].map((month) => ({ month, net: 1_800_000 })); // квітень без доходу
    const r = calcYear(empty({ incomes }), cfg);
    const sum = r.reduce((a, x) => a + x.pitAdvance, 0);
    expect(sum).toBe(r[11].pitTaxCumulative);
    expect(r.every((x) => x.pitAdvance >= 0)).toBe(true);
  });
  it('EUR-витрата без курсу не враховується і позначається', () => {
    const r = calcYear(
      empty({ costs: [{ month: 1, currency: 'EUR', amount: 10_000, vatRate: 0.23, category: 'importServices' }] }),
      cfg,
    );
    expect(r[0].missingFxRates).toBe(1);
    expect(r[0].pitCosts).toBe(0);
  });
});

describe('helpers', () => {
  it('nbpRateFor бере останній робочий день перед датою', () => {
    const table = { '2026-10-08': 4.3789, '2026-10-09': 4.3775 };
    expect(nbpRateFor('2026-10-12', table)).toEqual({ rate: 4.3775, date: '2026-10-09' }); // понеділок → п'ятниця
    expect(nbpRateFor('2026-10-09', table)).toEqual({ rate: 4.3789, date: '2026-10-08' });
  });
  it('nbpRateFor повертає null для некоректної дати', () => {
    expect(nbpRateFor('', { '2026-10-09': 4.3775 })).toBeNull();
    expect(nbpRateFor('2026-13-40', { '2026-10-09': 4.3775 })).toBeNull();
  });
  it('costNetPln конвертує EUR', () => {
    expect(
      costNetPln({ month: 1, currency: 'EUR', amount: 2_000, vatRate: 0.23, category: 'importServices', fxRate: 4.3 }),
    ).toBe(8_600);
  });
  it('dueDates для грудня переходить на наступний рік', () => {
    expect(dueDates(2026, 12)).toEqual({
      zus: '2027-01-20',
      health: '2027-01-20',
      pit: '2027-01-20',
      vat: '2027-01-25',
    });
  });
});
