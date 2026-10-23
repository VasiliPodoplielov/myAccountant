/**
 * Календар термінів сплати з перенесенням з вихідних і свят (етап 8).
 * Правило (ROADMAP, «Перенесення термінів з вихідних і свят»): якщо останній день терміну припадає на суботу
 * чи день, вільний від роботи, термін спливає наступного робочого дня (art. 12 § 5 Ordynacji podatkowej).
 */

import { dueDates } from './tax';

const DAY_MS = 86_400_000;

const parse = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
};
const format = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (iso: string, days: number) => format(new Date(parse(iso).getTime() + days * DAY_MS));

/** Великдень (неділя) за григоріанським календарем, алгоритм Meeus/Jones/Butcher */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Дні, вільні від роботи за законом (без неділь і субот): дата → назва. Wigilia (24.12) — вихідний від 2025 року.
 */
export function polishHolidays(year: number): Record<string, string> {
  const easter = easterSunday(year);
  const holidays: Record<string, string> = {
    [`${year}-01-01`]: 'Nowy Rok',
    [`${year}-01-06`]: 'Trzech Króli',
    [easter]: 'Wielkanoc',
    [addDays(easter, 1)]: 'Poniedziałek Wielkanocny',
    [`${year}-05-01`]: 'Święto Pracy',
    [`${year}-05-03`]: 'Święto Konstytucji 3 Maja',
    [addDays(easter, 49)]: 'Zielone Świątki',
    [addDays(easter, 60)]: 'Boże Ciało',
    [`${year}-08-15`]: 'Wniebowzięcie NMP',
    [`${year}-11-01`]: 'Wszystkich Świętych',
    [`${year}-11-11`]: 'Święto Niepodległości',
    [`${year}-12-25`]: 'Boże Narodzenie',
    [`${year}-12-26`]: 'Drugi dzień Bożego Narodzenia',
  };
  if (year >= 2025) holidays[`${year}-12-24`] = 'Wigilia';
  return holidays;
}

/** Чому день не робочий: назва свята, «sobota», «niedziela»; null — робочий день */
export function nonWorkingReason(iso: string): string | null {
  const day = parse(iso).getUTCDay();
  if (day === 0) return 'niedziela';
  if (day === 6) return 'sobota';
  return polishHolidays(Number(iso.slice(0, 4)))[iso] ?? null;
}

/** Найближчий робочий день, не раніше вказаного */
export function nextWorkingDay(iso: string): string {
  let day = iso;
  while (nonWorkingReason(day) !== null) day = addDays(day, 1);
  return day;
}

export interface ShiftedDate {
  /** Дата за правилом (20-те чи 25-те) */
  nominal: string;
  /** Фактичний останній день: перший робочий день, не раніше номінальної */
  due: string;
  /** Чому номінальну дату перенесено; null — не переносилась */
  reason: string | null;
}

export function shiftDueDate(nominal: string): ShiftedDate {
  const due = nextWorkingDay(nominal);
  return { nominal, due, reason: due === nominal ? null : nonWorkingReason(nominal) };
}

/** Терміни за місяць M (див. `dueDates`) з перенесенням з вихідних і свят */
export function shiftedDueDates(year: number, month: number) {
  const nominal = dueDates(year, month);
  return {
    zus: shiftDueDate(nominal.zus),
    health: shiftDueDate(nominal.health),
    pit: shiftDueDate(nominal.pit),
    vat: shiftDueDate(nominal.vat),
  };
}
