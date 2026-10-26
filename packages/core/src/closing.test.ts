import { describe, expect, it } from 'vitest';
import {
  canClose,
  closedPeriodsTouched,
  closedRecord,
  closingChecklist,
  datesPeriods,
  isClosed,
  reopenedRecord,
  snapshotDrift,
  type ChecklistInput,
  type PeriodRecord,
} from './closing';
import type { LedgerDocument } from './document';
import { calcYearFromDocuments } from './ledger';
import type { MonthReport } from './reference';
import { TAX_CONFIG, type YearSettings } from './tax';

const settings: YearSettings = { chorobowe: false, prevDecemberIncome: null, prevDecemberContributions: null };
const sale: LedgerDocument = {
  kind: 'income',
  number: 'FV 1',
  issueDate: '2026-03-10',
  contractor: { name: 'Firma', nip: '1111111111', country: 'PL' },
  currency: 'PLN',
  lines: [{ net: 1_000_000, vatRate: '23', vat: 230_000 }],
  source: 'manual',
};
const result = calcYearFromDocuments([sale], settings, TAX_CONFIG[2026]!)[2]!;

const report = (over: Partial<MonthReport> = {}): MonthReport => ({
  month: 3,
  period: '2026-03',
  hasReference: true,
  missing: [],
  rows: [],
  unexplained: 0,
  ...over,
});

const ready = (over: Partial<ChecklistInput> = {}): ChecklistInput => ({
  month: 3,
  result,
  report: report(),
  confirmations: { documents: true, ksef: true },
  previousClosed: true,
  hasSettings: true,
  ...over,
});

const byId = (items: ReturnType<typeof closingChecklist>, id: string) => items.find((i) => i.id === id)!;

describe('closingChecklist', () => {
  it('усе виконано → можна закривати', () => {
    expect(canClose(closingChecklist(ready()))).toBe(true);
  });

  it('ручні пункти без підтвердження блокують закриття', () => {
    const items = closingChecklist(ready({ confirmations: { documents: true } }));
    expect(byId(items, 'ksef').done).toBe(false);
    expect(byId(items, 'documents').done).toBe(true);
    expect(canClose(items)).toBe(false);
  });

  it('документи без курсу NBP блокують закриття', () => {
    const items = closingChecklist(ready({ result: { ...result, missingFxRates: 2 } }));
    expect(byId(items, 'fx').done).toBe(false);
    expect(byId(items, 'fx').detail).toBe('Документів без курсу: 2');
  });

  it('немає еталона → звірка не пройдена', () => {
    const items = closingChecklist(ready({ report: report({ hasReference: false }) }));
    expect(byId(items, 'reconciliation').done).toBe(false);
    expect(byId(items, 'reconciliation').detail).toBe('Немає еталона за місяць');
  });

  it('відсутній звіт теж не проходить', () => {
    expect(byId(closingChecklist(ready({ report: undefined })), 'reconciliation').done).toBe(false);
  });

  it('непояснені різниці блокують, пояснені ні', () => {
    const blocked = closingChecklist(ready({ report: report({ unexplained: 3 }) }));
    expect(byId(blocked, 'reconciliation').detail).toBe('Непояснених різниць: 3');
    expect(canClose(blocked)).toBe(false);
    expect(canClose(closingChecklist(ready({ report: report({ unexplained: 0 }) })))).toBe(true);
  });

  it('неповний еталон блокує закриття й називає, чого бракує', () => {
    const items = closingChecklist(ready({ report: report({ missing: ['zus', 'pitAdvance'] }) }));
    expect(byId(items, 'reconciliation').done).toBe(false);
    expect(byId(items, 'reconciliation').detail).toBe('В еталоні немає: DRA, zaliczka PIT');
    expect(canClose(items)).toBe(false);
  });

  it('неповний еталон і непояснені різниці — обидві причини', () => {
    const items = closingChecklist(ready({ report: report({ missing: ['jpk'], unexplained: 1 }) }));
    expect(byId(items, 'reconciliation').detail).toBe('В еталоні немає: JPK_V7M. Непояснених різниць: 1');
  });

  it('розрахунок не вдався → calc і fx не виконано', () => {
    const items = closingChecklist(ready({ result: null }));
    expect(byId(items, 'calc').done).toBe(false);
    expect(byId(items, 'fx').done).toBe(false);
  });

  it('незаповнені налаштування року блокують закриття', () => {
    const items = closingChecklist(ready({ hasSettings: false }));
    expect(byId(items, 'settings').done).toBe(false);
    expect(canClose(items)).toBe(false);
  });

  it('попередній місяць має бути закритий, крім січня', () => {
    expect(byId(closingChecklist(ready({ previousClosed: false })), 'previous').done).toBe(false);
    expect(byId(closingChecklist(ready({ month: 1, previousClosed: false })), 'previous').done).toBe(true);
  });
});

describe('closedRecord / reopenedRecord', () => {
  const now = new Date('2026-10-22T10:00:00.000Z');

  it('закритий запис тримає знімок, кількість документів і підтвердження', () => {
    const confirmations = { documents: true, ksef: true };
    const rec = closedRecord(result, confirmations, 7, now);
    expect(rec).toMatchObject({ status: 'closed', closedAt: now.toISOString(), documentCount: 7, confirmations });
    expect(rec.snapshot).toEqual(result);
  });

  it('знімок не залежить від подальших змін розрахунку', () => {
    const live = { ...result };
    const rec = closedRecord(live, {}, 0, now);
    live.income = 1;
    expect(rec.snapshot!.income).toBe(result.income);
  });

  it('повторне відкриття прибирає знімок і зберігає підтвердження', () => {
    const closed = closedRecord(result, { documents: true }, 3, now);
    const later = new Date('2026-10-23T08:00:00.000Z');
    const open = reopenedRecord(closed, later);
    expect(open).toEqual({ status: 'open', confirmations: { documents: true }, reopenedAt: later.toISOString() });
    expect('snapshot' in open).toBe(false);
  });
});

describe('snapshotDrift', () => {
  it('збіг → порожній список', () => {
    expect(snapshotDrift(result, { ...result })).toEqual([]);
  });

  it('показує лише змінені показники', () => {
    const drift = snapshotDrift(result, { ...result, income: result.income + 100, totalToPay: result.totalToPay + 5 });
    expect(drift).toEqual([
      { key: 'income', was: result.income, now: result.income + 100 },
      { key: 'totalToPay', was: result.totalToPay, now: result.totalToPay + 5 },
    ]);
  });

  it('null у healthBase порівнюється як значення', () => {
    const drift = snapshotDrift({ ...result, healthBase: null }, { ...result, healthBase: 100 });
    expect(drift).toEqual([{ key: 'healthBase', was: null, now: 100 }]);
  });
});

describe('закриті місяці й документи', () => {
  const periods: Record<string, PeriodRecord> = {
    '2026-03': { status: 'closed', confirmations: {} },
    '2026-04': { status: 'open', confirmations: {} },
  };

  it('isClosed: лише status closed', () => {
    expect(isClosed(periods, '2026-03')).toBe(true);
    expect(isClosed(periods, '2026-04')).toBe(false);
    expect(isClosed(periods, '2026-05')).toBe(false);
  });

  it('datesPeriods: різні місяці PIT і VAT, без повторів і без VAT', () => {
    expect(datesPeriods({ pit: '2026-03-31', vat: '2026-04-02' })).toEqual(['2026-03', '2026-04']);
    expect(datesPeriods({ pit: '2026-03-31', vat: '2026-03-01' })).toEqual(['2026-03']);
    expect(datesPeriods({ pit: '2026-03-31', vat: null })).toEqual(['2026-03']);
  });

  it('документ торкається закритого місяця за PIT або за VAT', () => {
    expect(closedPeriodsTouched({ pit: '2026-03-10', vat: '2026-05-01' }, periods)).toEqual(['2026-03']);
    expect(closedPeriodsTouched({ pit: '2026-05-10', vat: '2026-03-01' }, periods)).toEqual(['2026-03']);
    expect(closedPeriodsTouched({ pit: '2026-04-10', vat: null }, periods)).toEqual([]);
  });
});
