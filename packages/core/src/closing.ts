/**
 * Закриття місяця (етап 8): запис periods/{yyyy-mm}, чекліст, знімок сум і захист закритих місяців.
 * Знімок — це MonthResult місяця на момент закриття; після закриття документи, що потрапляють у цей місяць,
 * не додаються й не видаляються без явного повторного відкриття (корекції).
 */

import { documentDates, type LedgerDocument } from './document';
import { stableStringify } from './json';
import { isReconciled, type MonthReport, type ReferencePart } from './reference';
import type { MonthResult } from './tax';

/** Назви частин еталона для повідомлень */
export const REFERENCE_PART_LABELS: Record<ReferencePart, string> = {
  jpk: 'JPK_V7M',
  kpir: 'KPiR (кол. 9 і 15)',
  zus: 'DRA',
  pitAdvance: 'zaliczka PIT',
};

/** Перевірки, які власник підтверджує сам: програма не бачить повноти внесених документів */
export type ManualCheck = 'documents' | 'ksef';

export const MANUAL_CHECKS: { id: ManualCheck; label: string }[] = [
  { id: 'documents', label: 'Усі документи місяця внесено (продаж, витрати, рахунки з-за кордону)' },
  { id: 'ksef', label: 'Вхідні з KSeF розібрано' },
];

/** Запис periods/{yyyy-mm}. Без запису місяць відкритий. */
export interface PeriodRecord {
  status: 'open' | 'closed';
  /** Підтвердження ручних пунктів чекліста */
  confirmations: Partial<Record<ManualCheck, boolean>>;
  /** ISO-момент закриття */
  closedAt?: string;
  /** Знімок сум на момент закриття */
  snapshot?: MonthResult;
  /** Кількість документів, що стосуються місяця, на момент закриття */
  documentCount?: number;
  /** ISO-момент останнього повторного відкриття */
  reopenedAt?: string;
}

export type CheckId = ManualCheck | 'calc' | 'settings' | 'fx' | 'reconciliation' | 'previous';

export interface CheckItem {
  id: CheckId;
  label: string;
  kind: 'auto' | 'manual';
  done: boolean;
  /** Чому не виконано (або пояснення, що саме перевірено) */
  detail?: string;
}

export interface ChecklistInput {
  month: number;
  /** Розрахунок місяця; null, якщо рік не вдалося порахувати */
  result: MonthResult | null;
  /** Звіт звірки за місяць; undefined, якщо його немає */
  report: MonthReport | undefined;
  confirmations: Partial<Record<ManualCheck, boolean>>;
  /** Попередній місяць закрито (для січня не потрібно) */
  previousClosed: boolean;
  /** Налаштування року заповнені: без них ZUS, zdrowotna і zaliczka рахуються без даних за грудень */
  hasSettings: boolean;
}

/** Чекліст закриття: автоматичні перевірки й ручні підтвердження */
export function closingChecklist(input: ChecklistInput): CheckItem[] {
  const { result, report } = input;
  const reconciled = isReconciled(report);
  const reconciliationDetail = (): string | undefined => {
    if (!report?.hasReference) return 'Немає еталона за місяць';
    const problems: string[] = [];
    if (report.missing.length > 0) {
      problems.push(`В еталоні немає: ${report.missing.map((p) => REFERENCE_PART_LABELS[p]).join(', ')}`);
    }
    if (report.unexplained > 0) problems.push(`Непояснених різниць: ${report.unexplained}`);
    return problems.length > 0 ? problems.join('. ') : undefined;
  };
  return [
    ...MANUAL_CHECKS.map((c): CheckItem => ({
      id: c.id,
      label: c.label,
      kind: 'manual',
      done: input.confirmations[c.id] === true,
    })),
    {
      id: 'calc',
      label: 'Місяць пораховано без помилок',
      kind: 'auto',
      done: result !== null,
      detail: result === null ? 'Розрахунок року не вдався' : undefined,
    },
    {
      id: 'settings',
      label: 'Налаштування року заповнені',
      kind: 'auto',
      done: input.hasSettings,
      detail: input.hasSettings ? undefined : 'Без даних за грудень ZUS, zdrowotna і zaliczka неточні',
    },
    {
      id: 'fx',
      label: 'Усі курси NBP є',
      kind: 'auto',
      done: result !== null && result.missingFxRates === 0,
      detail:
        result === null
          ? 'Немає розрахунку'
          : result.missingFxRates > 0
            ? `Документів без курсу: ${result.missingFxRates}`
            : undefined,
    },
    {
      id: 'reconciliation',
      label: 'Звірку з бухгалтером пройдено (еталон повний, непояснених різниць немає)',
      kind: 'auto',
      done: reconciled,
      detail: reconciliationDetail(),
    },
    {
      id: 'previous',
      label: 'Попередній місяць закрито',
      kind: 'auto',
      done: input.month === 1 || input.previousClosed,
      detail: input.month === 1 || input.previousClosed ? undefined : 'Спершу закрийте попередній місяць',
    },
  ];
}

export const canClose = (items: readonly CheckItem[]) => items.every((i) => i.done);

export const isClosed = (periods: Readonly<Record<string, PeriodRecord>>, period: string) =>
  periods[period]?.status === 'closed';

/** Запис закритого місяця: знімок береться з розрахунку, ручні підтвердження зберігаються */
export function closedRecord(
  result: MonthResult,
  confirmations: PeriodRecord['confirmations'],
  documentCount: number,
  now: Date,
): PeriodRecord {
  return {
    status: 'closed',
    confirmations: { ...confirmations },
    closedAt: now.toISOString(),
    snapshot: { ...result },
    documentCount,
  };
}

/** Відкритий запис після повторного відкриття: знімок прибирається, підтвердження лишаються */
export function reopenedRecord(previous: PeriodRecord, now: Date): PeriodRecord {
  return { status: 'open', confirmations: { ...previous.confirmations }, reopenedAt: now.toISOString() };
}

export interface SnapshotDrift {
  key: keyof MonthResult;
  was: number | null;
  now: number | null;
}

/** Показники, які змінилися після закриття (наприклад, повторним імпортом JPK). Порожній список — все збігається. */
export function snapshotDrift(snapshot: MonthResult, current: MonthResult): SnapshotDrift[] {
  const drift: SnapshotDrift[] = [];
  for (const key of Object.keys(snapshot) as (keyof MonthResult)[]) {
    const was = snapshot[key];
    const now = current[key];
    if (was !== now) drift.push({ key, was, now });
  }
  return drift;
}

// ---------------------------------------------------------------- documents and closed months

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Місяці 'YYYY-MM', яких торкається документ: KPiR за датою PIT, реєстр VAT і, для валютного документа,
 * місяць оплати (курсова різниця йде в KPiR днем оплати). Від одного до трьох, за зростанням.
 */
export function documentPeriods(doc: LedgerDocument): string[] {
  const dates = documentDates(doc);
  const paidAt = doc.kind !== 'internal' && doc.currency !== 'PLN' ? doc.paidAt : undefined;
  return [...new Set([dates.pit, dates.vat, paidAt].flatMap((d) => (d ? [d.slice(0, 7)] : [])))]
    .filter((p) => PERIOD.test(p))
    .sort();
}

/** Закриті місяці, яких торкається документ */
export function closedPeriodsTouched(doc: LedgerDocument, periods: Readonly<Record<string, PeriodRecord>>): string[] {
  return documentPeriods(doc).filter((p) => isClosed(periods, p));
}

/**
 * Документ у Firestore несе touchedPeriods = documentPeriods(doc): за ним firestore.rules не пускають запис,
 * що торкається закритого місяця (правила самі дат події не рахують). Поле похідне, тому проставляється при
 * кожному записі й не йде в бекап.
 */
export type StampedDocument<T extends LedgerDocument = LedgerDocument> = T & { touchedPeriods: string[] };

/** Документ із полем, порахованим заново (застаріле значення замінюється) */
export function withTouchedPeriods<T extends LedgerDocument>(doc: T): StampedDocument<T> {
  return { ...doc, touchedPeriods: documentPeriods(doc) };
}

export function withoutTouchedPeriods<T extends object>(doc: T): Omit<T, 'touchedPeriods'> {
  const copy: Partial<T> & { touchedPeriods?: unknown } = { ...doc };
  delete copy.touchedPeriods;
  return copy as Omit<T, 'touchedPeriods'>;
}

/** Документ, у якого поля touchedPeriods немає або воно не збігається з датами (записаний до правила) */
export function needsStamp(doc: LedgerDocument & { touchedPeriods?: unknown }): boolean {
  return stableStringify(doc.touchedPeriods) !== stableStringify(documentPeriods(doc));
}

/**
 * Закриті місяці, які зачепить запис документа next замість наявного existing (next = null — видалення).
 * Повторний запис тих самих даних нічого не зачіпає: так повторний імпорт JPK закритого місяця проходить.
 * Те саме перевіряють firestore.rules; тут — щоб показати причину до запису.
 */
export function closedPeriodsAffected(
  next: LedgerDocument | null,
  existing: LedgerDocument | undefined,
  periods: Readonly<Record<string, PeriodRecord>>,
): string[] {
  if (next && existing && sameDocument(next, existing)) return [];
  const touched = [
    ...(next ? closedPeriodsTouched(next, periods) : []),
    ...(existing ? closedPeriodsTouched(existing, periods) : []),
  ];
  return [...new Set(touched)].sort();
}

/** Ті самі дані без урахування похідного touchedPeriods */
export const sameDocument = (a: LedgerDocument, b: LedgerDocument) =>
  stableStringify(withoutTouchedPeriods(a)) === stableStringify(withoutTouchedPeriods(b));

/** Закриті місяці за зростанням: вміст locks/periods { closed } */
export const closedPeriodList = (periods: Readonly<Record<string, PeriodRecord>>): string[] =>
  Object.keys(periods)
    .filter((p) => isClosed(periods, p))
    .sort();
