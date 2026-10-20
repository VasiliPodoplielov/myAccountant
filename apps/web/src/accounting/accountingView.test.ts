import { calcYearFromDocuments, TAX_CONFIG, type LedgerDocument, type YearSettings } from '@jdg/core';
import { describe, expect, it } from 'vitest';
import { formatDate, monthDocuments, monthPayments, yearTotals } from './accountingView';

const cfg = TAX_CONFIG[2026]!;
const settings: YearSettings = {
  chorobowe: false,
  prevDecemberIncome: null,
  prevDecemberContributions: null,
  contributionHolidayMonth: 2,
};
const pl = { name: 'Firma', nip: '1111111111', country: 'PL' };

type Doc = LedgerDocument & { id: string };
const docs: Doc[] = [
  {
    id: 'sale',
    kind: 'income',
    number: 'FV 1',
    issueDate: '2026-02-02',
    saleDate: '2026-01-31',
    periodicSettlement: true,
    contractor: pl,
    currency: 'PLN',
    lines: [{ net: 1_000_000, vatRate: '23', vat: 230_000 }],
    source: 'import',
  },
  {
    id: 'fuel',
    kind: 'cost',
    category: 'carMixed',
    number: 'F 1',
    issueDate: '2026-01-04',
    contractor: pl,
    currency: 'PLN',
    lines: [{ net: 10_000, vatRate: '23', vat: 2_300 }],
    source: 'import',
  },
  {
    id: 'usd',
    kind: 'cost',
    category: 'importServices',
    number: 'U 1',
    issueDate: '2026-01-10',
    contractor: { name: 'Foreign', country: 'US' },
    currency: 'USD',
    lines: [{ net: 5_000, vatRate: 'np' }],
    source: 'manual',
  },
  { id: 'wew', kind: 'internal', number: 'WEW 1', issueDate: '2026-01-31', column: 15, amount: 700, source: 'manual' },
];

describe('yearTotals', () => {
  it('складає місяці', () => {
    const results = calcYearFromDocuments(docs.slice(0, 2), settings, cfg);
    const t = yearTotals(results);
    expect(t.income).toBe(results.reduce((a, r) => a + r.income, 0));
    expect(t.totalToPay).toBe(results.reduce((a, r) => a + r.totalToPay, 0));
    expect(t.zus).toBe(results.reduce((a, r) => a + r.zusTotal, 0));
    expect(t.income).toBe(1_000_000);
  });

  it('порожній рік дає нулі', () => {
    const t = yearTotals(calcYearFromDocuments([], settings, cfg));
    expect(t.income).toBe(0);
    expect(t.netCash).toBeLessThanOrEqual(0);
  });
});

describe('monthPayments', () => {
  const [jan, , , , , , , , , , , dec] = calcYearFromDocuments(docs.slice(0, 2), settings, cfg);

  it('терміни: ZUS, zdrowotna і PIT — 20-те, VAT — 25-те наступного місяця', () => {
    const p = monthPayments(2026, jan!);
    expect(p.map((x) => [x.key, x.due])).toEqual([
      ['zus', '2026-02-20'],
      ['health', '2026-02-20'],
      ['pit', '2026-02-20'],
      ['vat', '2026-02-25'],
    ]);
  });

  it('суми беруться з розрахунку місяця', () => {
    const p = monthPayments(2026, jan!);
    expect(p.reduce((a, x) => a + x.amount, 0)).toBe(jan!.totalToPay);
  });

  it('грудень переходить на січень наступного року', () => {
    expect(monthPayments(2026, dec!)[0]!.due).toBe('2027-01-20');
  });
});

describe('monthDocuments', () => {
  it('документ потрапляє в місяць за датою PIT або VAT окремо', () => {
    const jan = monthDocuments(docs, 2026, 1);
    const sale = jan.find((r) => r.id === 'sale')!;
    // розрахунковий період: дохід у січні, VAT за датою виконання теж у січні
    expect(sale.inKpir).toBe(true);
    expect(sale.inVat).toBe(true);
    expect(monthDocuments(docs, 2026, 2).find((r) => r.id === 'sale')).toBeUndefined();
  });

  it('видаляти можна лише внесені вручну, імпорт з JPK — ні', () => {
    const byId = Object.fromEntries(monthDocuments(docs, 2026, 1).map((r) => [r.id, r.deletable]));
    expect(byId).toEqual({ fuel: false, usd: true, sale: false, wew: true });
  });

  it('сортує за датою і номером', () => {
    // дати PIT: fuel 01-04, usd 01-10, sale 01-31 (кінець періоду), wew 01-31 (номер WEW після FV)
    expect(monthDocuments(docs, 2026, 1).map((r) => r.id)).toEqual(['fuel', 'usd', 'sale', 'wew']);
  });

  it('koszt авто — 75% від netto з невідліченим VAT', () => {
    const fuel = monthDocuments(docs, 2026, 1).find((r) => r.id === 'fuel')!;
    expect(fuel.vat).toBe(2_300);
    // (10 000 + 1 150) × 75% = 8 362,5 → 8 363
    expect(fuel.pitAmount).toBe(8_363);
  });

  it('валютний документ без курсу позначено і не враховано', () => {
    const usd = monthDocuments(docs, 2026, 1).find((r) => r.id === 'usd')!;
    expect(usd.missingFx).toBe(true);
    expect(usd.pitAmount).toBeNull();
    const withRate = monthDocuments(docs, 2026, 1, { USD: { '2026-01-09': 4 } }).find((r) => r.id === 'usd')!;
    expect(withRate.missingFx).toBe(false);
    expect(withRate.pitAmount).toBe(20_000);
  });

  it('внутрішній документ без VAT: колонка 15 — витрата зі знаком мінус, VAT-реєстру немає', () => {
    const wew = monthDocuments(docs, 2026, 1).find((r) => r.id === 'wew')!;
    expect(wew.pitAmount).toBe(-700);
    expect(wew.inVat).toBe(false);
    expect(wew.vat).toBeNull();
  });

  it('порожній місяць', () => {
    expect(monthDocuments(docs, 2026, 7)).toEqual([]);
    expect(monthDocuments([], 2026, 1)).toEqual([]);
  });
});

describe('formatDate', () => {
  it('ISO → ДД.ММ.РРРР', () => {
    expect(formatDate('2026-02-05')).toBe('05.02.2026');
  });
});
