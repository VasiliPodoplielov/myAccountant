import type { CostDocument, IncomeDocument, InternalDocument } from '../document';

/** Документи для тестів: мінімальний коректний документ, поля перевизначаються */

export const income = (over: Partial<IncomeDocument> = {}): IncomeDocument => ({
  kind: 'income',
  number: 'FV 1/2026',
  issueDate: '2026-03-31',
  contractor: { name: 'Klient sp. z o.o.', nip: '5250000000', country: 'PL' },
  currency: 'PLN',
  lines: [{ net: 1_000_000, vatRate: '23' }],
  source: 'manual',
  ...over,
});

export const cost = (over: Partial<CostDocument> = {}): CostDocument => ({
  kind: 'cost',
  number: 'F/100/2026',
  issueDate: '2026-03-10',
  contractor: { name: 'Dostawca S.A.', nip: '1130000000', country: 'PL' },
  currency: 'PLN',
  category: 'office',
  lines: [{ net: 10_000, vatRate: '23' }],
  source: 'manual',
  ...over,
});

/** Import usług від постачальника з ЄС у EUR */
export const importEu = (over: Partial<CostDocument> = {}): CostDocument =>
  cost({
    number: 'INV-0001',
    contractor: { name: 'Dostawca usług Ltd', nip: '1234567AB', country: 'IE' },
    currency: 'EUR',
    category: 'importServices',
    ...over,
  });

export const internal = (over: Partial<InternalDocument> = {}): InternalDocument => ({
  kind: 'internal',
  number: 'DW 1/2026',
  issueDate: '2026-03-31',
  column: 15,
  amount: 10_000,
  source: 'manual',
  ...over,
});
