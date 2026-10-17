/**
 * Місячні суми для розрахунку року з первинних документів: PIT — за датою події для PIT
 * (записи KPiR), VAT — за датою VAT (реєстри). Правила розрахунку року не змінюються:
 * calcYearFromSums той самий, що й для сум за категоріями.
 */

import { documentDates, valueDocument, type LedgerDocument, type LedgerOptions, type Stored } from './document';
import { kpirFromDocuments, kpirTotals } from './kpir';
import { calcYearFromSums, type MonthResult, type MonthSums, type TaxYearConfig, type YearSettings } from './tax';
import { vatDeclaration, vatRegistersByMonth } from './vat';

const monthOf = (date: string, year: number) => (date.startsWith(`${year}-`) ? Number(date.slice(5, 7)) : null);

/**
 * Суми року по місяцях. Округлення вже зроблене по документу; VAT округлено до злотих, як у декларації.
 * FP у koszty не входить: його додає розрахунок року. Внутрішні документи на грошові витрати не впливають.
 */
export function documentMonthSums(
  docs: readonly Stored<LedgerDocument>[],
  year: number,
  opts: LedgerOptions = {},
): MonthSums[] {
  const drafts = kpirFromDocuments(docs, year, opts);
  const registers = vatRegistersByMonth(docs, year, opts);
  const cashCosts = new Array<number>(13).fill(0);
  const missingFxRates = new Array<number>(13).fill(0);

  for (const doc of docs) {
    if (doc.kind === 'internal') continue;
    const value = valueDocument(doc, opts.fx);
    const month = monthOf(documentDates(doc).pit, year);
    if (month === null) continue;
    if (!value) missingFxRates[month]++;
    else if (doc.kind === 'cost') cashCosts[month] += value.netPit + value.vatNonDeductible;
  }
  // від'ємна курсова різниця — теж реальні гроші; додатна вже сидить у доході
  for (const d of drafts) {
    if (d.origin === 'fxDifference') cashCosts[monthOf(d.date, year)!] += d.col15;
  }

  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const kpir = kpirTotals(drafts, month);
    const vat = vatDeclaration(registers[i]);
    return {
      month,
      income: kpir.col11,
      vatOutput: vat.output,
      vatInput: vat.input,
      reverseChargeVat: vat.reverseCharge,
      pitCosts: kpir.col12 + kpir.col13 + kpir.col16,
      cashCosts: cashCosts[month],
      missingFxRates: missingFxRates[month],
    };
  });
}

/** Розрахунок року з документів: ті самі правила, що в calcYear, але вхідні суми — з документів */
export function calcYearFromDocuments(
  docs: readonly Stored<LedgerDocument>[],
  settings: YearSettings,
  cfg: TaxYearConfig,
  opts: LedgerOptions = {},
): MonthResult[] {
  return calcYearFromSums(documentMonthSums(docs, cfg.year, opts), settings, cfg);
}
