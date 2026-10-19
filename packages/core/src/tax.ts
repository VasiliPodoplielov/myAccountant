/**
 * Податковий рушій JDG: podatek liniowy + VAT (щомісячно), duży ZUS.
 * Перенесено з калькулятора на claude.ai. Відмінність від нього: składki відлічуються
 * в місяці сплати (за місяць M — у M+1), а не в місяці, за який нараховані; дохід для
 * zdrowotnej рахується наростаючим підсумком, тож збиток зменшує базу наступних місяців.
 *
 * Усі грошові суми — ЦІЛІ ГРОШІ (1 zł = 100). Ставки — частки (0.23 = 23%).
 * Місяці — 1..12.
 */

// ---------------------------------------------------------------- config

export interface TaxYearConfig {
  year: number;
  /** База duży ZUS, гроші */
  zusBase: number;
  zusRates: {
    emerytalna: number;
    rentowa: number;
    chorobowa: number;
    wypadkowa: number;
    funduszPracy: number;
  };
  /** Zdrowotna на liniowym, частка доходу */
  healthRate: number;
  /** Мінімальна zdrowotna за січень (кінець попереднього składkowego року), гроші */
  healthMinJanuary: number;
  /** Мінімальна zdrowotna лютий–грудень, гроші */
  healthMin: number;
  /** Річний ліміт відліку zdrowotnej від доходу, гроші */
  healthDeductionLimit: number;
  pitRate: number;
  salesVatRate: number;
}

/** Конфіг є не для кожного року: для року без запису повертається undefined */
export const TAX_CONFIG: Partial<Record<number, TaxYearConfig>> = {
  2026: {
    year: 2026,
    zusBase: 565_200,
    zusRates: {
      emerytalna: 0.1952,
      rentowa: 0.08,
      chorobowa: 0.0245,
      wypadkowa: 0.0167,
      funduszPracy: 0.0245,
    },
    healthRate: 0.049,
    healthMinJanuary: 31_496,
    healthMin: 43_254,
    healthDeductionLimit: 1_410_000,
    pitRate: 0.19,
    salesVatRate: 0.23,
  },
};

// ---------------------------------------------------------------- categories

export type CostCategory = 'carMixed' | 'importServices' | 'office' | 'other';

export interface CategoryRule {
  /** Частка VAT, яку можна відлічити */
  vatDeductible: number;
  /** Частка (netto + невідлічений VAT), що йде в koszty PIT */
  pitShare: number;
  /** Import usług: VAT нараховується і відлічується самим платником */
  reverseCharge: boolean;
  /** Колонка KPiR (взірець з 2026 року), у яку йде koszt */
  kpirColumn: 12 | 13 | 14 | 15;
}

export const CATEGORY_RULES: Record<CostCategory, CategoryRule> = {
  carMixed: { vatDeductible: 0.5, pitShare: 0.75, reverseCharge: false, kpirColumn: 15 },
  importServices: { vatDeductible: 1, pitShare: 1, reverseCharge: true, kpirColumn: 15 },
  office: { vatDeductible: 1, pitShare: 1, reverseCharge: false, kpirColumn: 15 },
  other: { vatDeductible: 1, pitShare: 1, reverseCharge: false, kpirColumn: 15 },
};

// ---------------------------------------------------------------- input

export interface Income {
  month: number;
  /** Netto, гроші */
  net: number;
}

/** Валюти фактур; PLN — базова, решта конвертуються за курсом NBP */
export type Currency = 'PLN' | 'EUR' | 'USD';

export interface Cost {
  month: number;
  currency: Currency;
  /** Netto у валюті фактури, найменші одиниці (гроші / центи) */
  amount: number;
  vatRate: number;
  category: CostCategory;
  /** Курс NBP для EUR/USD (ручний або знайдений через nbpRateFor). Для PLN ігнорується. */
  fxRate?: number | null;
}

/** Składki за один місяць, гроші */
export interface Contributions {
  social: number;
  fp: number;
  health: number;
}

export interface YearSettings {
  chorobowe: boolean;
  /** Дохід за грудень попереднього року (гроші) для zdrowotnej за січень; null → мінімум */
  prevDecemberIncome: number | null;
  /** Składki за грудень попереднього року, сплачені в січні; null → у січні нічого не відлічується */
  prevDecemberContributions: Contributions | null;
  /**
   * Місяць wakacji składkowych (1..12): społeczne і FP за нього оплачує бюджет, zdrowotna лишається.
   * Право на них — раз на рік. null або не вказано — без канікул.
   */
  contributionHolidayMonth?: number | null;
  /**
   * Сплачена zdrowotna йде в koszty (у межах річного ліміту), а не відлічується від доходу. Типово так.
   * На PIT це не впливає, але зменшує дохід, від якого рахується zdrowotna наступного місяця.
   * false — zdrowotna відлічується від доходу і базу для zdrowotnej не зменшує.
   */
  healthAsCost?: boolean;
  /**
   * Надвишка VAT, перенесена з грудня попереднього року в січень (P_39 січневої декларації), гроші.
   * Не вказано — 0.
   */
  openingVatCarry?: number;
}

export interface YearInput {
  incomes: Income[];
  costs: Cost[];
  settings: YearSettings;
}

/**
 * Місячні суми, з яких рахується рік. Джерело — суми за категоріями (categoryMonthSums)
 * або первинні документи (documentMonthSums у ledger.ts).
 */
export interface MonthSums {
  month: number;
  /** Przychód PIT, гроші */
  income: number;
  /** VAT należny після округлення до злотих (продаж + import usług) */
  vatOutput: number;
  /** VAT naliczony до відліку після округлення до злотих */
  vatInput: number;
  /** VAT з import usług до округлення */
  reverseChargeVat: number;
  /** Koszty PIT без FP */
  pitCosts: number;
  /** Реальні грошові витрати (netto + невідлічений VAT) */
  cashCosts: number;
  /** Кількість валютних документів (EUR/USD) без курсу — їх не враховано */
  missingFxRates: number;
}

// ---------------------------------------------------------------- output

export interface MonthResult {
  month: number;
  income: number;
  /** VAT należny після округлення до злотих (продаж + import usług) */
  vatOutput: number;
  /** VAT naliczony до відліку після округлення до злотих */
  vatInput: number;
  reverseChargeVat: number;
  vatCarryIn: number;
  vatCarryOut: number;
  vatDue: number;
  /** Koszty PIT без FP */
  pitCosts: number;
  /** Реальні грошові витрати (netto + невідлічений VAT) */
  cashCosts: number;
  /** Społeczne за цей місяць (до сплати до 20-го наступного) */
  zusSocial: number;
  /** FP за цей місяць */
  fp: number;
  zusTotal: number;
  /** Społeczne, сплачені в цьому місяці (за попередній) — відлічуються від доходу */
  zusSocialPaid: number;
  /** FP, сплачений у цьому місяці (за попередній) — koszt */
  fpPaid: number;
  /** Дохід за місяць: przychód − koszty − FP і społeczne (і zdrowotna, якщо вона в kosztach), сплачені в цьому місяці */
  monthlyIncomeAfterZus: number;
  /**
   * Дохід цього місяця для zdrowotnej, наростаючим підсумком з січня: збитковий місяць дає 0,
   * а збиток зменшує дохід наступних місяців. За грудень — це prevDecemberIncome наступного року.
   */
  healthIncome: number;
  /** healthIncome попереднього місяця, від якого рахується zdrowotna (null → мінімум) */
  healthBase: number | null;
  /** Zdrowotna за цей місяць (до сплати до 20-го наступного) */
  health: number;
  /** Zdrowotna, сплачена в цьому місяці (за попередній) */
  healthPaid: number;
  /** Частина healthPaid у межах річного ліміту: відлічена від доходу або внесена в koszty (healthAsCost) */
  healthDeducted: number;
  /** Частина healthDeducted, внесена в koszty (0, якщо healthAsCost вимкнено): іде в KPiR разом із FP */
  healthInCosts: number;
  cumulativeIncome: number;
  cumulativeHealthDeducted: number;
  /** Podstawa opodatkowania з січня, округлена до злотих */
  pitBase: number;
  pitTaxCumulative: number;
  pitAdvance: number;
  totalToPay: number;
  netCash: number;
  /** Кількість валютних документів (EUR/USD) без курсу — їх не враховано */
  missingFxRates: number;
}

// ---------------------------------------------------------------- helpers

const pct = (amount: number, rate: number) => Math.round(amount * rate);
/** До злотих для старого шляху: вхід буває нецілим (частка від float); точне округлення — toFullZloty у money.ts */
const roundToZloty = (grosze: number) => Math.round(grosze / 100) * 100;

export function zusForMonth(cfg: TaxYearConfig, chorobowe: boolean) {
  const b = cfg.zusBase;
  const r = cfg.zusRates;
  const social = pct(b, r.emerytalna) + pct(b, r.rentowa) + (chorobowe ? pct(b, r.chorobowa) : 0) + pct(b, r.wypadkowa);
  const fp = pct(b, r.funduszPracy);
  return { social, fp, total: social + fp };
}

/** Перерахунок витрати в PLN-гроші. null, якщо для валюти немає курсу. */
export function costNetPln(cost: Cost): number | null {
  if (cost.currency === 'PLN') return cost.amount;
  if (!cost.fxRate) return null;
  return Math.round(cost.amount * cost.fxRate);
}

// ---------------------------------------------------------------- main

/** Місячні суми з сум за категоріями: VAT і koszty рахуються й округлюються по місяцю */
export function categoryMonthSums(input: Pick<YearInput, 'incomes' | 'costs'>, cfg: TaxYearConfig): MonthSums[] {
  const sums: MonthSums[] = [];

  for (let m = 1; m <= 12; m++) {
    const income = input.incomes.filter((i) => i.month === m).reduce((a, i) => a + i.net, 0);
    const salesVat = pct(income, cfg.salesVatRate);

    let rcVat = 0;
    let vatIn = 0;
    let pitCostsRaw = 0;
    let cashCosts = 0;
    let missing = 0;

    for (const c of input.costs.filter((x) => x.month === m)) {
      const net = costNetPln(c);
      if (net === null) {
        missing++;
        continue;
      }
      const rule = CATEGORY_RULES[c.category];
      const vat = pct(net, c.vatRate);
      if (rule.reverseCharge) {
        rcVat += vat;
        vatIn += vat;
        pitCostsRaw += net * rule.pitShare;
        cashCosts += net;
      } else {
        const deductible = vat * rule.vatDeductible;
        const nonDeductible = vat - deductible;
        vatIn += deductible;
        pitCostsRaw += (net + nonDeductible) * rule.pitShare;
        cashCosts += net + nonDeductible;
      }
    }

    sums.push({
      month: m,
      income,
      // VAT (JPK — повні злоті)
      vatOutput: roundToZloty(salesVat + rcVat),
      vatInput: roundToZloty(Math.round(vatIn)),
      reverseChargeVat: rcVat,
      pitCosts: Math.round(pitCostsRaw),
      cashCosts: Math.round(cashCosts),
      missingFxRates: missing,
    });
  }

  return sums;
}

export function calcYear(input: YearInput, cfg: TaxYearConfig): MonthResult[] {
  return calcYearFromSums(categoryMonthSums(input, cfg), input.settings, cfg);
}

const EMPTY_MONTH: Omit<MonthSums, 'month'> = {
  income: 0,
  vatOutput: 0,
  vatInput: 0,
  reverseChargeVat: 0,
  pitCosts: 0,
  cashCosts: 0,
  missingFxRates: 0,
};

/** Рік із місячних сум; місяць, якого в `months` немає, вважається порожнім */
export function calcYearFromSums(
  months: readonly MonthSums[],
  settings: YearSettings,
  cfg: TaxYearConfig,
): MonthResult[] {
  const zus = zusForMonth(cfg, settings.chorobowe);
  const healthAsCost = settings.healthAsCost ?? true;
  const holiday = settings.contributionHolidayMonth ?? null;
  if (holiday !== null && !(Number.isInteger(holiday) && holiday >= 1 && holiday <= 12)) {
    throw new RangeError(`contributionHolidayMonth має бути місяцем 1..12, а не ${String(holiday)}`);
  }
  const openingCarry = settings.openingVatCarry ?? 0;
  if (!Number.isSafeInteger(openingCarry) || openingCarry < 0) {
    throw new RangeError(`openingVatCarry має бути невід'ємною сумою в грошах, а не ${String(openingCarry)}`);
  }
  const results: MonthResult[] = [];

  let carry = openingCarry;
  let cumIncome = 0;
  let cumHealthDed = 0;
  let cumPit = 0;
  let cumHealthIncome = 0;
  let prevHealthIncome = settings.prevDecemberIncome;
  // Składki, сплачені в поточному місяці, тобто нараховані за попередній
  let paid: Contributions = settings.prevDecemberContributions ?? { social: 0, fp: 0, health: 0 };

  for (let m = 1; m <= 12; m++) {
    const { income, vatOutput, vatInput, reverseChargeVat, pitCosts, cashCosts, missingFxRates } =
      months.find((x) => x.month === m) ?? EMPTY_MONTH;

    // VAT з перенесенням надвишки
    const vatCarryIn = carry;
    const vatBalance = vatOutput - vatInput - carry;
    const vatDue = Math.max(0, vatBalance);
    carry = vatBalance < 0 ? -vatBalance : 0;

    // Społeczne і FP за цей місяць; у місяці wakacji składkowych їх платить бюджет
    const zusDue = m === holiday ? { social: 0, fp: 0, total: 0 } : zus;

    // Zdrowotna за цей місяць — від доходу попереднього
    const min = m === 1 ? cfg.healthMinJanuary : cfg.healthMin;
    const fromIncome = prevHealthIncome !== null && prevHealthIncome > 0 ? pct(prevHealthIncome, cfg.healthRate) : 0;
    const health = Math.max(fromIncome, min);
    // До відліку (або в koszty) йде zdrowotna, сплачена в цьому місяці
    const healthDeducted = Math.max(0, Math.min(paid.health, cfg.healthDeductionLimit - cumHealthDed));
    cumHealthDed += healthDeducted;
    const healthInCosts = healthAsCost ? healthDeducted : 0;

    // Дохід місяця після ZUS: відлічуються składki, сплачені в цьому місяці
    const monthlyIncomeAfterZus = income - pitCosts - paid.fp - paid.social - healthInCosts;

    cumIncome += monthlyIncomeAfterZus;

    // Дохід місяця для zdrowotnej: дохід з січня мінус доходи, вже враховані за попередні місяці
    const healthIncome = Math.max(0, cumIncome - cumHealthIncome);
    cumHealthIncome += healthIncome;

    // PIT наростаючим підсумком
    // zdrowotna в kosztach уже зменшила дохід, тож удруге не відлічується
    const pitBase = Math.max(0, roundToZloty(cumIncome - (healthAsCost ? 0 : cumHealthDed)));
    const pitTaxCumulative = roundToZloty(pitBase * cfg.pitRate);
    const pitAdvance = Math.max(0, pitTaxCumulative - cumPit);
    cumPit += pitAdvance;

    const totalToPay = vatDue + zusDue.total + health + pitAdvance;
    const netCash = income - cashCosts - zusDue.total - health - pitAdvance;

    results.push({
      month: m,
      income,
      vatOutput,
      vatInput,
      reverseChargeVat,
      vatCarryIn,
      vatCarryOut: carry,
      vatDue,
      pitCosts,
      cashCosts,
      zusSocial: zusDue.social,
      fp: zusDue.fp,
      zusTotal: zusDue.total,
      zusSocialPaid: paid.social,
      fpPaid: paid.fp,
      monthlyIncomeAfterZus,
      healthIncome,
      healthBase: prevHealthIncome,
      health,
      healthPaid: paid.health,
      healthDeducted,
      healthInCosts,
      cumulativeIncome: cumIncome,
      cumulativeHealthDeducted: cumHealthDed,
      pitBase,
      pitTaxCumulative,
      pitAdvance,
      totalToPay,
      netCash,
      missingFxRates,
    });

    prevHealthIncome = healthIncome;
    paid = { social: zusDue.social, fp: zusDue.fp, health };
  }

  return results;
}

// ---------------------------------------------------------------- NBP

/**
 * Курс NBP (tabela A) з останнього робочого дня ПЕРЕД датою фактури.
 * `table` — мапа 'YYYY-MM-DD' → mid. Повертає null, якщо в межах 10 днів курсу немає
 * або дата некоректна.
 * Мапу для валюти будує fetchNbpRates (nbp.ts).
 */
export function nbpRateFor(invoiceDate: string, table: Record<string, number>): { rate: number; date: string } | null {
  const d = new Date(`${invoiceDate}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  for (let i = 1; i <= 10; i++) {
    const p = new Date(d);
    p.setUTCDate(d.getUTCDate() - i);
    const key = p.toISOString().slice(0, 10);
    if (table[key]) return { rate: table[key], date: key };
  }
  return null;
}

// ---------------------------------------------------------------- deadlines

/** Терміни сплати за місяць M: ZUS, zdrowotna, PIT — 20-те M+1; VAT (JPK_V7M) — 25-те M+1 */
export function dueDates(year: number, month: number) {
  const y = month === 12 ? year + 1 : year;
  const m = month === 12 ? 1 : month + 1;
  const iso = (day: number) => `${y}-${String(m).padStart(2, '0')}-${day}`;
  return { zus: iso(20), health: iso(20), pit: iso(20), vat: iso(25) };
}
