import {
  documentDates,
  documentsFromJpk,
  jpkCtrlIssues,
  parseJpkV7M,
  referenceFromJpk,
  contractorKey,
  type ContractorRules,
  type JpkCtrlIssue,
  type JpkImport,
  type JpkV7M,
  type LedgerDocument,
  type MonthReference,
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

export interface FilePlan {
  name: string;
  result: JpkImport;
  ctrlIssues: JpkCtrlIssue[];
  correction: boolean;
  variant: 2 | 3;
  /** Документи цього періоду з попереднього імпорту, яких у файлі вже немає: видаляються */
  stale: string[];
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

export function buildImportPlan(
  parsed: readonly ParsedFile[],
  rules: ContractorRules,
  hints: Record<string, number>,
  existing: readonly (LedgerDocument & { id: string })[],
): ImportPlan {
  const ok = parsed.filter((f) => f.ok);
  const files = ok.map((f): FilePlan => {
    const result = documentsFromJpk(f.jpk, rules, { kpirAmounts: hints });
    return {
      name: f.name,
      result,
      ctrlIssues: f.ctrlIssues,
      correction: f.jpk.correction,
      variant: f.jpk.variant,
      stale: staleImported(existing, result.period, new Set(result.documents.map((d) => d.id))),
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
