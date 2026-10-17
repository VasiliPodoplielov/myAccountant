import type { FxTables, LedgerDocument, Stored } from '../document';
import type { KpirTotals } from '../kpir';
import type { YearSettings } from '../tax';
import type { PurchaseVatField, SalesVatField } from '../vat';

/**
 * Місяць для звірки з бухгалтером: документи та підсумки, з якими облік має збігтися до гроша.
 * Справжні дані сюди потрапляють лише анонімізованими: вигадані назви й NIP, суми можна лишити.
 */
export interface MonthFixture {
  name: string;
  year: number;
  month: number;
  /** Документи, що зачіпають місяць: з датою PIT або VAT у ньому */
  documents: Stored<LedgerDocument>[];
  fx: FxTables;
  settings: YearSettings;
  expected: {
    /** Підсумок місяця в KPiR, разом із FP */
    kpir: KpirTotals;
    /** Підсумки реєстрів VAT по полях JPK_V7M */
    sales: Partial<Record<SalesVatField, number>>;
    purchases: Partial<Record<PurchaseVatField, number>>;
    /** VAT należny і naliczony в декларації, повні злоті */
    vatOutput: number;
    vatInput: number;
  };
}

const supplier = (name: string, nip: string) => ({ name, nip, country: 'PL' });

/**
 * Зразок, складений вручну (не дані бухгалтера): показує формат і покриває типові випадки місяця —
 * авто 50/75 з половиною гроша, import usług з ЄС і з-поза ЄС, курсову різницю,
 * фактури на межі місяців, амортизацію внутрішнім документом і FP.
 */
export const march2026: MonthFixture = {
  name: 'березень 2026 (зразок)',
  year: 2026,
  month: 3,
  fx: {
    EUR: { '2026-03-09': 4.2512 },
    USD: { '2026-03-02': 3.9127 },
  },
  settings: {
    chorobowe: false,
    prevDecemberIncome: 1_500_000,
    prevDecemberContributions: { social: 151_898, fp: 12_749, health: 50_000 },
  },
  documents: [
    {
      id: 'sale',
      kind: 'income',
      number: 'FV 3/2026',
      issueDate: '2026-03-31',
      contractor: supplier('Klient sp. z o.o.', '5250000000'),
      currency: 'PLN',
      lines: [{ net: 2_500_000, vatRate: '23', vat: 575_000 }],
      marker: 'BFK',
      source: 'manual',
    },
    {
      id: 'fuel-1',
      kind: 'cost',
      category: 'carMixed',
      number: 'F/0305/26',
      issueDate: '2026-03-05',
      contractor: supplier('Stacja Paliw S.A.', '7740000000'),
      currency: 'PLN',
      lines: [{ net: 24_382, vatRate: '23', vat: 5_608 }],
      ksefNumber: '7740000000-20260305-0A1B2C3D4E5F-01',
      source: 'ksef',
    },
    {
      id: 'fuel-2',
      kind: 'cost',
      category: 'carMixed',
      number: 'F/0319/26',
      issueDate: '2026-03-19',
      contractor: supplier('Stacja Paliw S.A.', '7740000000'),
      currency: 'PLN',
      lines: [{ net: 18_701, vatRate: '23', vat: 4_301 }],
      ksefNumber: '7740000000-20260319-0A1B2C3D4E5F-02',
      source: 'ksef',
    },
    {
      // оплата карткою з рахунку в PLN: банк списав 431,05 zł за 100 EUR
      id: 'ai',
      kind: 'cost',
      category: 'importServices',
      number: 'INV-2026-0310',
      issueDate: '2026-03-10',
      contractor: { name: 'AI Services Ltd', nip: '1234567AB', country: 'IE' },
      currency: 'EUR',
      lines: [{ net: 10_000, vatRate: '23' }],
      paidAt: '2026-03-10',
      paidPln: 43_105,
      source: 'manual',
    },
    {
      id: 'office',
      kind: 'cost',
      category: 'office',
      number: 'FV/12/03',
      issueDate: '2026-03-12',
      contractor: supplier('Biuro Plus sp. z o.o.', '1130000000'),
      currency: 'PLN',
      lines: [
        { net: 10_000, vatRate: '23', vat: 2_300 },
        { net: 5_000, vatRate: '8', vat: 400 },
      ],
      marker: 'BFK',
      source: 'manual',
    },
    {
      id: 'hosting',
      kind: 'cost',
      category: 'importServices',
      number: 'US-778',
      issueDate: '2026-03-03',
      contractor: { name: 'Hosting Inc.', country: 'US' },
      currency: 'USD',
      lines: [{ net: 2_100, vatRate: '23' }],
      source: 'manual',
    },
    {
      // виставлена в лютому, отримана в березні: koszt лютого, VAT березня
      id: 'late-received',
      kind: 'cost',
      category: 'other',
      number: 'FV/02/88',
      issueDate: '2026-02-27',
      receivedDate: '2026-03-02',
      contractor: supplier('Serwis sp. z o.o.', '6770000000'),
      currency: 'PLN',
      lines: [{ net: 20_000, vatRate: '23', vat: 4_600 }],
      marker: 'BFK',
      source: 'manual',
    },
    {
      // виставлена в березні, отримана у квітні: koszt березня, VAT квітня
      id: 'next-month-vat',
      kind: 'cost',
      category: 'other',
      number: 'FV/03/91',
      issueDate: '2026-03-30',
      receivedDate: '2026-04-02',
      contractor: supplier('Serwis sp. z o.o.', '6770000000'),
      currency: 'PLN',
      lines: [{ net: 30_000, vatRate: '23', vat: 6_900 }],
      marker: 'BFK',
      source: 'manual',
    },
    {
      id: 'depreciation',
      kind: 'internal',
      number: 'DW 3/2026',
      issueDate: '2026-03-31',
      description: 'Amortyzacja samochodu 03/2026',
      column: 15,
      amount: 150_000,
      source: 'manual',
    },
  ],
  expected: {
    kpir: {
      col9: 2_500_000,
      col10: 0,
      col11: 2_500_000,
      col12: 0,
      col13: 0,
      col14: 0,
      // 203,90 + 156,38 пальне; 425,12 + 5,93 різниця AI; 150,00 офіс; 82,17 хостинг;
      // 300,00 сервіс; 1 500,00 амортизація; 571,01 składki за лютий (FP 138,47 + мінімальна zdrowotna 432,54)
      col15: 339_451,
      col16: 339_451,
    },
    sales: { K_19: 2_500_000, K_20: 575_000, K_27: 8_217, K_28: 1_890, K_29: 42_512, K_30: 9_778 },
    // netto: 121,91 + 93,51 пальне (50%); 425,12 AI; 150,00 офіс; 82,17 хостинг; 200,00 сервіс з лютого
    purchases: { K_42: 107_271, K_43: 23_923 },
    vatOutput: 586_700,
    vatInput: 23_900,
  },
};

export const MONTH_FIXTURES: MonthFixture[] = [march2026];
