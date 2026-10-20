/**
 * Документи з поданого JPK_V7M (етап 6). Рядок ewidencji стає первинним документом, з якого облік
 * виводить ті самі реєстри VAT і записи KPiR.
 *
 * Чого в JPK немає і звідки це береться:
 * - категорії витрати: з перевизначення для документа (categoryOverrides), інакше з правил
 *   контрагентів (vendorRules, NIP → категорія);
 * - повних сум витрати з частковим відліком: JPK дає K_42 і K_43 у частці відліку (для авто 50%),
 *   повні netto і VAT відновлюються так, щоб дати ті самі K_42, K_43; якщо варіантів кілька і вони
 *   дають різний koszt у KPiR, вибір іде за сумою з KPiR бухгалтера (подсказка kpirAmounts);
 * - ставки VAT закупівлі: визначається за співвідношенням VAT і netto, на суми вона не впливає,
 *   бо VAT береться з файла.
 * Місяць реєстру VAT береться з файла: якщо правила дат дають інший місяць, документ отримує vatDate
 * у місяці файла, а в звіті імпорту з'являється примітка.
 */

import { mulRate } from './money';
import {
  documentDates,
  isOtherEuCountry,
  valueDocument,
  type Contractor,
  type CostDocument,
  type DocumentLine,
  type IncomeDocument,
  type LedgerDocument,
  type Stored,
  type VatRateCode,
} from './document';
import { jpkPeriod, type JpkField, type JpkPurchaseRow, type JpkSalesRow, type JpkV7M } from './jpk';
import { CATEGORY_RULES, type CostCategory } from './tax';

/** Правило контрагента (vendorRules/{ключ}): категорія витрат і спосіб розрахунку продажу */
export interface ContractorRule {
  /** Категорія для фактур закупівлі від цього контрагента */
  category?: CostCategory;
  /** Продаж цьому контрагенту розраховується періодами: дохід PIT — у кінці періоду (art. 14 ust. 1e) */
  periodicSettlement?: boolean;
}

export type ContractorRules = Record<string, ContractorRule>;

/**
 * Категорія окремого документа (categoryOverrides/{id}): id документа з JPK → категорія. Має пріоритет
 * над правилом контрагента, бо один контрагент може продавати різне (пальне й дрібні товари на АЗС).
 */
export type CategoryOverrides = Record<string, CostCategory>;

/** Ключ правила: NIP, а для контрагента без номера — назва */
export const contractorKey = (row: Pick<JpkSalesRow, 'contractorTaxId' | 'contractorName'>) =>
  row.contractorTaxId ?? row.contractorName.trim();

/**
 * Категорія витрати з JPK: перевизначення документа, інакше правило контрагента. Невідоме значення
 * перевизначення (дані з Firestore правилами не перевіряються) не діє.
 */
export function importCategory(
  id: string,
  key: string,
  rules: ContractorRules,
  overrides: CategoryOverrides,
): CostCategory | undefined {
  const override = overrides[id];
  return override && Object.hasOwn(CATEGORY_RULES, override) ? override : rules[key]?.category;
}

export type JpkImportIssueCode =
  /** Для витрати немає ні категорії в правилах контрагентів, ні перевизначення документа */
  | 'category'
  /** Поле, якого облік поки не веде: товари, основні засоби, корекції, import usług тощо */
  | 'unsupportedField'
  /** Особливий документ (RO, WEW, FP, MK, VAT_RR) */
  | 'documentType'
  /** Продаж np без коду країни контрагента: не видно, чи це K_12 */
  | 'country'
  /** Рядок не відновлюється у документ з тими самими сумами */
  | 'amount'
  /** Той самий документ двічі */
  | 'duplicate';

/** Рядок, який не став документом: його треба внести вручну або дописати правило */
export interface JpkImportIssue {
  register: 'sales' | 'purchases';
  lp: number;
  number: string;
  contractorName: string;
  code: JpkImportIssueCode;
  detail?: string;
}

export type JpkImportNoteCode =
  /** Правила дат дають інший місяць VAT, ніж у файлі; документ поставлено в місяць файла */
  | 'vatPeriod'
  /** Повні суми відновлено не однозначно: koszt у KPiR залежить від вибору (choices, вибрано selected) */
  | 'ambiguousAmount'
  /** Сума з KPiR бухгалтера не відповідає жодному варіанту відновлення */
  | 'kpirMismatch';

export interface PitAmountChoice {
  /** Koszt у KPiR для цього варіанта */
  pitAmount: number;
  net: number;
  vat: number;
}

/** Документ створено, але є що перевірити */
export interface JpkImportNote {
  documentId: string;
  number: string;
  code: JpkImportNoteCode;
  /** vatPeriod: дата за правилами */
  ruleDate?: string;
  /** ambiguousAmount, kpirMismatch: варіанти з різним koszt */
  choices?: PitAmountChoice[];
  /** ambiguousAmount, kpirMismatch: koszt варіанта, з яким створено документ */
  selected?: number;
}

export interface JpkImportHints {
  /** Koszt документа в KPiR бухгалтера (гроші) за id документа: вирішує неоднозначне відновлення сум */
  kpirAmounts?: Record<string, number>;
}

export interface JpkImport {
  /** 'YYYY-MM' */
  period: string;
  documents: (LedgerDocument & { id: string })[];
  issues: JpkImportIssue[];
  notes: JpkImportNote[];
  /** Контрагенти витрат без категорії: для кожного треба правило */
  missingRules: { key: string; name: string }[];
}

// ---------------------------------------------------------------- helpers

/** Поля продажу, які дають позицію документа: [основа, VAT, ставка] */
const SALES_LINES: [JpkField, JpkField | null, VatRateCode][] = [
  ['K_19', 'K_20', '23'],
  ['K_17', 'K_18', '8'],
  ['K_15', 'K_16', '5'],
  ['K_13', null, '0'],
  ['K_10', null, 'zw'],
  ['K_11', null, 'np'],
];
/** K_12 — частина K_11 (послуги для платників з ЄС), окремої позиції не дає */
const SALES_SUPPORTED = new Set<string>([...SALES_LINES.flatMap(([b, v]) => (v ? [b, v] : [b])), 'K_12']);
const PURCHASE_SUPPORTED = new Set<string>(['K_42', 'K_43']);

/** Id документа: стабільний, тож повторний імпорт того самого файла перезаписує, а не дублює */
export function jpkDocumentId(kind: 'income' | 'cost', key: string, number: string): string {
  return `jpk-${kind}-${encodeURIComponent(key)}-${encodeURIComponent(number)}`;
}

const lastDay = (year: number, month: number) =>
  `${year}-${String(month).padStart(2, '0')}-${new Date(Date.UTC(year, month, 0)).getUTCDate()}`;

/** Перша з дат, що лежить у періоді, інакше останній день періоду */
function dateInPeriod(period: string, year: number, month: number, ...dates: (string | undefined)[]): string {
  return dates.find((d) => d?.startsWith(`${period}-`)) ?? lastDay(year, month);
}

function contractorOf(row: JpkSalesRow | JpkPurchaseRow): Contractor {
  const contractor: Contractor = { name: row.contractorName, country: row.contractorCountry ?? 'PL' };
  if (row.contractorTaxId) contractor.nip = row.contractorTaxId;
  return contractor;
}

/** Ставка за співвідношенням VAT і netto; без VAT — 0% */
function inferRate(net: number, vat: number): VatRateCode {
  if (vat === 0 || net === 0) return '0';
  const candidates: VatRateCode[] = ['23', '8', '5'];
  const err = (r: VatRateCode) => Math.abs(net * Number(r) - vat * 100);
  return candidates.reduce((best, r) => (err(r) < err(best) ? r : best));
}

/** Усі x, для яких round(x × share) = k. Порожньо, якщо share = 0 */
function preimages(k: number, share: number): number[] {
  if (share <= 0) return [];
  const center = Math.round(k / share);
  const span = Math.ceil(1 / share) + 1;
  const out: number[] = [];
  for (let x = center - span; x <= center + span; x++) if (mulRate(x, share) === k) out.push(x);
  // найближчий до k / share — першим: це типовий вибір
  return out.sort((a, b) => Math.abs(a - k / share) - Math.abs(b - k / share) || b - a);
}

// ---------------------------------------------------------------- rows

type RowIssue = { code: JpkImportIssueCode; detail?: string };

/** Поля, яких облік не веде, і особливий тип документа: такий рядок не стає документом за жодної категорії */
function unsupportedRow(row: JpkSalesRow | JpkPurchaseRow, supported: ReadonlySet<string>): RowIssue | undefined {
  const unsupported = Object.keys(row.fields).filter((f) => !supported.has(f));
  if (unsupported.length > 0) return { code: 'unsupportedField', detail: unsupported.join(', ') };
  if (row.documentType) return { code: 'documentType', detail: row.documentType };
  return undefined;
}

/** Рядок закупівлі може стати документом, якщо дати йому категорію (крім import usług) */
export const importablePurchase = (row: JpkPurchaseRow) => !unsupportedRow(row, PURCHASE_SUPPORTED);

function saleDocument(row: JpkSalesRow, rules: ContractorRules): { doc?: IncomeDocument; issue?: RowIssue } {
  const unsupported = unsupportedRow(row, SALES_SUPPORTED);
  if (unsupported) return { issue: unsupported };

  const lines: DocumentLine[] = [];
  for (const [baseField, vatField, rate] of SALES_LINES) {
    const net = row.fields[baseField];
    const vat = vatField ? row.fields[vatField] : undefined;
    if (net === undefined && vat === undefined) continue;
    lines.push(vatField ? { net: net ?? 0, vatRate: rate, vat: vat ?? 0 } : { net: net ?? 0, vatRate: rate });
  }
  if (lines.length === 0) return { issue: { code: 'amount', detail: 'немає сум' } };

  const contractor = contractorOf(row);
  const np = row.fields.K_11 ?? 0;
  if (np !== 0 && contractor.country === 'PL') return { issue: { code: 'country' } };
  // K_12 має збігтися з тим, що облік виведе з країни контрагента
  if ((row.fields.K_12 ?? 0) !== (isOtherEuCountry(contractor.country) ? np : 0)) {
    return { issue: { code: 'amount', detail: 'K_12' } };
  }

  const rule = rules[contractorKey(row)];
  const doc: IncomeDocument = {
    kind: 'income',
    number: row.number,
    issueDate: row.issueDate,
    contractor,
    currency: 'PLN',
    lines,
    source: 'import',
  };
  if (row.saleDate && row.saleDate !== row.issueDate) doc.saleDate = row.saleDate;
  if (rule?.periodicSettlement && doc.saleDate) doc.periodicSettlement = true;
  if (row.ksefNumber) doc.ksefNumber = row.ksefNumber;
  if (row.marker) doc.marker = row.marker;
  return { doc };
}

function purchaseDocument(
  row: JpkPurchaseRow,
  category: CostCategory,
  hint: number | undefined,
): {
  doc?: CostDocument;
  choices?: PitAmountChoice[];
  selected?: number;
  mismatch?: boolean;
  issue?: RowIssue;
} {
  const unsupported = unsupportedRow(row, PURCHASE_SUPPORTED);
  if (unsupported) return { issue: unsupported };

  const rule = CATEGORY_RULES[category];
  if (rule.reverseCharge) return { issue: { code: 'unsupportedField', detail: 'import usług' } };
  const k42 = row.fields.K_42 ?? 0;
  const k43 = row.fields.K_43 ?? 0;

  const base: Omit<CostDocument, 'lines'> = {
    kind: 'cost',
    category,
    number: row.number,
    issueDate: row.issueDate,
    contractor: contractorOf(row),
    currency: 'PLN',
    source: 'import',
  };
  if (row.receivedDate && row.receivedDate !== row.issueDate) base.receivedDate = row.receivedDate;
  if (row.ksefNumber) base.ksefNumber = row.ksefNumber;
  if (row.marker) base.marker = row.marker;

  const build = (net: number, vat: number): CostDocument => ({
    ...base,
    lines: [{ net, vatRate: inferRate(net, vat), vat }],
  });

  // Варіанти повних сум; від'ємні (корекції) відновлюються за модулем
  const sign = k42 < 0 || k43 < 0 ? -1 : 1;
  const nets = preimages(Math.abs(k42), rule.vatDeductible).map((x) => x * sign);
  const vats = preimages(Math.abs(k43), rule.vatDeductible).map((x) => x * sign);
  if (nets.length === 0 || vats.length === 0) return { issue: { code: 'amount', detail: 'категорія без відліку VAT' } };

  const variants = nets.flatMap((net) => vats.map((vat) => ({ net, vat })));
  const choices: PitAmountChoice[] = [];
  for (const v of variants) {
    const pitAmount = valueDocument(build(v.net, v.vat))!.pitAmount;
    if (!choices.some((c) => c.pitAmount === pitAmount)) choices.push({ pitAmount, ...v });
  }
  if (choices.length === 1) return { doc: build(choices[0].net, choices[0].vat) };

  // Вибір лишається в примітці й тоді, коли його вирішила підказка: його можна змінити при повторному імпорті
  const chosen = hint === undefined ? undefined : choices.find((c) => c.pitAmount === hint);
  const used = chosen ?? choices[0];
  return {
    doc: build(used.net, used.vat),
    choices,
    selected: used.pitAmount,
    mismatch: hint !== undefined && !chosen,
  };
}

// ---------------------------------------------------------------- main

/**
 * Документи з файла JPK_V7M. Рядки, які не стали документами, — в issues; документи, які варто
 * перевірити, — в notes. Повторний виклик з тими самими даними дає ті самі id, тож перевизначення
 * категорії, записане за id, діє й при повторному імпорті.
 */
export function documentsFromJpk(
  jpk: JpkV7M,
  rules: ContractorRules = {},
  hints: JpkImportHints = {},
  overrides: CategoryOverrides = {},
): JpkImport {
  const period = jpkPeriod(jpk);
  const result: JpkImport = { period, documents: [], issues: [], notes: [], missingRules: [] };
  const ids = new Set<string>();

  const place = (doc: IncomeDocument | CostDocument, id: string, row: JpkSalesRow | JpkPurchaseRow) => {
    if (ids.has(id)) return false;
    ids.add(id);
    // місяць реєстру — як у поданому файлі
    const ruleDate = documentDates(doc).vat!;
    if (!ruleDate.startsWith(`${period}-`)) {
      doc.vatDate = dateInPeriod(
        period,
        jpk.year,
        jpk.month,
        doc.kind === 'cost' ? doc.receivedDate : doc.saleDate,
        doc.issueDate,
      );
      result.notes.push({ documentId: id, number: row.number, code: 'vatPeriod', ruleDate });
    }
    result.documents.push({ ...doc, id });
    return true;
  };

  for (const row of jpk.sales) {
    const head = { register: 'sales' as const, lp: row.lp, number: row.number, contractorName: row.contractorName };
    const { doc, issue } = saleDocument(row, rules);
    if (!doc) {
      result.issues.push({ ...head, ...issue! });
      continue;
    }
    const id = jpkDocumentId('income', contractorKey(row), row.number);
    if (!place(doc, id, row)) result.issues.push({ ...head, code: 'duplicate' });
  }

  for (const row of jpk.purchases) {
    const head = { register: 'purchases' as const, lp: row.lp, number: row.number, contractorName: row.contractorName };
    const key = contractorKey(row);
    const id = jpkDocumentId('cost', key, row.number);
    const category = importCategory(id, key, rules, overrides);
    if (!category) {
      result.issues.push({ ...head, code: 'category' });
      if (!result.missingRules.some((m) => m.key === key)) result.missingRules.push({ key, name: row.contractorName });
      continue;
    }
    const built = purchaseDocument(row, category, hints.kpirAmounts?.[id]);
    if (!built.doc) {
      result.issues.push({ ...head, ...built.issue! });
      continue;
    }
    if (!place(built.doc, id, row)) {
      result.issues.push({ ...head, code: 'duplicate' });
      continue;
    }
    if (built.choices) {
      result.notes.push({
        documentId: id,
        number: row.number,
        code: built.mismatch ? 'kpirMismatch' : 'ambiguousAmount',
        choices: built.choices,
        selected: built.selected,
      });
    }
  }

  return result;
}

/**
 * Підказки для повторного імпорту: koszt уже збережених документів з JPK. Так вибір варіанта сум,
 * зроблений раніше, не губиться, коли той самий файл (чи його корекцію) імпортують знову.
 * З правилами (і перевизначеннями) документ, чия категорія при новому імпорті зміниться, підказки не
 * дає: його koszt рахувався за іншою часткою і з варіантами нової категорії не порівнюється.
 */
export function kpirHintsFromDocuments(
  docs: readonly Stored<LedgerDocument>[],
  rules?: ContractorRules,
  overrides: CategoryOverrides = {},
): Record<string, number> {
  const hints: Record<string, number> = {};
  for (const doc of docs) {
    if (doc.kind !== 'cost' || !doc.id?.startsWith('jpk-cost-')) continue;
    if (rules) {
      const key = contractorKey({ contractorTaxId: doc.contractor.nip, contractorName: doc.contractor.name });
      if (importCategory(doc.id, key, rules, overrides) !== doc.category) continue;
    }
    const value = valueDocument(doc);
    if (value) hints[doc.id] = value.pitAmount;
  }
  return hints;
}
