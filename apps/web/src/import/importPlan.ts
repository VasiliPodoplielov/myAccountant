import {
  closedPeriodsAffected,
  documentDates,
  documentsFromJpk,
  importablePurchase,
  importCategory,
  jpkCtrlIssues,
  jpkDocumentId,
  parseJpkV7M,
  referenceFromJpk,
  contractorKey,
  type CategoryOverrides,
  type ContractorRules,
  type CostCategory,
  type JpkCtrlIssue,
  type JpkImport,
  type JpkV7M,
  type LedgerDocument,
  type MonthReference,
  type PeriodRecord,
} from '@jdg/core';

/** Вибраний файл після розбору: JPK або помилка, з якою його не можна імпортувати */
export type ParsedFile =
  { name: string; ok: true; jpk: JpkV7M; ctrlIssues: JpkCtrlIssue[] } | { name: string; ok: false; error: string };

export function parseFile(name: string, xml: string): ParsedFile {
  try {
    const jpk = parseJpkV7M(xml);
    return { name, ok: true, jpk, ctrlIssues: jpkCtrlIssues(jpk) };
  } catch (e) {
    return { name, ok: false, error: (e as Error).message };
  }
}

/** Рядок закупівлі з файла: для нього можна вибрати категорію окремо від правила контрагента */
export interface PurchaseRowPlan {
  /** Id документа, який дасть рядок; за ним записується перевизначення */
  id: string;
  /** Ключ правила контрагента */
  key: string;
  number: string;
  contractorName: string;
  /** Суми з JPK (K_42, K_43): при частковому відліку це частка, а не повні суми */
  net: number;
  vat: number;
  /** Категорія за правилом контрагента */
  ruleCategory?: CostCategory;
  /** Категорія, вибрана для цього документа */
  override?: CostCategory;
}

export interface FilePlan {
  name: string;
  result: JpkImport;
  ctrlIssues: JpkCtrlIssue[];
  correction: boolean;
  variant: 2 | 3;
  /** Документи цього періоду з попереднього імпорту, яких у файлі вже немає: видаляються */
  stale: string[];
  purchases: PurchaseRowPlan[];
}

export interface ImportPlan {
  files: FilePlan[];
  /** Періоди, за які вибрано кілька файлів: незрозуміло, який з них подано останнім */
  duplicatePeriods: string[];
  /** Контрагенти витрат без категорії, з усіх файлів */
  missingRules: { key: string; name: string }[];
  /** Контрагенти продажу: для них можна позначити розрахункові періоди */
  salesContractors: { key: string; name: string }[];
  /** Контрагенти закупівлі: кожному потрібна категорія */
  purchaseContractors: { key: string; name: string }[];
  documents: (LedgerDocument & { id: string })[];
  /** Частина еталона з JPK за кожен період */
  references: Record<string, Pick<MonthReference, 'vat' | 'sales' | 'purchases'>>;
  stale: string[];
  /** Можна записувати: є що, немає дублів і контрагентів без категорії */
  ready: boolean;
}

/**
 * Документи з JPK, що вже лежать в обліку, за період: усі з id `jpk-…`, чий місяць VAT — цей період.
 * Ті з них, яких у новому файлі немає (корекція прибрала рядок), видаляються при імпорті.
 */
export function staleImported(
  existing: readonly (LedgerDocument & { id: string })[],
  period: string,
  keep: ReadonlySet<string>,
): string[] {
  return existing
    .filter((d) => d.id.startsWith('jpk-') && d.kind !== 'internal' && !keep.has(d.id))
    .filter((d) => documentDates(d).vat?.startsWith(`${period}-`))
    .map((d) => d.id);
}

/**
 * Рядки закупівлі, яким можна вибрати категорію: без полів, яких облік не веде, і без особливих
 * документів; той самий документ двічі — один рядок.
 */
function purchaseRows(jpk: JpkV7M, rules: ContractorRules, overrides: CategoryOverrides): PurchaseRowPlan[] {
  const rows = new Map<string, PurchaseRowPlan>();
  for (const row of jpk.purchases.filter(importablePurchase)) {
    const key = contractorKey(row);
    const id = jpkDocumentId('cost', key, row.number);
    if (rows.has(id)) continue;
    const plan: PurchaseRowPlan = {
      id,
      key,
      number: row.number,
      contractorName: row.contractorName,
      net: row.fields.K_42 ?? 0,
      vat: row.fields.K_43 ?? 0,
    };
    if (rules[key]?.category) plan.ruleCategory = rules[key].category;
    const override = importCategory(id, key, {}, overrides);
    if (override) plan.override = override;
    rows.set(id, plan);
  }
  return [...rows.values()];
}

/**
 * Закриті місяці, які імпорт змінив би: нові чи змінені документи й видалення (корекція), що їх торкаються.
 * Firestore такий пакет відхилить цілком; документи без змін (повторний імпорт того самого файла) проходять.
 */
export function importClosedPeriods(
  plan: Pick<ImportPlan, 'documents' | 'stale'>,
  existing: readonly (LedgerDocument & { id: string })[],
  periods: Readonly<Record<string, PeriodRecord>>,
): string[] {
  const byId = new Map(existing.map((d) => [d.id, d]));
  const touched = [
    ...plan.documents.flatMap((d) => closedPeriodsAffected(d, byId.get(d.id), periods)),
    ...plan.stale.flatMap((id) => closedPeriodsAffected(null, byId.get(id), periods)),
  ];
  return [...new Set(touched)].sort();
}

export function buildImportPlan(
  parsed: readonly ParsedFile[],
  rules: ContractorRules,
  hints: Record<string, number>,
  existing: readonly (LedgerDocument & { id: string })[],
  overrides: CategoryOverrides = {},
): ImportPlan {
  const ok = parsed.filter((f) => f.ok);
  const files = ok.map((f): FilePlan => {
    const result = documentsFromJpk(f.jpk, rules, { kpirAmounts: hints }, overrides);
    return {
      name: f.name,
      result,
      ctrlIssues: f.ctrlIssues,
      correction: f.jpk.correction,
      variant: f.jpk.variant,
      stale: staleImported(existing, result.period, new Set(result.documents.map((d) => d.id))),
      purchases: purchaseRows(f.jpk, rules, overrides),
    };
  });

  const counts = new Map<string, number>();
  for (const f of files) counts.set(f.result.period, (counts.get(f.result.period) ?? 0) + 1);
  const duplicatePeriods = [...counts].filter(([, n]) => n > 1).map(([p]) => p);

  const unique = <T extends { key: string }>(items: T[]) => [...new Map(items.map((i) => [i.key, i])).values()];
  const missingRules = unique(files.flatMap((f) => f.result.missingRules));
  const contractors = (rows: (f: (typeof ok)[number]) => JpkV7M['sales'] | JpkV7M['purchases']) =>
    unique(ok.flatMap((f) => rows(f).map((r) => ({ key: contractorKey(r), name: r.contractorName }))));

  return {
    files,
    duplicatePeriods,
    missingRules,
    salesContractors: contractors((f) => f.jpk.sales),
    purchaseContractors: contractors((f) => f.jpk.purchases),
    documents: files.flatMap((f) => f.result.documents),
    references: Object.fromEntries(
      ok.map((f) => [`${f.jpk.year}-${String(f.jpk.month).padStart(2, '0')}`, referenceFromJpk(f.jpk)]),
    ),
    stale: files.flatMap((f) => f.stale),
    ready: files.length > 0 && duplicatePeriods.length === 0 && missingRules.length === 0,
  };
}
