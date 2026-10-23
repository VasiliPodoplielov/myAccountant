import { describe, expect, it } from 'vitest';
import {
  easterSunday,
  nextWorkingDay,
  nonWorkingReason,
  polishHolidays,
  shiftDueDate,
  shiftedDueDates,
} from './deadlines';

describe('easterSunday', () => {
  it.each([
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
  ])('%i → %s', (year, expected) => {
    expect(easterSunday(year)).toBe(expected);
  });
});

describe('polishHolidays', () => {
  it('рухомі свята 2026 рахуються від Великодня', () => {
    const h = polishHolidays(2026);
    expect(h['2026-04-06']).toBe('Poniedziałek Wielkanocny');
    expect(h['2026-05-24']).toBe('Zielone Świątki');
    expect(h['2026-06-04']).toBe('Boże Ciało');
  });

  it('фіксовані свята на місці', () => {
    const h = polishHolidays(2026);
    for (const d of ['01-01', '01-06', '05-01', '05-03', '08-15', '11-01', '11-11', '12-25', '12-26']) {
      expect(h[`2026-${d}`], d).toBeDefined();
    }
  });

  it('Wigilia — вихідний від 2025 року', () => {
    expect(polishHolidays(2025)['2025-12-24']).toBe('Wigilia');
    expect(polishHolidays(2024)['2024-12-24']).toBeUndefined();
  });
});

describe('nonWorkingReason / nextWorkingDay', () => {
  it('субота, неділя, свято, робочий день', () => {
    expect(nonWorkingReason('2026-09-19')).toBe('sobota');
    expect(nonWorkingReason('2026-09-20')).toBe('niedziela');
    expect(nonWorkingReason('2026-11-11')).toBe('Święto Niepodległości');
    expect(nonWorkingReason('2026-09-21')).toBeNull();
  });

  it('робочий день повертається як є', () => {
    expect(nextWorkingDay('2026-02-20')).toBe('2026-02-20');
  });

  it('ланцюжок свято + субота + неділя: Wigilia 2026 → понеділок 28.12', () => {
    // 24.12 (чт) Wigilia, 25.12 (пт) і 26.12 (сб) свята, 27.12 неділя
    expect(nextWorkingDay('2026-12-24')).toBe('2026-12-28');
  });

  it('межа року: 31.12 робочий, 01.01 свято', () => {
    expect(nextWorkingDay('2026-12-31')).toBe('2026-12-31');
    expect(nextWorkingDay('2027-01-01')).toBe('2027-01-04');
  });

  it('Великодній понеділок пропускається', () => {
    // 5.04.2026 неділя (Wielkanoc), 6.04 свято → вівторок 7.04
    expect(nextWorkingDay('2026-04-05')).toBe('2026-04-07');
  });
});

describe('shiftDueDate', () => {
  it('робочий день не переноситься', () => {
    expect(shiftDueDate('2026-02-20')).toEqual({ nominal: '2026-02-20', due: '2026-02-20', reason: null });
  });

  it('неділя → понеділок, причина вказана', () => {
    expect(shiftDueDate('2026-09-20')).toEqual({ nominal: '2026-09-20', due: '2026-09-21', reason: 'niedziela' });
  });

  it('субота → понеділок', () => {
    expect(shiftDueDate('2027-03-20')).toEqual({ nominal: '2027-03-20', due: '2027-03-22', reason: 'sobota' });
  });

  it('свято в робочий день тижня → наступний день', () => {
    // 1.05.2026 п'ятниця, свято → понеділок 4.05 (3.05 неділя, свято)
    expect(shiftDueDate('2026-05-01')).toEqual({ nominal: '2026-05-01', due: '2026-05-04', reason: 'Święto Pracy' });
  });
});

describe('shiftedDueDates', () => {
  it('терміни місяця: 20-те і 25-те наступного, з перенесенням', () => {
    const d = shiftedDueDates(2026, 8); // вересень 2026: 20-те — неділя
    expect(d.zus.due).toBe('2026-09-21');
    expect(d.health.due).toBe('2026-09-21');
    expect(d.pit.due).toBe('2026-09-21');
    expect(d.vat.due).toBe('2026-09-25');
    expect(d.vat.reason).toBeNull();
  });

  it('грудень переходить на січень наступного року', () => {
    const d = shiftedDueDates(2026, 12);
    expect(d.zus.nominal).toBe('2027-01-20');
    expect(d.vat.nominal).toBe('2027-01-25');
  });
});
