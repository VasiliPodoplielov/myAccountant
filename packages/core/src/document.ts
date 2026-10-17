/**
 * Первинний документ — основа обліку: фактура доходу, фактура витрати або внутрішній документ.
 * З документів виводяться записи KPiR (kpir.ts), реєстри VAT (vat.ts) і місячні суми для
 * calcYear (ledger.ts). Правила й джерела — ROADMAP.md, «Облік по документах (етап 4)».
 *
 * Суми — цілі найменші одиниці валюти документа; VAT — завжди PLN-гроші. Дати — 'YYYY-MM-DD'.
 */

import { isIsoDate } from './dates';
import { mulDiv, mulRate } from './money';
import type { ForeignCurrency } from './nbp';
import { CATEGORY_RULES, nbpRateFor, type CostCategory, type Currency } from './tax';

// ---------------------------------------------------------------- types

/** Код ставки VAT позиції: zw — zwolnione, np — nie podlega (місце надання поза Польщею) */
export type VatRateCode = '23' | '8' | '5' | '0' | 'zw' | 'np';

/** Позначка JPK_V7M(3) для документа без номера KSeF */
export type KsefMarker = 'OFF' | 'BFK' | 'DI';

export type DocumentSource = 'manual' | 'ksef' | 'import';

export interface Contractor {
  name: string;
  /** NIP; для закордонного контрагента — податковий номер без коду країни */
  nip?: string;
  /** Код країни (ISO 3166-1 alpha-2); для Польщі 'PL' */
  country: string;
  address?: string;
}

export interface DocumentLine {
  /** Netto у валюті документа; у коригувальному документі від'ємне */
  net: number;
  vatRate: VatRateCode;
  /** VAT з фактури, PLN-гроші. Якщо не вказано, рахується від суми netto за ставкою в межах документа */
  vat?: number;
}

interface DocumentBase {
  /** Номер документа (кол. 4 KPiR) */
  number: string;
  /** Дата виставлення */
  issueDate: string;
  /** Опис події для кол. 8 KPiR; без нього береться типовий за видом і категорією */
  description?: string;
  /** Дата події для PIT, якщо вона не за правилом з documentDates */
  pitDate?: string;
  source: DocumentSource;
}

interface InvoiceBase extends DocumentBase {
  contractor: Contractor;
  lines: DocumentLine[];
  currency: Currency;
  /** Дата продажу чи виконання послуги, якщо відрізняється від дати виставлення */
  saleDate?: string;
  /** Дата, що визначає місяць реєстру VAT, якщо вона не за правилом з documentDates */
  vatDate?: string;
  /** Ручний курс для PIT; без нього курс шукається в таблиці NBP (documentFx) */
  fxRatePit?: number;
  /** Ручний курс для VAT; без нього курс шукається в таблиці NBP (documentFx) */
  fxRateVat?: number;
  /** Номер KSeF; якщо його немає — позначка marker (одне з двох) */
  ksefNumber?: string;
  marker?: KsefMarker;
  /** Дата оплати */
  paidAt?: string;
  /** Сума в PLN, яку банк фактично списав чи зарахував за валютний документ (для курсових різниць) */
  paidPln?: number;
}

export interface IncomeDocument extends InvoiceBase {
  kind: 'income';
  /**
   * Послуга розраховується в розрахункових періодах (наприклад, щомісячно за договором): дохід PIT виникає
   * в останній день періоду (art. 14 ust. 1e PIT), навіть якщо фактуру виставлено раніше. Кінець періоду — saleDate.
   */
  periodicSettlement?: boolean;
}

export interface CostDocument extends InvoiceBase {
  kind: 'cost';
  category: CostCategory;
  /** Дата отримання фактури, якщо відрізняється від дати виставлення */
  receivedDate?: string;
}

/** Dowód wewnętrzny: запис лише в KPiR, без VAT (амортизація до етапу 5, ручні коригування) */
export interface InternalDocument extends DocumentBase {
  kind: 'internal';
  /** Колонка KPiR: 10 — pozostałe przychody, 15 — pozostałe wydatki */
  column: 10 | 15;
  /** Сума, PLN-гроші; від'ємна зменшує колонку */
  amount: number;
}

export type LedgerDocument = IncomeDocument | CostDocument | InternalDocument;

/** Документ із Firestore: id додає шар зберігання, у самому документі його немає */
export type Stored<T> = T & { id?: string };

export interface LedgerOptions {
  /** Таблиці курсів NBP за валютами: 'YYYY-MM-DD' → mid */
  fx?: FxTables;
  /** Чи вести курсові різниці (art. 24c). Типово так */
  fxDifferences?: boolean;
  /** K_42 при частковому відліку VAT: netto в частці відліку (типово) або повністю */
  partialNet?: 'proportional' | 'full';
}

export type FxTables = Partial<Record<ForeignCurrency, Record<string, number>>>;

// ---------------------------------------------------------------- reference data

/** Відсоток за кодом ставки; null — VAT на позиції немає */
export const VAT_PERCENT: Record<VatRateCode, number | null> = { '23': 23, '8': 8, '5': 5, '0': 0, zw: null, np: null };

/** Держави ЄС, крім Польщі. Греція в номерах VAT має код EL, у ISO — GR */
const OTHER_EU_COUNTRIES = new Set(
  'AT BE BG CY CZ DE DK EE EL ES FI FR GR HR HU IE IT LT LU LV MT NL PT RO SE SI SK'.split(' '),
);

/** Контрагент з іншої держави ЄС: продаж йому — K_12, import usług від нього — K_29/K_30 */
export function isOtherEuCountry(country: string): boolean {
  return OTHER_EU_COUNTRIES.has(country);
}

// ---------------------------------------------------------------- dates

const earliest = (...dates: (string | undefined)[]) => dates.filter((d) => d !== undefined).sort()[0];
const latest = (...dates: (string | undefined)[]) =>
  dates
    .filter((d) => d !== undefined)
    .sort()
    .at(-1);

export interface DocumentDates {
  /** Дата події для PIT: кол. 2 KPiR і місяць доходу чи витрати */
  pit: string;
  /** Дата, за якою документ потрапляє в місяць реєстру VAT; null — документ поза VAT */
  vat: string | null;
}

/**
 * Дати події за правилами (ROADMAP, «Дати події та курси»); pitDate і vatDate документа їх перевизначають.
 * Дохід: PIT — виконання послуги, не пізніше фактури чи оплати, а при розрахункових періодах — кінець
 * періоду; VAT — виконання послуги або раніша оплата.
 * Витрата: PIT — виставлення фактури; VAT — obowiązek у продавця, не раніше отримання фактури.
 * Import usług: VAT — виконання послуги або раніша оплата.
 */
export function documentDates(doc: LedgerDocument): DocumentDates {
  if (doc.kind === 'internal') return { pit: doc.pitDate ?? doc.issueDate, vat: null };

  const performed = doc.saleDate ?? doc.issueDate;
  if (doc.kind === 'income') {
    return {
      pit: doc.pitDate ?? (doc.periodicSettlement ? performed : earliest(performed, doc.issueDate, doc.paidAt)!),
      vat: doc.vatDate ?? earliest(performed, doc.paidAt)!,
    };
  }
  const vat = CATEGORY_RULES[doc.category].reverseCharge
    ? earliest(performed, doc.paidAt)!
    : latest(performed, doc.receivedDate ?? doc.issueDate)!;
  return { pit: doc.pitDate ?? doc.issueDate, vat: doc.vatDate ?? vat };
}

// ---------------------------------------------------------------- fx

/** Курси документа: 1 для PLN; null — курсу немає ні в документі, ні в таблиці NBP */
export interface DocumentFx {
  pit: number | null;
  vat: number | null;
}

/**
 * Курс PIT — NBP з останнього робочого дня перед днем доходу чи витрати (art. 11a PIT).
 * Курс VAT — перед днем obowiązku podatkowego (art. 31a ust. 1 VAT), а якщо фактуру
 * виставлено раніше — перед днем виставлення (ust. 2).
 */
export function documentFx(doc: IncomeDocument | CostDocument, tables: FxTables = {}): DocumentFx {
  if (doc.currency === 'PLN') return { pit: 1, vat: 1 };

  const table = tables[doc.currency] ?? {};
  const dates = documentDates(doc);
  let vatBasis: string;
  if (doc.kind === 'income') {
    vatBasis = earliest(dates.vat!, doc.issueDate)!;
  } else if (CATEGORY_RULES[doc.category].reverseCharge) {
    // фактуру виставляє не платник, тож ust. 2 не діє: береться день obowiązku
    vatBasis = dates.vat!;
  } else {
    // польська фактура у валюті: obowiązek виник у продавця, dates.vat тут — лише період відліку
    vatBasis = earliest(doc.saleDate, doc.issueDate)!;
  }

  return {
    pit: doc.fxRatePit ?? nbpRateFor(dates.pit, table)?.rate ?? null,
    vat: doc.fxRateVat ?? nbpRateFor(vatBasis, table)?.rate ?? null,
  };
}

// ---------------------------------------------------------------- valuation

/** Позиції документа з однією ставкою, зведені разом */
export interface VatGroup {
  rate: VatRateCode;
  /** Основа оподаткування, PLN-гроші */
  base: number;
  /** VAT, PLN-гроші: з фактури або порахований від основи */
  vat: number;
}

/** Суми документа в PLN, округлені по документу */
export interface DocumentValue {
  dates: DocumentDates;
  /** Netto всього документа за курсом PIT */
  netPit: number;
  groups: VatGroup[];
  /** VAT документа: з фактури, а для import usług — нарахований самим платником */
  vat: number;
  /** Частина VAT до відліку (для доходу 0) */
  vatDeductible: number;
  /** Невідлічений VAT: іде в koszty */
  vatNonDeductible: number;
  /** Przychód (дохід) або koszt PIT (витрата) */
  pitAmount: number;
}

function vatGroups(lines: readonly DocumentLine[], fxVat: number): VatGroup[] {
  const byRate = new Map<VatRateCode, { net: number; netWithoutVat: number; vat: number }>();
  for (const line of lines) {
    const g = byRate.get(line.vatRate) ?? { net: 0, netWithoutVat: 0, vat: 0 };
    g.net += line.net;
    if (line.vat === undefined) g.netWithoutVat += line.net;
    else g.vat += line.vat;
    byRate.set(line.vatRate, g);
  }
  return [...byRate].map(([rate, g]) => ({
    rate,
    base: mulRate(g.net, fxVat),
    vat: g.vat + mulDiv(mulRate(g.netWithoutVat, fxVat), VAT_PERCENT[rate] ?? 0, 100),
  }));
}

/** Суми документа в PLN. null — валютний документ без курсу: його не можна врахувати */
export function valueDocument(doc: IncomeDocument | CostDocument, tables: FxTables = {}): DocumentValue | null {
  const fx = documentFx(doc, tables);
  if (fx.pit === null || fx.vat === null) return null;

  const dates = documentDates(doc);
  const netPit = mulRate(
    doc.lines.reduce((a, l) => a + l.net, 0),
    fx.pit,
  );
  const groups = vatGroups(doc.lines, fx.vat);
  const vat = groups.reduce((a, g) => a + g.vat, 0);

  if (doc.kind === 'income') {
    return { dates, netPit, groups, vat, vatDeductible: 0, vatNonDeductible: 0, pitAmount: netPit };
  }
  const rule = CATEGORY_RULES[doc.category];
  const vatDeductible = mulRate(vat, rule.vatDeductible);
  const vatNonDeductible = vat - vatDeductible;
  return {
    dates,
    netPit,
    groups,
    vat,
    vatDeductible,
    vatNonDeductible,
    pitAmount: mulRate(netPit + vatNonDeductible, rule.pitShare),
  };
}

// ---------------------------------------------------------------- fx differences

/**
 * Курсова різниця при оплаті валютного документа (art. 24c PIT): додатна збільшує przychód,
 * від'ємна — koszty. Фактичний курс — сума paidPln; без неї береться курс NBP перед днем оплати.
 * null — різниця не рахується: PLN, немає оплати чи курсу, або на фактурі є VAT
 * (тоді сума до сплати не дорівнює netto і різницю вносять внутрішнім документом).
 */
export function fxDifference(
  doc: IncomeDocument | CostDocument,
  tables: FxTables = {},
): { date: string; amount: number } | null {
  if (doc.currency === 'PLN' || !doc.paidAt) return null;

  const value = valueDocument(doc, tables);
  if (!value) return null;
  const selfAssessed = doc.kind === 'cost' && CATEGORY_RULES[doc.category].reverseCharge;
  if (value.vat !== 0 && !selfAssessed) return null;

  let paid = doc.paidPln;
  if (paid === undefined) {
    const rate = nbpRateFor(doc.paidAt, tables[doc.currency] ?? {})?.rate;
    if (!rate) return null;
    paid = mulRate(
      doc.lines.reduce((a, l) => a + l.net, 0),
      rate,
    );
  }
  return { date: doc.paidAt, amount: doc.kind === 'cost' ? value.netPit - paid : paid - value.netPit };
}

// ---------------------------------------------------------------- validation

export type DocumentIssue =
  | 'number'
  | 'date'
  | 'saleDate'
  | 'contractor'
  | 'lines'
  | 'amount'
  | 'vat'
  | 'fxRate'
  | 'ksef'
  | 'reverseCharge'
  | 'payment';

/**
 * Проблеми в даних документа; порожній список — документ можна враховувати.
 * Функції обліку цього не перевіряють: документ із нецілими сумами дасть виняток.
 */
export function documentIssues(doc: LedgerDocument): DocumentIssue[] {
  const issues = new Set<DocumentIssue>();
  const check = (issue: DocumentIssue, bad: boolean) => bad && issues.add(issue);

  check('number', !doc.number.trim());
  const dates =
    doc.kind === 'internal'
      ? [doc.issueDate, doc.pitDate]
      : [
          doc.issueDate,
          doc.pitDate,
          doc.saleDate,
          doc.vatDate,
          doc.paidAt,
          doc.kind === 'cost' ? doc.receivedDate : undefined,
        ];
  check(
    'date',
    dates.some((d) => d !== undefined && !isIsoDate(d)),
  );

  if (doc.kind === 'internal') {
    check('amount', !Number.isSafeInteger(doc.amount));
    return [...issues];
  }

  check('contractor', !doc.contractor.name.trim() || !/^[A-Z]{2}$/.test(doc.contractor.country));
  // кінець розрахункового періоду береться з дати продажу; без неї дохід піде на день фактури
  check('saleDate', doc.kind === 'income' && doc.periodicSettlement === true && !doc.saleDate);
  check('lines', doc.lines.length === 0);
  check(
    'amount',
    doc.lines.some((l) => !Number.isSafeInteger(l.net) || (l.vat !== undefined && !Number.isSafeInteger(l.vat))),
  );
  check(
    'vat',
    doc.lines.some((l) => !VAT_PERCENT[l.vatRate] && l.vat !== undefined && l.vat !== 0),
  );
  check(
    'fxRate',
    [doc.fxRatePit, doc.fxRateVat].some((r) => r !== undefined && !(Number.isFinite(r) && r > 0)),
  );
  check('ksef', doc.ksefNumber !== undefined && doc.marker !== undefined);
  check(
    'reverseCharge',
    doc.kind === 'cost' && CATEGORY_RULES[doc.category].reverseCharge && doc.contractor.country === 'PL',
  );
  check('payment', doc.paidPln !== undefined && (!Number.isSafeInteger(doc.paidPln) || !doc.paidAt));

  return [...issues];
}
