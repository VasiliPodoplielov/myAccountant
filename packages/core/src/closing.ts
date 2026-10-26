/**
 * Закриття місяця (етап 8): запис periods/{yyyy-mm}, чекліст, знімок сум і захист закритих місяців.
 * Знімок — це MonthResult місяця на момент закриття; після закриття документи, що потрапляють у цей місяць,
 * не додаються й не видаляються без явного повторного відкриття (корекції).
 */

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

type EventDates = { pit: string; vat: string | null };

/** Місяці 'YYYY-MM', у яких документ з'являється: KPiR (дата PIT) і реєстр VAT */
export const datesPeriods = (dates: EventDates): string[] => [
  ...new Set([dates.pit.slice(0, 7), dates.vat?.slice(0, 7)].filter((p): p is string => !!p)),
];

/** Закриті місяці, яких торкається документ, за його датами PIT і VAT */
export function closedPeriodsTouched(dates: EventDates, periods: Readonly<Record<string, PeriodRecord>>): string[] {
  return datesPeriods(dates)
    .filter((p) => isClosed(periods, p))
    .sort();
}
