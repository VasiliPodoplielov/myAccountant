import { documentDates, type KpirEntry, type MonthReport, type MonthResult, type StoredDocument } from '@jdg/core';
import { groszeToCsv } from '../csv';
import { metricLabel } from '../reconciliation/referenceForm';
import { kpirCosts, type MonthDocumentRow } from './accountingView';
import { kpirTaxId } from './booksView';

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

export const KPIR_CSV_HEADER = [
  'lp',
  'date',
  'ksef_number',
  'doc_number',
  'contractor_tax_id',
  'contractor_name',
  'description',
  'col9',
  'col10',
  'col11',
  'col12',
  'col13',
  'col14',
  'col15',
  'col16',
];

/** Записи книги з колонками 9–16 (кол. 11 = 9+10, кол. 16 = 14+15); адреса й вільні колонки не вивантажуються */
export const kpirCsvRows = (entries: readonly KpirEntry[]) =>
  entries.map((e) => [
    e.lp,
    e.date,
    e.ksefNumber ?? '',
    e.docNumber,
    kpirTaxId(e),
    e.contractorName ?? '',
    e.description,
    groszeToCsv(e.col9),
    groszeToCsv(e.col10),
    groszeToCsv(e.col9 + e.col10),
    groszeToCsv(e.col12),
    groszeToCsv(e.col13),
    groszeToCsv(e.col14),
    groszeToCsv(e.col15),
    groszeToCsv(e.col14 + e.col15),
  ]);

/** Реєстр VAT: загальні колонки та поля ewidencji, що є в рядках; рядок «разом» додається в кінці */
export function vatRegisterCsv<F extends string>(
  rows: readonly {
    date: string;
    docNumber: string;
    contractor: { name: string; nip?: string };
    ksefNumber?: string;
    marker?: string;
    fields: Partial<Record<F, number>>;
  }[],
  fields: readonly F[],
  totals: Partial<Record<F, number>>,
): { header: string[]; rows: (string | number)[][] } {
  return {
    header: ['date', 'doc_number', 'contractor_nip', 'contractor_name', 'ksef_or_marker', ...fields],
    rows: [
      ...rows.map((r) => [
        r.date,
        r.docNumber,
        r.contractor.nip ?? '',
        r.contractor.name,
        r.ksefNumber ?? r.marker ?? '',
        ...fields.map((f) => (r.fields[f] === undefined ? '' : groszeToCsv(r.fields[f]))),
      ]),
      ['', 'TOTAL', '', '', '', ...fields.map((f) => groszeToCsv(totals[f] ?? 0))],
    ],
  };
}

export const DOCUMENTS_CSV_HEADER = [
  'id',
  'kind',
  'number',
  'issue_date',
  'pit_date',
  'vat_date',
  'contractor',
  'contractor_nip',
  'country',
  'currency',
  'net',
  'vat',
  'category',
  'source',
];

/**
 * Документи для бекапу в CSV: по рядку на документ, суми в валюті документа (net і VAT — сума позицій,
 * для внутрішнього документа net — його сума). Дати PIT і VAT — ті, за якими документ потрапляє в книги.
 */
export function documentsCsvRows(docs: readonly StoredDocument[]): (string | number)[][] {
  return [...docs]
    .sort((a, b) => a.issueDate.localeCompare(b.issueDate) || a.number.localeCompare(b.number))
    .map((d) => {
      const dates = documentDates(d);
      if (d.kind === 'internal') {
        return [
          d.id,
          d.kind,
          d.number,
          d.issueDate,
          dates.pit,
          '',
          d.description ?? '',
          '',
          '',
          'PLN',
          groszeToCsv(d.amount),
          '',
          '',
          d.source,
        ];
      }
      const hasVat = d.lines.some((l) => l.vat !== undefined);
      return [
        d.id,
        d.kind,
        d.number,
        d.issueDate,
        dates.pit,
        dates.vat ?? '',
        d.contractor.name,
        d.contractor.nip ?? '',
        d.contractor.country,
        d.currency,
        groszeToCsv(d.lines.reduce((sum, l) => sum + l.net, 0)),
        hasVat ? groszeToCsv(d.lines.reduce((sum, l) => sum + (l.vat ?? 0), 0)) : '',
        d.kind === 'cost' ? d.category : '',
        d.source,
      ];
    });
}
