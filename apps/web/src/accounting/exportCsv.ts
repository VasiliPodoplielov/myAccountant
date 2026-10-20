import type { MonthReport, MonthResult } from '@jdg/core';
import { groszeToCsv } from '../csv';
import { metricLabel } from '../reconciliation/referenceForm';
import { kpirCosts, type MonthDocumentRow } from './accountingView';

/** Вивантаження для звірки поза додатком: усі показники розрахунку року, гроші в злотих */

const YEAR_COLUMNS: [string, (r: MonthResult) => string | number][] = [
  ['month', (r) => r.month],
  ['income', (r) => groszeToCsv(r.income)],
  ['pit_costs_documents', (r) => groszeToCsv(r.pitCosts)],
  ['fp_paid', (r) => groszeToCsv(r.fpPaid)],
  ['health_in_costs', (r) => groszeToCsv(r.healthInCosts)],
  ['kpir_costs', (r) => groszeToCsv(kpirCosts(r))],
  ['vat_output', (r) => groszeToCsv(r.vatOutput)],
  ['vat_input', (r) => groszeToCsv(r.vatInput)],
  ['vat_carry_in', (r) => groszeToCsv(r.vatCarryIn)],
  ['vat_due', (r) => groszeToCsv(r.vatDue)],
  ['vat_carry_out', (r) => groszeToCsv(r.vatCarryOut)],
  ['zus_social', (r) => groszeToCsv(r.zusSocial)],
  ['zus_fp', (r) => groszeToCsv(r.fp)],
  ['zus_total', (r) => groszeToCsv(r.zusTotal)],
  ['health', (r) => groszeToCsv(r.health)],
  ['social_paid', (r) => groszeToCsv(r.zusSocialPaid)],
  ['health_paid', (r) => groszeToCsv(r.healthPaid)],
  ['income_after_zus', (r) => groszeToCsv(r.monthlyIncomeAfterZus)],
  ['cumulative_income', (r) => groszeToCsv(r.cumulativeIncome)],
  ['pit_base', (r) => groszeToCsv(r.pitBase)],
  ['pit_advance', (r) => groszeToCsv(r.pitAdvance)],
  ['total_to_pay', (r) => groszeToCsv(r.totalToPay)],
  ['cash_costs', (r) => groszeToCsv(r.cashCosts)],
  ['net_cash', (r) => groszeToCsv(r.netCash)],
  ['missing_fx_rates', (r) => r.missingFxRates],
];

export const YEAR_CSV_HEADER = YEAR_COLUMNS.map(([name]) => name);

export const yearCsvRows = (results: readonly MonthResult[]) =>
  results.map((r) => YEAR_COLUMNS.map(([, value]) => value(r)));

export const MONTH_DOCS_CSV_HEADER = [
  'pit_date',
  'vat_date',
  'kind',
  'number',
  'contractor',
  'pit_amount',
  'vat',
  'in_kpir',
  'in_vat',
  'missing_fx',
];

export const monthDocumentsCsvRows = (rows: readonly MonthDocumentRow[]) =>
  rows.map((d) => [
    d.pitDate,
    d.vatDate ?? '',
    d.kind,
    d.number,
    d.contractor || d.description || '',
    d.pitAmount === null ? '' : groszeToCsv(d.pitAmount),
    d.vat === null ? '' : groszeToCsv(d.vat),
    d.inKpir ? 1 : 0,
    d.inVat ? 1 : 0,
    d.missingFx ? 1 : 0,
  ]);

export const RECONCILIATION_CSV_HEADER = [
  'period',
  'has_reference',
  'metric',
  'label',
  'app',
  'reference',
  'diff',
  'note',
];

/** Звірка року: по рядку на показник; місяць без еталона — один рядок із has_reference = 0 */
export function reconciliationCsvRows(months: readonly MonthReport[]): (string | number)[][] {
  return months.flatMap((m) =>
    m.rows.length === 0
      ? [[m.period, m.hasReference ? 1 : 0, '', '', '', '', '', '']]
      : m.rows.map((r) => [
          m.period,
          1,
          r.metric,
          metricLabel(r.metric),
          groszeToCsv(r.app),
          groszeToCsv(r.reference),
          groszeToCsv(r.diff),
          r.note ?? '',
        ]),
  );
}
