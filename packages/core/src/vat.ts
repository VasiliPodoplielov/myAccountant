/**
 * Реєстри VAT продажу й закупівлі з документів. Суми рядка розкладені по полях ewidencji
 * JPK_V7M(3) (broszura MF «JPK_VAT z deklaracją», січень 2026), щоб підсумки можна було
 * порівняти з файлом бухгалтера. Товарних операцій і основних засобів (K_40, K_41) тут немає.
 */

import { mulRate, toFullZloty } from './money';
import {
  VAT_PERCENT,
  isOtherEuCountry,
  valueDocument,
  type Contractor,
  type KsefMarker,
  type LedgerDocument,
  type LedgerOptions,
  type Stored,
  type VatRateCode,
} from './document';
import { CATEGORY_RULES } from './tax';

export type SalesVatField =
  | 'K_10' // zwolnione
  | 'K_11' // poza terytorium kraju
  | 'K_12' // у тому числі послуги для платників з ЄС (art. 100 ust. 1 pkt 4)
  | 'K_13' // 0%
  | 'K_15' // 5%: основа, K_16 — VAT
  | 'K_16'
  | 'K_17' // 8%: основа, K_18 — VAT
  | 'K_18'
  | 'K_19' // 23%: основа, K_20 — VAT
  | 'K_20'
  | 'K_27' // import usług з-поза ЄС: основа, K_28 — VAT
  | 'K_28'
  | 'K_29' // import usług від платників VAT з ЄС (art. 28b): основа, K_30 — VAT
  | 'K_30';

export type PurchaseVatField =
  | 'K_42' // nabycie pozostałych towarów i usług: netto
  | 'K_43'; // VAT до відліку

interface VatRowBase {
  /** Дата, за якою рядок потрапив у місяць реєстру */
  date: string;
  docNumber: string;
  issueDate: string;
  contractor: Contractor;
  ksefNumber?: string;
  marker?: KsefMarker;
  documentId?: string;
}

export interface VatSalesRow extends VatRowBase {
  saleDate?: string;
  fields: Partial<Record<SalesVatField, number>>;
}

export interface VatPurchaseRow extends VatRowBase {
  receivedDate?: string;
  fields: Partial<Record<PurchaseVatField, number>>;
}

export interface VatRegisters {
  sales: VatSalesRow[];
  purchases: VatPurchaseRow[];
}

/** Поля продажу за ставкою: [основа, VAT] */
const SALES_FIELDS: Partial<Record<VatRateCode, [SalesVatField, SalesVatField?]>> = {
  '23': ['K_19', 'K_20'],
  '8': ['K_17', 'K_18'],
  '5': ['K_15', 'K_16'],
  '0': ['K_13'],
  zw: ['K_10'],
};

/** Поля VAT należnego: у декларації кожне округлюється до злотих окремо */
const OUTPUT_VAT_FIELDS: SalesVatField[] = ['K_16', 'K_18', 'K_20', 'K_28', 'K_30'];

const add = <F extends string>(fields: Partial<Record<F, number>>, field: F, amount: number) => {
  fields[field] = (fields[field] ?? 0) + amount;
};

/** Реєстри за місяць (1..12): документ потрапляє в них за датою VAT, а не PIT */
export function vatRegisters(
  docs: readonly Stored<LedgerDocument>[],
  year: number,
  month: number,
  opts: LedgerOptions = {},
): VatRegisters {
  return vatRegistersByMonth(docs, year, opts)[month - 1];
}

/**
 * Реєстри року за один прохід по документах: [0] — січень, [11] — грудень.
 * Валютний документ без курсу пропускається. Import usług дає рядок і в продажу (VAT należny),
 * і в закупівлі (той самий VAT до відліку).
 */
export function vatRegistersByMonth(
  docs: readonly Stored<LedgerDocument>[],
  year: number,
  opts: LedgerOptions = {},
): VatRegisters[] {
  const months: VatRegisters[] = Array.from({ length: 12 }, () => ({ sales: [], purchases: [] }));

  for (const doc of docs) {
    if (doc.kind === 'internal') continue;
    const value = valueDocument(doc, opts.fx);
    if (!value || !value.dates.vat!.startsWith(`${year}-`)) continue;
    const { sales, purchases } = months[Number(value.dates.vat!.slice(5, 7)) - 1];

    const head = {
      date: value.dates.vat!,
      docNumber: doc.number,
      issueDate: doc.issueDate,
      contractor: doc.contractor,
      ksefNumber: doc.ksefNumber,
      marker: doc.marker,
      documentId: doc.id,
    };
    const salesFields: VatSalesRow['fields'] = {};
    const purchaseFields: VatPurchaseRow['fields'] = {};

    if (doc.kind === 'income') {
      for (const g of value.groups) {
        if (g.rate === 'np') {
          // nie podlega при польському контрагенті — операція поза VAT, у реєстр не йде
          if (doc.contractor.country === 'PL') continue;
          add(salesFields, 'K_11', g.base);
          if (isOtherEuCountry(doc.contractor.country)) add(salesFields, 'K_12', g.base);
          continue;
        }
        const [baseField, vatField] = SALES_FIELDS[g.rate]!;
        add(salesFields, baseField, g.base);
        if (vatField) add(salesFields, vatField, g.vat);
      }
    } else {
      const rule = CATEGORY_RULES[doc.category];
      if (rule.reverseCharge) {
        // позиції np — послуги з місцем надання поза Польщею: це не import usług
        const taxable = value.groups.filter((g) => g.rate !== 'np');
        if (taxable.length > 0) {
          const [baseField, vatField] = isOtherEuCountry(doc.contractor.country)
            ? (['K_29', 'K_30'] as const)
            : (['K_27', 'K_28'] as const);
          add(
            salesFields,
            baseField,
            taxable.reduce((a, g) => a + g.base, 0),
          );
          add(salesFields, vatField, value.vat);
        }
      }
      // у реєстрі закупівлі лише те, з чого є VAT до відліку
      const deductible = value.groups.filter((g) => VAT_PERCENT[g.rate]);
      if (rule.vatDeductible > 0 && deductible.length > 0) {
        const net = deductible.reduce((a, g) => a + g.base, 0);
        add(purchaseFields, 'K_42', opts.partialNet === 'full' ? net : mulRate(net, rule.vatDeductible));
        add(purchaseFields, 'K_43', value.vatDeductible);
      }
    }

    if (Object.keys(salesFields).length > 0) sales.push({ ...head, saleDate: doc.saleDate, fields: salesFields });
    if (Object.keys(purchaseFields).length > 0) {
      purchases.push({
        ...head,
        receivedDate: doc.kind === 'cost' ? doc.receivedDate : undefined,
        fields: purchaseFields,
      });
    }
  }

  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const byDate = (a: VatRowBase, b: VatRowBase) => cmp(a.date, b.date) || cmp(a.docNumber, b.docNumber);
  for (const m of months) {
    m.sales.sort(byDate);
    m.purchases.sort(byDate);
  }
  return months;
}

/** Підсумок реєстру по полях, гроші */
export function vatTotals<F extends string>(
  rows: readonly { fields: Partial<Record<F, number>> }[],
): Partial<Record<F, number>> {
  const totals: Partial<Record<F, number>> = {};
  for (const row of rows) {
    for (const field of Object.keys(row.fields) as F[]) add(totals, field, row.fields[field]!);
  }
  return totals;
}

/**
 * Суми для декларації. Кожна позиція VAT округлюється до повних злотих окремо
 * (art. 63 § 1 Ordynacji podatkowej), тому output і input — суми вже округлених позицій.
 */
export function vatDeclaration(registers: VatRegisters): { output: number; input: number; reverseCharge: number } {
  const sales = vatTotals(registers.sales);
  const purchases = vatTotals(registers.purchases);
  return {
    output: OUTPUT_VAT_FIELDS.reduce((a, f) => a + toFullZloty(sales[f] ?? 0), 0),
    input: toFullZloty(purchases.K_43 ?? 0),
    reverseCharge: (sales.K_28 ?? 0) + (sales.K_30 ?? 0),
  };
}
