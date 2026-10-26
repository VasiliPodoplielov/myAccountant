/**
 * Еталон бухгалтера за місяць (reference/{yyyy-mm}) і звіт різниць з обліком (етап 6).
 * Еталон складається з того, що є у файлах бухгалтера: подана JPK_V7M, підсумок місяця в KPiR,
 * DRA і розрахунок zaliczki. Будь-яка частина може бути відсутня: тоді її показники не порівнюються,
 * а місяць не вважається звіреним (етап 8, критерій переходу 1).
 *
 * Розклад різниці (етап 8). Першопричини — лише різниці в KPiR (кол. 9, 10, 15): саме вони змінюють
 * дохід. Zdrowotna за M рахується від доходу M−1 і сплачується в M+1, тож різниця витрат у M
 * повертається в кол. 15 через два місяці (≈ 4,9%), а zaliczka PIT змінюється вже в M. Ці похідні
 * частини рахуються точно: рік перераховується так, ніби KPiR попередніх місяців збігалася з
 * бухгалтером. Що лишилося — першопричина, яка потребує пояснення. Різниця в DRA далі не поширюється:
 * що реально сплачено й відлічено, показує KPiR наступного місяця.
 */

import type { LedgerDocument, LedgerOptions, Stored } from './document';
import { jpkPeriod, type JpkField, type JpkV7M } from './jpk';
import { kpirContributions, kpirFromDocuments, kpirTotals, type KpirTotals } from './kpir';
import { documentMonthSums } from './ledger';
import { calcYearFromSums, type MonthResult, type MonthSums, type TaxYearConfig, type YearSettings } from './tax';
import { vatDeclaration, vatRegistersByMonth, vatTotals, type PurchaseVatField, type SalesVatField } from './vat';

/** Декларація VAT, повні злоті в грошах */
export interface VatSummary {
  /** VAT należny разом (P_38) */
  output: number;
  /** VAT naliczony за місяць без перенесеної надвишки (P_48 − P_39) */
  input: number;
  /** Надвишка з попереднього місяця (P_39) */
  carryIn: number;
  /** До сплати (P_51) */
  due: number;
  /** Надвишка на наступний місяць (P_62) */
  carryOut: number;
}

export interface MonthReference {
  /** З поданої JPK_V7M: декларація */
  vat?: VatSummary;
  /** З поданої JPK_V7M: підсумки ewidencji по всіх полях файла, навіть тих, яких облік не веде */
  sales?: Partial<Record<JpkField, number>>;
  purchases?: Partial<Record<JpkField, number>>;
  /** Підсумок місяця в KPiR бухгалтера (Suma folio) */
  kpir?: { col9?: number; col10?: number; col15?: number };
  /** DRA за місяць: składki, нараховані за цей місяць */
  zus?: { social?: number; fp?: number; health?: number };
  /** Zaliczka PIT за місяць з розрахунку бухгалтера */
  pitAdvance?: number;
  /** Пояснення різниць: показник → текст */
  notes?: Partial<Record<ReferenceMetric, string>>;
}

/** Ті самі показники, пораховані обліком з документів */
export interface MonthFigures {
  month: number;
  vat: VatSummary;
  sales: Partial<Record<SalesVatField, number>>;
  purchases: Partial<Record<PurchaseVatField, number>>;
  kpir: KpirTotals;
  zus: { social: number; fp: number; health: number };
  pitAdvance: number;
}

export type ReferenceMetric =
  | `vat.${keyof VatSummary}`
  | `sales.${JpkField}`
  | `purchases.${JpkField}`
  | 'kpir.col9'
  | 'kpir.col10'
  | 'kpir.col15'
  | 'zus.social'
  | 'zus.fp'
  | 'zus.health'
  | 'pitAdvance';

export interface ReferenceDiff {
  metric: ReferenceMetric;
  app: number;
  reference: number;
  /** app − reference */
  diff: number;
  /**
   * Похідна частина різниці: наслідок різниць KPiR попередніх місяців (składki в кол. 15, zdrowotna),
   * а для zaliczki — і цього місяця. Пояснення не потребує.
   */
  derived: number;
  /** diff − derived: першопричина, яка потребує пояснення */
  root: number;
  /** Місяці з різницями KPiR, від яких іде похідна частина (лише коли вона ненульова) */
  derivedFrom?: number[];
  note?: string;
}

/**
 * Що показав би облік, якби KPiR попередніх місяців (для zaliczki — і цього) збігалася з бухгалтером.
 * Різниця app − expected — похідна частина.
 */
export interface ExpectedFigures {
  col15: number;
  health: number;
  pitAdvance: number;
  /** Місяці з різницями KPiR до цього місяця (для кол. 15 і zdrowotnej) */
  sourcesBefore: number[];
  /** Те саме разом із цим місяцем (для zaliczki) */
  sourcesThrough: number[];
}

/** Частини еталона, без яких місяць не вважається звіреним */
export type ReferencePart = 'jpk' | 'kpir' | 'zus' | 'pitAdvance';

// ---------------------------------------------------------------- reference

/** Частина еталона з поданого файла JPK_V7M: декларація й підсумки ewidencji */
export function referenceFromJpk(jpk: JpkV7M): Pick<MonthReference, 'vat' | 'sales' | 'purchases'> {
  const p = (n: number) => jpk.declaration[`P_${n}`] ?? 0;
  return {
    vat: { output: p(38), input: p(48) - p(39), carryIn: p(39), due: p(51), carryOut: p(62) },
    sales: vatTotals(jpk.sales),
    purchases: vatTotals(jpk.purchases),
  };
}

/** Ідентифікатор еталона: той самий період, що й у файла */
export const referenceId = jpkPeriod;

/** Яких частин еталона бракує: JPK (декларація), KPiR (кол. 9 і 15), DRA (усі три składki), zaliczka */
export function missingReferenceParts(ref: MonthReference | undefined): ReferencePart[] {
  const missing: ReferencePart[] = [];
  if (!ref?.vat) missing.push('jpk');
  if (ref?.kpir?.col9 === undefined || ref.kpir.col15 === undefined) missing.push('kpir');
  if (ref?.zus?.social === undefined || ref.zus.fp === undefined || ref.zus.health === undefined) missing.push('zus');
  if (ref?.pitAdvance === undefined) missing.push('pitAdvance');
  return missing;
}

// ---------------------------------------------------------------- figures

/** Показники обліку за кожен місяць року: [0] — січень */
export function yearFigures(
  docs: readonly Stored<LedgerDocument>[],
  settings: YearSettings,
  cfg: TaxYearConfig,
  opts: LedgerOptions = {},
): MonthFigures[] {
  const results = calcYearFromSums(documentMonthSums(docs, cfg.year, opts), settings, cfg);
  return figuresFromResults(docs, results, cfg, opts);
}

function figuresFromResults(
  docs: readonly Stored<LedgerDocument>[],
  results: readonly MonthResult[],
  cfg: TaxYearConfig,
  opts: LedgerOptions,
): MonthFigures[] {
  const registers = vatRegistersByMonth(docs, cfg.year, opts);
  const entries = [...kpirFromDocuments(docs, cfg.year, opts), ...kpirContributions(cfg.year, results)];

  return results.map((r, i) => {
    const declaration = vatDeclaration(registers[i]);
    return {
      month: r.month,
      vat: {
        output: declaration.output,
        input: declaration.input,
        carryIn: r.vatCarryIn,
        due: r.vatDue,
        carryOut: r.vatCarryOut,
      },
      sales: vatTotals(registers[i].sales),
      purchases: vatTotals(registers[i].purchases),
      kpir: kpirTotals(entries, r.month),
      zus: { social: r.zusSocial, fp: r.fp, health: r.health },
      pitAdvance: r.pitAdvance,
    };
  });
}

/**
 * Очікувані показники для розкладу різниць. Місяці йдуть по черзі: місяць M порівнюється з розрахунком,
 * у якому KPiR місяців до M уже вирівняна з еталоном (кол. 9 і 10 — через przychód, кол. 15 — через koszty
 * документів, бо składki в ній самі похідні); потім вирівнюється й M. Місяць без еталона KPiR не
 * вирівнюється. Перераховується той самий рушій, тож мінімум і ліміт zdrowotnej, збиткові місяці,
 * wakacje składkowe й округлення враховано точно.
 */
export function expectedFigures(
  sums: readonly MonthSums[],
  results: readonly MonthResult[],
  figures: readonly MonthFigures[],
  references: readonly (MonthReference | undefined)[],
  settings: YearSettings,
  cfg: TaxYearConfig,
): ExpectedFigures[] {
  const incomeAdj = new Array<number>(12).fill(0);
  const costAdj = new Array<number>(12).fill(0);
  const contributions = (r: MonthResult) => r.fpPaid + r.healthInCosts;
  const recalc = () =>
    calcYearFromSums(
      sums.map((s) => ({
        ...s,
        income: s.income + incomeAdj[s.month - 1],
        pitCosts: s.pitCosts + costAdj[s.month - 1],
      })),
      settings,
      cfg,
    );

  let current: readonly MonthResult[] = results;
  const sources: number[] = [];
  return figures.map((f, i): ExpectedFigures => {
    const sourcesBefore = [...sources];
    // Кол. 15 до вирівнювання місяця: документи як в обліку, składki — з уже вирівняних попередніх місяців
    const col15 = f.kpir.col15 - contributions(results[i]) + contributions(current[i]);
    const kpir = references[i]?.kpir;
    if (kpir?.col9 !== undefined) incomeAdj[i] += kpir.col9 - f.kpir.col9;
    if (kpir?.col10 !== undefined) incomeAdj[i] += kpir.col10 - f.kpir.col10;
    if (kpir?.col15 !== undefined) costAdj[i] = kpir.col15 - col15;
    if (incomeAdj[i] !== 0 || costAdj[i] !== 0) {
      sources.push(f.month);
      current = recalc();
    }
    return {
      col15,
      health: current[i].health,
      pitAdvance: current[i].pitAdvance,
      sourcesBefore,
      sourcesThrough: [...sources],
    };
  });
}

// ---------------------------------------------------------------- diff

const VAT_KEYS: (keyof VatSummary)[] = ['output', 'input', 'carryIn', 'due', 'carryOut'];

/**
 * Порівняння місяця з еталоном: лише показники, що є в еталоні. Для реєстрів VAT порівнюються всі
 * поля, які є хоч з одного боку: поле, якого немає, дорівнює нулю. Без `expected` уся різниця —
 * першопричина.
 */
export function compareMonth(app: MonthFigures, ref: MonthReference, expected?: ExpectedFigures): ReferenceDiff[] {
  const rows: ReferenceDiff[] = [];
  const push = (
    metric: ReferenceMetric,
    appValue: number,
    refValue: number | undefined,
    cascade?: { expected: number; sources: number[] },
  ) => {
    if (refValue === undefined) return;
    const diff = appValue - refValue;
    const derived = cascade ? appValue - cascade.expected : 0;
    const row: ReferenceDiff = { metric, app: appValue, reference: refValue, diff, derived, root: diff - derived };
    if (cascade && derived !== 0) row.derivedFrom = cascade.sources;
    const note = ref.notes?.[metric];
    if (note) row.note = note;
    rows.push(row);
  };
  const before = (value: number) => expected && { expected: value, sources: expected.sourcesBefore };

  if (ref.vat) for (const k of VAT_KEYS) push(`vat.${k}`, app.vat[k], ref.vat[k]);

  const registerFields = (appFields: Partial<Record<JpkField, number>>, refFields: Partial<Record<JpkField, number>>) =>
    [...new Set([...Object.keys(appFields), ...Object.keys(refFields)] as JpkField[])].sort(
      (a, b) => Number(a.slice(2)) - Number(b.slice(2)),
    );
  if (ref.sales) {
    const appSales: Partial<Record<JpkField, number>> = app.sales;
    for (const f of registerFields(appSales, ref.sales)) push(`sales.${f}`, appSales[f] ?? 0, ref.sales[f] ?? 0);
  }
  if (ref.purchases) {
    const appPurchases: Partial<Record<JpkField, number>> = app.purchases;
    for (const f of registerFields(appPurchases, ref.purchases)) {
      push(`purchases.${f}`, appPurchases[f] ?? 0, ref.purchases[f] ?? 0);
    }
  }

  push('kpir.col9', app.kpir.col9, ref.kpir?.col9);
  push('kpir.col10', app.kpir.col10, ref.kpir?.col10);
  push('kpir.col15', app.kpir.col15, ref.kpir?.col15, expected && before(expected.col15));
  push('zus.social', app.zus.social, ref.zus?.social);
  push('zus.fp', app.zus.fp, ref.zus?.fp);
  push('zus.health', app.zus.health, ref.zus?.health, expected && before(expected.health));
  push(
    'pitAdvance',
    app.pitAdvance,
    ref.pitAdvance,
    expected && { expected: expected.pitAdvance, sources: expected.sourcesThrough },
  );
  return rows;
}

/**
 * Різниці, які потребують пояснення: ненульова різниця з першопричиною і без примітки. Похідна частина
 * пояснення не потребує. Нульова різниця теж, навіть якщо в ній першопричина й наслідок компенсують одне одного.
 */
export const unexplainedDiffs = (rows: readonly ReferenceDiff[]) =>
  rows.filter((r) => r.diff !== 0 && r.root !== 0 && !r.note);

export interface MonthReport {
  month: number;
  /** 'YYYY-MM' */
  period: string;
  hasReference: boolean;
  /** Частини еталона, яких бракує; звіреним вважається лише місяць з повним еталоном */
  missing: ReferencePart[];
  rows: ReferenceDiff[];
  unexplained: number;
}

/**
 * Звіт різниць за рік: по кожному місяцю, для якого є еталон, і пусті рядки для решти. Різниця кожного
 * показника розкладена на похідну частину й першопричину (expectedFigures).
 */
export function yearReport(
  docs: readonly Stored<LedgerDocument>[],
  settings: YearSettings,
  cfg: TaxYearConfig,
  references: Readonly<Record<string, MonthReference>>,
  opts: LedgerOptions = {},
): MonthReport[] {
  const sums = documentMonthSums(docs, cfg.year, opts);
  const results = calcYearFromSums(sums, settings, cfg);
  const figures = figuresFromResults(docs, results, cfg, opts);
  const periods = figures.map((f) => jpkPeriod({ year: cfg.year, month: f.month }));
  const refs = periods.map((p) => references[p]);
  const expected = expectedFigures(sums, results, figures, refs, settings, cfg);

  return figures.map((f, i) => {
    const ref = refs[i];
    const rows = ref ? compareMonth(f, ref, expected[i]) : [];
    return {
      month: f.month,
      period: periods[i],
      hasReference: !!ref,
      missing: missingReferenceParts(ref),
      rows,
      unexplained: unexplainedDiffs(rows).length,
    };
  });
}

/** Місяць звірено: еталон повний і непояснених різниць немає */
export const isReconciled = (report: MonthReport | undefined) =>
  !!report && report.hasReference && report.missing.length === 0 && report.unexplained === 0;
