import type { MonthReference, ReferenceMetric } from '@jdg/core';
import { fromGrosze, toGrosze } from '../format';

export const MONTH_NAMES = [
  'Січень',
  'Лютий',
  'Березень',
  'Квітень',
  'Травень',
  'Червень',
  'Липень',
  'Серпень',
  'Вересень',
  'Жовтень',
  'Листопад',
  'Грудень',
];

const LABELS: Partial<Record<ReferenceMetric, string>> = {
  'vat.output': 'VAT należny (P_38)',
  'vat.input': 'VAT naliczony (P_48 − P_39)',
  'vat.carryIn': 'Надвишка з попереднього місяця (P_39)',
  'vat.due': 'VAT до сплати (P_51)',
  'vat.carryOut': 'Надвишка на наступний місяць (P_62)',
  'kpir.col9': 'KPiR, кол. 9: продаж',
  'kpir.col10': 'KPiR, кол. 10: pozostałe przychody',
  'kpir.col15': 'KPiR, кол. 15: pozostałe wydatki',
  'zus.social': 'Społeczne (DRA)',
  'zus.fp': 'Fundusz Pracy (DRA)',
  'zus.health': 'Zdrowotna (DRA)',
  pitAdvance: 'Zaliczka PIT',
};

export function metricLabel(metric: ReferenceMetric): string {
  const register = /^(sales|purchases)\.(K_\d+)$/.exec(metric);
  if (register) return `${register[1] === 'sales' ? 'Реєстр продажу' : 'Реєстр закупівлі'}, ${register[2]}`;
  return LABELS[metric] ?? metric;
}

/** Поля еталона, які вносяться вручну з KPiR, DRA і розрахунку zaliczki; суми — у злотих */
export interface ReferenceForm {
  col9: number | '';
  col10: number | '';
  col15: number | '';
  social: number | '';
  fp: number | '';
  health: number | '';
  pitAdvance: number | '';
}

export function toReferenceForm(ref: MonthReference | undefined): ReferenceForm {
  return {
    col9: fromGrosze(ref?.kpir?.col9),
    col10: fromGrosze(ref?.kpir?.col10),
    col15: fromGrosze(ref?.kpir?.col15),
    social: fromGrosze(ref?.zus?.social),
    fp: fromGrosze(ref?.zus?.fp),
    health: fromGrosze(ref?.zus?.health),
    pitAdvance: fromGrosze(ref?.pitAdvance),
  };
}

/** Об'єкт без порожніх полів; якщо порожні всі — undefined (частина еталона відсутня) */
function defined<T extends Record<string, number | null>>(o: T): { [K in keyof T]?: number } | undefined {
  const entries = Object.entries(o).filter(([, v]) => v !== null);
  return entries.length > 0 ? (Object.fromEntries(entries) as { [K in keyof T]?: number }) : undefined;
}

/** Частини еталона з форми: порожнє поле — показника в еталоні немає і він не порівнюється */
export function fromReferenceForm(f: ReferenceForm): Pick<MonthReference, 'kpir' | 'zus' | 'pitAdvance'> {
  return {
    kpir: defined({ col9: toGrosze(f.col9), col10: toGrosze(f.col10), col15: toGrosze(f.col15) }),
    zus: defined({ social: toGrosze(f.social), fp: toGrosze(f.fp), health: toGrosze(f.health) }),
    pitAdvance: toGrosze(f.pitAdvance) ?? undefined,
  };
}

/** Пояснення без порожніх рядків */
export function cleanNotes(notes: Partial<Record<ReferenceMetric, string>>): Partial<Record<ReferenceMetric, string>> {
  return Object.fromEntries(
    Object.entries(notes)
      .filter(([, v]) => v?.trim())
      .map(([k, v]) => [k, v!.trim()]),
  );
}
