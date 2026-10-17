import type { MonthFixture } from './types';

const PL = (name: string, nip: string) => ({ name, nip, country: 'PL' });

/**
 * Січень 2026 із документів бухгалтера (JPK_V7M(2) і KPiR), анонімізований: назви контрагентів,
 * NIP і номери документів вигадані, дати й суми справжні. Очікувані підсумки — з KPiR і JPK
 * бухгалтера, а не з рушія.
 * Для пального й шин JPK дає лише половину netto і VAT; повні суми відновлено так, що вони дають
 * ті самі K_42, K_43 і суму в KPiR.
 */
export const january2026: MonthFixture = {
  name: 'січень 2026 (бухгалтер, анонімізовано)',
  year: 2026,
  month: 1,
  fx: {},
  settings: {
    chorobowe: false,
    prevDecemberIncome: null,
    // składki за грудень 2025 сплачено ще в 2025 році
    prevDecemberContributions: null,
    contributionHolidayMonth: 2,
  },
  documents: [
    {
      id: 'sale',
      kind: 'income',
      number: 'FV 1/01/2026',
      issueDate: '2026-02-02',
      saleDate: '2026-01-31',
      periodicSettlement: true,
      contractor: PL('Klient IT sp. z o.o.', '1111111111'),
      currency: 'PLN',
      lines: [{ net: 1_856_000, vatRate: '23', vat: 426_880 }],
      source: 'import',
    },
    {
      id: 'fuel-1',
      kind: 'cost',
      category: 'carMixed',
      number: 'F 101/01/26',
      issueDate: '2026-01-04',
      contractor: PL('Stacja Paliw S.A.', '2222222222'),
      currency: 'PLN',
      lines: [{ net: 17_584, vatRate: '23', vat: 4_044 }],
      source: 'import',
    },
    {
      id: 'tyres',
      kind: 'cost',
      category: 'carMixed',
      number: 'FAS/1/01/2026',
      issueDate: '2026-01-08',
      contractor: PL('Opony sp. z o.o.', '3333333333'),
      currency: 'PLN',
      lines: [{ net: 125_853, vatRate: '23', vat: 28_946 }],
      source: 'import',
    },
    {
      id: 'tax-advice',
      kind: 'cost',
      category: 'other',
      number: '1/01/2026/DP',
      issueDate: '2026-01-14',
      description: 'Doradztwo podatkowe',
      contractor: PL('Doradca Podatkowy', '4444444444'),
      currency: 'PLN',
      lines: [{ net: 103_000, vatRate: '23', vat: 23_690 }],
      source: 'import',
    },
    {
      id: 'fuel-2',
      kind: 'cost',
      category: 'carMixed',
      number: 'F 102/01/26',
      issueDate: '2026-01-25',
      contractor: PL('Stacja Paliw S.A.', '2222222222'),
      currency: 'PLN',
      lines: [{ net: 26_775, vatRate: '23', vat: 6_159 }],
      source: 'import',
    },
    {
      id: 'accounting',
      kind: 'cost',
      category: 'other',
      number: '1/1/2026',
      issueDate: '2026-01-30',
      description: 'Usługi księgowe',
      contractor: PL('Biuro Rachunkowe', '5555555555'),
      currency: 'PLN',
      lines: [{ net: 22_000, vatRate: '23', vat: 5_060 }],
      source: 'import',
    },
  ],
  expected: {
    // Suma folio KPiR бухгалтера за січень; składek у січні немає
    kpir: { col9: 1_856_000, col10: 0, col11: 1_856_000, col12: 0, col13: 0, col14: 0, col15: 267_341, col16: 267_341 },
    // JPK_V7M бухгалтера за січень
    sales: { K_19: 1_856_000, K_20: 426_880 },
    purchases: { K_42: 210_107, K_43: 48_325 },
    vatOutput: 426_900,
    vatInput: 48_300,
  },
};
