import { describe, expect, it } from 'vitest';
import { cost, income } from './fixtures/builders';
import { january2026Jpk, jpkXml } from './fixtures/jpk';
import { january2026 } from './fixtures/month-2026-01';
import { parseJpkV7M } from './jpk';
import { documentsFromJpk, jpkDocumentId } from './jpkImport';
import type { LedgerDocument } from './document';
import { calcYearFromDocuments } from './ledger';
import {
  compareMonth,
  isReconciled,
  missingReferenceParts,
  referenceFromJpk,
  unexplainedDiffs,
  yearFigures,
  yearReport,
  type ExpectedFigures,
  type MonthFigures,
  type MonthReference,
  type MonthReport,
  type ReferenceMetric,
} from './reference';
import { TAX_CONFIG, type YearSettings } from './tax';

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
      { metric: 'kpir.col15', app: 2_000, reference: 1_900, diff: 100, derived: 0, root: 100 },
      { metric: 'zus.health', app: 79_010, reference: 79_010, diff: 0, derived: 0, root: 0 },
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
    // Розрахунку zaliczki бухгалтера в еталоні немає: місяць збігається, але не звірений
    expect(report[0].missing).toEqual(['pitAdvance']);
    expect(isReconciled(report[0])).toBe(false);
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

describe('повнота еталона', () => {
  const full: MonthReference = {
    vat: { output: 0, input: 0, carryIn: 0, due: 0, carryOut: 0 },
    kpir: { col9: 0, col15: 0 },
    zus: { social: 0, fp: 0, health: 0 },
    pitAdvance: 0,
  };
  it('повний еталон: нічого не бракує (кол. 10 необов’язкова, нулі — теж значення)', () => {
    expect(missingReferenceParts(full)).toEqual([]);
  });
  it('немає еталона — бракує всього', () => {
    expect(missingReferenceParts(undefined)).toEqual(['jpk', 'kpir', 'zus', 'pitAdvance']);
  });
  it('неповні KPiR і DRA теж неповні', () => {
    expect(missingReferenceParts({ ...full, kpir: { col9: 0 }, zus: { social: 0, fp: 0 } })).toEqual(['kpir', 'zus']);
  });
  it('звірено лише з повним еталоном і без непояснених різниць', () => {
    const report: MonthReport = {
      month: 1,
      period: '2026-01',
      hasReference: true,
      missing: [],
      rows: [],
      unexplained: 0,
    };
    expect(isReconciled(report)).toBe(true);
    expect(isReconciled({ ...report, missing: ['pitAdvance'] })).toBe(false);
    expect(isReconciled({ ...report, unexplained: 1 })).toBe(false);
    expect(isReconciled({ ...report, hasReference: false })).toBe(false);
    expect(isReconciled(undefined)).toBe(false);
  });
});

describe('розклад різниці: compareMonth', () => {
  const figures: MonthFigures = {
    month: 6,
    vat: { output: 0, input: 0, carryIn: 0, due: 0, carryOut: 0 },
    sales: {},
    purchases: {},
    kpir: { col9: 0, col10: 0, col11: 0, col12: 0, col13: 0, col14: 0, col15: 100_000, col16: 100_000 },
    zus: { social: 164_982, fp: 13_847, health: 80_000 },
    pitAdvance: 300_000,
  };
  const expected: ExpectedFigures = {
    col15: 100_050,
    health: 80_000,
    pitAdvance: 300_300,
    sourcesBefore: [4],
    sourcesThrough: [4, 6],
  };

  it('похідна частина — облік мінус очікуване; решта — першопричина', () => {
    const rows = compareMonth(
      figures,
      { kpir: { col15: 98_000 }, zus: { health: 80_000 }, pitAdvance: 300_300 },
      expected,
    );
    expect(rows).toEqual([
      {
        metric: 'kpir.col15',
        app: 100_000,
        reference: 98_000,
        diff: 2_000,
        derived: -50,
        root: 2_050,
        derivedFrom: [4],
      },
      { metric: 'zus.health', app: 80_000, reference: 80_000, diff: 0, derived: 0, root: 0 },
      {
        metric: 'pitAdvance',
        app: 300_000,
        reference: 300_300,
        diff: -300,
        derived: -300,
        root: 0,
        derivedFrom: [4, 6],
      },
    ]);
    expect(unexplainedDiffs(rows).map((r) => r.metric)).toEqual(['kpir.col15']);
  });

  it('społeczne і FP похідної частини не мають', () => {
    const rows = compareMonth(figures, { zus: { social: 0, fp: 0 } }, expected);
    expect(rows.map((r) => [r.metric, r.derived, r.root])).toEqual([
      ['zus.social', 0, 164_982],
      ['zus.fp', 0, 13_847],
    ]);
  });

  it('нульова різниця не потребує пояснення, навіть якщо першопричина й наслідок компенсуються', () => {
    const rows = compareMonth(figures, { kpir: { col15: 100_000 } }, expected);
    expect(rows[0]).toMatchObject({ diff: 0, derived: -50, root: 50 });
    expect(unexplainedDiffs(rows)).toEqual([]);
  });
});

// ---------------------------------------------------------------- розклад на рік

const cfg2026 = TAX_CONFIG[2026]!;
const pad = (m: number | string) => String(m).padStart(2, '0');
const BASE: YearSettings = {
  chorobowe: false,
  prevDecemberIncome: 1_500_000,
  prevDecemberContributions: null,
  contributionHolidayMonth: 2,
  healthAsCost: true,
};

/**
 * Рік вигаданих документів: щомісяця продаж `monthlyNet` і витрата 500 zł, плюс додаткові витрати
 * (місяць → netto). Витрати звільнені від VAT (zw), щоб реєстри VAT від них не залежали.
 */
function yearDocs(monthlyNet: number, extra: Record<number, number> = {}): LedgerDocument[] {
  const docs: LedgerDocument[] = [];
  for (let m = 1; m <= 12; m++) {
    docs.push(
      income({ number: `FV ${m}/2026`, issueDate: `2026-${pad(m)}-28`, lines: [{ net: monthlyNet, vatRate: '23' }] }),
    );
    docs.push(cost({ number: `F ${m}/2026`, issueDate: `2026-${pad(m)}-10`, lines: [{ net: 50_000, vatRate: 'zw' }] }));
  }
  for (const [m, net] of Object.entries(extra)) {
    docs.push(cost({ number: `X ${m}/2026`, issueDate: `2026-${pad(m)}-15`, lines: [{ net, vatRate: 'zw' }] }));
  }
  return docs;
}

/**
 * Звіт обліку `app` проти «бухгалтера», чий облік — ті самі правила, але інші документи чи налаштування.
 * Еталон повний: VAT береться з обліку (його тут не перевіряємо), KPiR, DRA і zaliczka — з «бухгалтера».
 */
function reconcile(
  app: { docs: LedgerDocument[]; settings?: YearSettings },
  accountant: { docs: LedgerDocument[]; settings?: YearSettings },
  tweak: (refs: Record<string, MonthReference>) => void = () => {},
): MonthReport[] {
  const appSettings = app.settings ?? BASE;
  const appFigures = yearFigures(app.docs, appSettings, cfg2026);
  const accFigures = yearFigures(accountant.docs, accountant.settings ?? BASE, cfg2026);
  const refs: Record<string, MonthReference> = Object.fromEntries(
    accFigures.map((a, i) => [
      `2026-${pad(a.month)}`,
      {
        vat: appFigures[i].vat,
        kpir: { col9: a.kpir.col9, col10: a.kpir.col10, col15: a.kpir.col15 },
        zus: a.zus,
        pitAdvance: a.pitAdvance,
      },
    ]),
  );
  tweak(refs);
  return yearReport(app.docs, appSettings, cfg2026, refs);
}

const rowOf = (report: MonthReport[], month: number, metric: ReferenceMetric) =>
  report[month - 1].rows.find((r) => r.metric === metric)!;

/** Першопричини є лише в перелічених рядках ('місяць:показник'); у кожному рядку diff = derived + root */
function expectRootsOnly(report: MonthReport[], expected: string[]) {
  const roots = report.flatMap((m) => m.rows.filter((r) => r.root !== 0).map((r) => `${m.month}:${r.metric}`));
  expect(roots).toEqual(expected);
  for (const m of report) for (const r of m.rows) expect(r.derived + r.root).toBe(r.diff);
}

describe('розклад різниці: першопричина в KPiR і каскад', () => {
  const NET = 2_000_000;

  it('витрата в квітні: zdrowotna травня, кол. 15 червня і zaliczka — наслідок', () => {
    const report = reconcile({ docs: yearDocs(NET, { 4: 10_000 }) }, { docs: yearDocs(NET) });

    expectRootsOnly(report, ['4:kpir.col15']);
    expect(rowOf(report, 4, 'kpir.col15')).toMatchObject({ diff: 10_000, derived: 0, root: 10_000 });
    // 4,9% від 100 zł: zdrowotna за травень менша, сплачується в червні
    expect(rowOf(report, 5, 'zus.health')).toMatchObject({ diff: -490, derived: -490, root: 0, derivedFrom: [4] });
    expect(rowOf(report, 6, 'kpir.col15')).toMatchObject({ diff: -490, derived: -490, root: 0, derivedFrom: [4] });
    // zaliczka квітня менша на 19% від 100 zł — наслідок того самого місяця
    expect(rowOf(report, 4, 'pitAdvance')).toMatchObject({ diff: -1_900, derived: -1_900, root: 0, derivedFrom: [4] });
    // каскад другого порядку: −4,90 у кол. 15 червня дає +0,24 у zdrowotnej за липень
    expect(rowOf(report, 7, 'zus.health')).toMatchObject({ diff: 24, derived: 24 });

    expect(report.map((m) => m.unexplained)).toEqual([0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('пояснена першопричина робить звіреними всі місяці; наслідки окремих пояснень не потребують', () => {
    const report = reconcile({ docs: yearDocs(NET, { 4: 10_000 }) }, { docs: yearDocs(NET) }, (refs) => {
      refs['2026-04'].notes = { 'kpir.col15': 'Бухгалтер вніс netto' };
    });
    expect(report.every(isReconciled)).toBe(true);
  });

  it('продаж (кол. 9) теж першопричина', () => {
    const appDocs = [
      ...yearDocs(NET),
      income({ number: 'FV 3a/2026', issueDate: '2026-03-20', lines: [{ net: 100_000, vatRate: '23' }] }),
    ];
    const report = reconcile({ docs: appDocs }, { docs: yearDocs(NET) });
    expectRootsOnly(report, ['3:kpir.col9']);
    expect(rowOf(report, 4, 'zus.health')).toMatchObject({ diff: 4_900, derived: 4_900 });
    expect(rowOf(report, 5, 'kpir.col15')).toMatchObject({ diff: 4_900, derived: 4_900 });
  });

  it('січень: різниця витрат іде в zdrowotną лютого (wakacje) і кол. 15 березня', () => {
    const report = reconcile({ docs: yearDocs(NET, { 1: 10_000 }) }, { docs: yearDocs(NET) });
    expectRootsOnly(report, ['1:kpir.col15']);
    expect(rowOf(report, 2, 'zus.health')).toMatchObject({ diff: -490, derived: -490, derivedFrom: [1] });
    // У березні сплачується лише zdrowotna за лютий: FP за лютий оплатив бюджет
    expect(rowOf(report, 2, 'zus.fp')).toMatchObject({ app: 0, diff: 0 });
    expect(rowOf(report, 3, 'kpir.col15')).toMatchObject({ diff: -490, derived: -490, root: 0 });
  });

  it('січень: zdrowotna з доходу за грудень попереднього року — першопричина, джерела в році немає', () => {
    const report = reconcile(
      { docs: yearDocs(NET) },
      { docs: yearDocs(NET), settings: { ...BASE, prevDecemberIncome: 1_400_000 } },
    );
    expect(rowOf(report, 1, 'zus.health')).toMatchObject({ diff: 4_900, derived: 0, root: 4_900 });
    // Сплачена в лютому zdrowotna в KPiR бухгалтера інша: це окрема першопричина в кол. 15 лютого,
    // а далі вже каскад від неї
    expectRootsOnly(report, ['1:zus.health', '2:kpir.col15']);
    expect(rowOf(report, 3, 'zus.health')).toMatchObject({ derived: -240, root: 0, derivedFrom: [2] });
  });

  it('лютий з wakacjami: різниця витрат лютого — наслідок у zdrowotnej березня і кол. 15 квітня', () => {
    const report = reconcile({ docs: yearDocs(NET, { 2: 10_000 }) }, { docs: yearDocs(NET) });
    expectRootsOnly(report, ['2:kpir.col15']);
    expect(rowOf(report, 3, 'zus.health')).toMatchObject({ diff: -490, derived: -490 });
    expect(rowOf(report, 4, 'kpir.col15')).toMatchObject({ diff: -490, derived: -490 });
  });

  it('DRA бухгалтера за лютий більша, ніж сплачено: першопричина лише там, далі не поширюється', () => {
    const report = reconcile({ docs: yearDocs(NET) }, { docs: yearDocs(NET) }, (refs) => {
      refs['2026-02'].zus = { ...refs['2026-02'].zus, health: refs['2026-02'].zus!.health! + 10_000 };
    });
    expectRootsOnly(report, ['2:zus.health']);
    expect(report.flatMap((m) => m.rows).filter((r) => r.diff !== 0)).toHaveLength(1);
  });

  it('збитковий місяць: zdrowotna наступного — мінімум з обох боків, наслідок з’являється пізніше', () => {
    const loss = 2_000_000;
    const report = reconcile({ docs: yearDocs(NET, { 5: loss + 10_000 }) }, { docs: yearDocs(NET, { 5: loss }) });
    const results = calcYearFromDocuments(yearDocs(NET, { 5: loss }), BASE, cfg2026);
    expect(results[4].healthIncome).toBe(0);

    expectRootsOnly(report, ['5:kpir.col15']);
    // Травень збитковий: zdrowotna за червень мінімальна з обох боків
    expect(rowOf(report, 6, 'zus.health')).toMatchObject({ app: cfg2026.healthMin, diff: 0 });
    expect(rowOf(report, 7, 'kpir.col15').diff).toBe(0);
    // Збиток зменшує дохід червня: різниця 100 zł переходить у zdrowotną за липень і кол. 15 серпня
    expect(rowOf(report, 7, 'zus.health')).toMatchObject({ diff: -490, derived: -490, derivedFrom: [5] });
    expect(rowOf(report, 8, 'kpir.col15')).toMatchObject({ diff: -490, derived: -490 });
  });

  it('мінімальна zdrowotna: різниця нижче мінімуму наслідку не дає', () => {
    const low = 900_000;
    const report = reconcile({ docs: yearDocs(low, { 4: 10_000 }) }, { docs: yearDocs(low) });
    expectRootsOnly(report, ['4:kpir.col15']);
    expect(rowOf(report, 5, 'zus.health')).toMatchObject({ app: cfg2026.healthMin, diff: 0 });
    expect(rowOf(report, 6, 'kpir.col15').diff).toBe(0);
  });

  it('ліміт zdrowotnej: після вичерпання кол. 15 не змінюється, а zdrowotna й zaliczka — наслідок', () => {
    const high = 6_000_000;
    const settings = { ...BASE, prevDecemberIncome: 5_000_000 };
    const report = reconcile(
      { docs: yearDocs(high, { 3: 10_000, 8: 10_000 }), settings },
      { docs: yearDocs(high), settings },
    );
    const results = calcYearFromDocuments(yearDocs(high), settings, cfg2026);
    const limitMonth = results.findIndex((r) => r.cumulativeHealthDeducted === cfg2026.healthDeductionLimit) + 1;
    expect(limitMonth).toBeGreaterThan(4);
    expect(limitMonth).toBeLessThan(9);

    expectRootsOnly(report, ['3:kpir.col15', '8:kpir.col15']);
    // Березень ще до ліміту: zdrowotna за квітень → кол. 15 травня
    expect(rowOf(report, 5, 'kpir.col15')).toMatchObject({ diff: -490, derived: -490 });
    // Серпень після ліміту: zdrowotna за вересень менша, але в koszty вона вже не йде
    expect(rowOf(report, 9, 'zus.health')).toMatchObject({ diff: -490, derived: -490, derivedFrom: [3, 8] });
    expect(rowOf(report, 10, 'kpir.col15').diff).toBe(0);
    expect(rowOf(report, 8, 'pitAdvance')).toMatchObject({ derived: -1_900, root: 0 });
  });

  it('місяць без еталона KPiR не вирівнюється: його наслідок далі рахується першопричиною', () => {
    const report = reconcile({ docs: yearDocs(NET, { 4: 10_000 }) }, { docs: yearDocs(NET) }, (refs) => {
      delete refs['2026-04'].kpir;
    });
    expect(report[3].missing).toEqual(['kpir']);
    expectRootsOnly(report, ['4:pitAdvance', '5:zus.health', '6:kpir.col15']);
  });
});
