import { describe, expect, it } from 'vitest';
import { cost, income } from './fixtures/builders';
import { january2026Jpk, jpkXml } from './fixtures/jpk';
import { january2026 } from './fixtures/month-2026-01';
import { parseJpkV7M } from './jpk';
import { documentsFromJpk, jpkDocumentId } from './jpkImport';
import {
  compareMonth,
  referenceFromJpk,
  unexplainedDiffs,
  yearFigures,
  yearReport,
  type MonthFigures,
  type MonthReference,
} from './reference';
import { TAX_CONFIG } from './tax';

const cfg = TAX_CONFIG[2026]!;

describe('еталон з JPK', () => {
  it('декларація й підсумки ewidencji січня', () => {
    expect(referenceFromJpk(parseJpkV7M(january2026Jpk))).toEqual({
      vat: { output: 426_900, input: 48_300, carryIn: 0, due: 378_600, carryOut: 0 },
      sales: { K_19: 1_856_000, K_20: 426_880 },
      purchases: { K_42: 210_107, K_43: 48_325 },
    });
  });
  it('надвишка з попереднього місяця не входить у VAT naliczony місяця', () => {
    const jpk = parseJpkV7M(
      jpkXml({ declaration: { P_38: '100', P_39: '300', P_48: '350', P_53: '250', P_62: '250' } }),
    );
    expect(referenceFromJpk(jpk).vat).toEqual({
      output: 10_000,
      input: 5_000,
      carryIn: 30_000,
      due: 0,
      carryOut: 25_000,
    });
  });
});

describe('звіт різниць', () => {
  const figures: MonthFigures = {
    month: 1,
    vat: { output: 1_000, input: 500, carryIn: 0, due: 500, carryOut: 0 },
    sales: { K_19: 4_000, K_20: 920 },
    purchases: { K_42: 2_000, K_43: 460 },
    kpir: { col9: 4_000, col10: 0, col11: 4_000, col12: 0, col13: 0, col14: 0, col15: 2_000, col16: 2_000 },
    zus: { social: 164_982, fp: 13_847, health: 79_010 },
    pitAdvance: 300,
  };

  it('порожній еталон — порожній звіт', () => {
    expect(compareMonth(figures, {})).toEqual([]);
  });
  it('порівнюються лише показники з еталона; різниця = облік − еталон', () => {
    const rows = compareMonth(figures, { kpir: { col15: 1_900 }, zus: { health: 79_010 } });
    expect(rows).toEqual([
      { metric: 'kpir.col15', app: 2_000, reference: 1_900, diff: 100 },
      { metric: 'zus.health', app: 79_010, reference: 79_010, diff: 0 },
    ]);
  });
  it('поля реєстру, яких немає з одного боку, дорівнюють нулю', () => {
    const rows = compareMonth(figures, { sales: { K_19: 4_000, K_20: 920, K_13: 100 } });
    expect(rows.map((r) => [r.metric, r.app, r.reference])).toEqual([
      ['sales.K_13', 0, 100],
      ['sales.K_19', 4_000, 4_000],
      ['sales.K_20', 920, 920],
    ]);
  });
  it('пояснена різниця не рахується непоясненою', () => {
    const ref: MonthReference = {
      kpir: { col9: 4_000, col15: 1_900 },
      pitAdvance: 0,
      notes: { 'kpir.col15': 'Anthropic: немає в JPK' },
    };
    const rows = compareMonth(figures, ref);
    expect(rows.find((r) => r.metric === 'kpir.col15')?.note).toBe('Anthropic: немає в JPK');
    expect(unexplainedDiffs(rows).map((r) => r.metric)).toEqual(['pitAdvance']);
  });
});

describe('звіт року з документів і еталона', () => {
  it('січень 2026, імпортований з JPK бухгалтера, збігається з еталоном до гроша', () => {
    const jpk = parseJpkV7M(january2026Jpk);
    const { documents } = documentsFromJpk(
      jpk,
      {
        '1111111111': { periodicSettlement: true },
        '2222222222': { category: 'carMixed' },
        '3333333333': { category: 'carMixed' },
        '4444444444': { category: 'other' },
        '5555555555': { category: 'other' },
      },
      { kpirAmounts: { [jpkDocumentId('cost', '2222222222', 'F 102/01/26')]: 22_391 } },
    );
    const { kpir } = january2026.expected;
    const references: Record<string, MonthReference> = {
      '2026-01': {
        ...referenceFromJpk(jpk),
        kpir: { col9: kpir.col9, col10: kpir.col10, col15: kpir.col15 },
        // DRA бухгалтера за січень 2026
        zus: { social: 164_982, fp: 13_847, health: 79_010 },
      },
    };
    const report = yearReport(documents, { ...january2026.settings, prevDecemberIncome: 1_612_451 }, cfg, references);

    expect(report).toHaveLength(12);
    expect(report[0]).toMatchObject({ period: '2026-01', hasReference: true, unexplained: 0 });
    expect(report[0].rows.filter((r) => r.diff !== 0)).toEqual([]);
    expect(report[0].rows).toHaveLength(5 + 4 + 3 + 3);
    expect(report.slice(1).every((m) => !m.hasReference && m.rows.length === 0)).toBe(true);
  });

  it('показники місяця: перенесення VAT і складки з розрахунку року', () => {
    const docs = [
      income({ issueDate: '2026-01-31', lines: [{ net: 100_000, vatRate: '23', vat: 23_000 }] }),
      cost({ issueDate: '2026-02-10', lines: [{ net: 400_000, vatRate: '23', vat: 92_000 }] }),
    ];
    const figures = yearFigures(
      docs,
      { chorobowe: false, prevDecemberIncome: null, prevDecemberContributions: null },
      cfg,
    );
    expect(figures[0].vat).toEqual({ output: 23_000, input: 0, carryIn: 0, due: 23_000, carryOut: 0 });
    expect(figures[1].vat).toEqual({ output: 0, input: 92_000, carryIn: 0, due: 0, carryOut: 92_000 });
    expect(figures[2].vat.carryIn).toBe(92_000);
    expect(figures[0].zus).toEqual({ social: 164_982, fp: 13_847, health: 31_496 });
    // FP і zdrowotna за січень сплачені в лютому: кол. 15 лютого
    expect(figures[1].kpir.col15).toBe(400_000 + 13_847 + 31_496);
  });
});
