/**
 * Еталон бухгалтера за місяць (reference/{yyyy-mm}) і звіт різниць з обліком (етап 6).
 * Еталон складається з того, що є у файлах бухгалтера: подана JPK_V7M, підсумок місяця в KPiR,
 * DRA і розрахунок zaliczki. Будь-яка частина може бути відсутня: тоді її показники не порівнюються.
 */

import type { LedgerDocument, LedgerOptions, Stored } from './document';
import { jpkPeriod, type JpkField, type JpkV7M } from './jpk';
import { kpirContributions, kpirFromDocuments, kpirTotals, type KpirTotals } from './kpir';
import { calcYearFromDocuments } from './ledger';
import type { TaxYearConfig, YearSettings } from './tax';
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
  note?: string;
}

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

// ---------------------------------------------------------------- figures

/** Показники обліку за кожен місяць року: [0] — січень */
export function yearFigures(
  docs: readonly Stored<LedgerDocument>[],
  settings: YearSettings,
  cfg: TaxYearConfig,
  opts: LedgerOptions = {},
): MonthFigures[] {
  const results = calcYearFromDocuments(docs, settings, cfg, opts);
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

// ---------------------------------------------------------------- diff

const VAT_KEYS: (keyof VatSummary)[] = ['output', 'input', 'carryIn', 'due', 'carryOut'];

/**
 * Порівняння місяця з еталоном: лише показники, що є в еталоні. Для реєстрів VAT порівнюються всі
 * поля, які є хоч з одного боку: поле, якого немає, дорівнює нулю.
 */
export function compareMonth(app: MonthFigures, ref: MonthReference): ReferenceDiff[] {
  const rows: ReferenceDiff[] = [];
  const push = (metric: ReferenceMetric, appValue: number, refValue: number | undefined) => {
    if (refValue === undefined) return;
    const row: ReferenceDiff = { metric, app: appValue, reference: refValue, diff: appValue - refValue };
    const note = ref.notes?.[metric];
    if (note) row.note = note;
    rows.push(row);
  };

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
  push('kpir.col15', app.kpir.col15, ref.kpir?.col15);
  push('zus.social', app.zus.social, ref.zus?.social);
  push('zus.fp', app.zus.fp, ref.zus?.fp);
  push('zus.health', app.zus.health, ref.zus?.health);
  push('pitAdvance', app.pitAdvance, ref.pitAdvance);
  return rows;
}

/** Різниці без пояснення: місяць звірено, коли їх немає */
export const unexplainedDiffs = (rows: readonly ReferenceDiff[]) => rows.filter((r) => r.diff !== 0 && !r.note);

export interface MonthReport {
  month: number;
  /** 'YYYY-MM' */
  period: string;
  hasReference: boolean;
  rows: ReferenceDiff[];
  unexplained: number;
}

/** Звіт різниць за рік: по кожному місяцю, для якого є еталон, і пусті рядки для решти */
export function yearReport(
  docs: readonly Stored<LedgerDocument>[],
  settings: YearSettings,
  cfg: TaxYearConfig,
  references: Readonly<Record<string, MonthReference>>,
  opts: LedgerOptions = {},
): MonthReport[] {
  return yearFigures(docs, settings, cfg, opts).map((figures) => {
    const period = jpkPeriod({ year: cfg.year, month: figures.month });
    const ref = references[period];
    const rows = ref ? compareMonth(figures, ref) : [];
    return { month: figures.month, period, hasReference: !!ref, rows, unexplained: unexplainedDiffs(rows).length };
  });
}
