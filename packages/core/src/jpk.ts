/**
 * Розбір поданого файла JPK_V7M: заголовок, деклараційна частина й ewidencja продажу та закупівлі.
 * Підтримані варіанти (2) — до січня 2026 включно — і (3) — з лютого 2026 (broszura MF «JPK_VAT
 * z deklaracją»). Варіант (3) додає до рядків номер KSeF і позначки OFF, BFK, DI.
 *
 * Суми рядків — гроші, позиції декларації — повні злоті, переведені в гроші. Текст рахується точно, без float.
 */

import { XMLParser } from 'fast-xml-parser';
import { isIsoDate } from './dates';
import type { KsefMarker } from './document';

/** Поле ewidencji: K_10…K_36 у продажу, K_40…K_47 у закупівлі */
export type JpkField = `K_${number}`;

/** Позиція декларації: P_10…P_62, а також P_68, P_69 (ulga na złe długi) */
export type JpkDeclarationField = `P_${number}`;

interface JpkRowBase {
  /** LpSprzedazy / LpZakupu */
  lp: number;
  /** NrKontrahenta / NrDostawcy; без номера («brak») — undefined */
  contractorTaxId?: string;
  /** KodKrajuNadaniaTIN; у файлі його немає для польських контрагентів */
  contractorCountry?: string;
  contractorName: string;
  /** DowodSprzedazy / DowodZakupu */
  number: string;
  ksefNumber?: string;
  marker?: KsefMarker;
  /** TypDokumentu (RO, WEW, FP) у продажу або DokumentZakupu (MK, VAT_RR, WEW) у закупівлі */
  documentType?: string;
  fields: Partial<Record<JpkField, number>>;
}

export interface JpkSalesRow extends JpkRowBase {
  /** DataWystawienia */
  issueDate: string;
  /** DataSprzedazy, якщо відрізняється від дати виставлення */
  saleDate?: string;
}

export interface JpkPurchaseRow extends JpkRowBase {
  /** DataZakupu: дата виставлення документа закупівлі */
  issueDate: string;
  /** DataWplywu, якщо відрізняється від дати виставлення */
  receivedDate?: string;
}

export interface JpkV7M {
  variant: 2 | 3;
  year: number;
  month: number;
  /** CelZlozenia 2 — korekta */
  correction: boolean;
  declaration: Partial<Record<JpkDeclarationField, number>>;
  sales: JpkSalesRow[];
  purchases: JpkPurchaseRow[];
  /** SprzedazCtrl і ZakupCtrl так, як їх записано у файлі */
  ctrl: { salesRows: number; outputVat: number; purchaseRows: number; inputVat: number };
}

/** Розбіжність між контрольними сумами файла й рядками: файл прочитано, але він сам собі суперечить */
export type JpkCtrlIssue = 'salesRows' | 'outputVat' | 'purchaseRows' | 'inputVat';

export class JpkParseError extends Error {
  override name = 'JpkParseError';
}

// ---------------------------------------------------------------- values

/** «18560.00», «-0.5», «12» → гроші. Більше двох знаків після коми чи не число — помилка */
export function parseJpkAmount(text: string): number {
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!m) throw new JpkParseError(`Не сума: «${text}»`);
  const grosze = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(grosze)) throw new JpkParseError(`Сума поза межами: «${text}»`);
  return m[1] && grosze !== 0 ? -grosze : grosze;
}

const AMOUNT_FIELD = /^K_\d+$/;
/** Позиції декларації, що є сумами; решта P_ — позначки (P_540, P_68 тощо) або текст */
const DECLARATION_AMOUNT = (n: number) => (n >= 10 && n <= 62) || n === 68 || n === 69;

/** Поля VAT należnego в SprzedazCtrl.PodatekNalezny; K_35, K_36 віднімаються */
const OUTPUT_VAT_PLUS = ['K_16', 'K_18', 'K_20', 'K_24', 'K_26', 'K_28', 'K_30', 'K_32', 'K_33', 'K_34'] as const;
const OUTPUT_VAT_MINUS = ['K_35', 'K_36'] as const;
/** Поля VAT naliczonego в ZakupCtrl.PodatekNaliczony */
const INPUT_VAT = ['K_41', 'K_43', 'K_44', 'K_45', 'K_46', 'K_47'] as const;

// ---------------------------------------------------------------- xml

type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  // усе як текст: суми й номери ми розбираємо самі
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => name === 'SprzedazWiersz' || name === 'ZakupWiersz',
});

function text(node: XmlNode, key: string): string | undefined {
  const v = node[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string') return v;
  // елемент з атрибутами: { '#text': ..., '@attr': ... }
  if (typeof v === 'object' && '#text' in v) return String((v as XmlNode)['#text']);
  return String(v);
}

function required(node: XmlNode, key: string, where: string): string {
  const v = text(node, key);
  if (v === undefined || v === '') throw new JpkParseError(`${where}: немає ${key}`);
  return v;
}

function date(node: XmlNode, key: string, where: string): string {
  const v = required(node, key, where);
  if (!isIsoDate(v)) throw new JpkParseError(`${where}: ${key} не дата: «${v}»`);
  return v;
}

function optionalDate(node: XmlNode, key: string, where: string): string | undefined {
  return text(node, key) === undefined ? undefined : date(node, key, where);
}

function child(node: XmlNode, key: string, where: string): XmlNode {
  const v = node[key];
  if (!v || typeof v !== 'object') throw new JpkParseError(`${where}: немає ${key}`);
  return v as XmlNode;
}

interface RowKeys {
  lp: string;
  taxId: string;
  name: string;
  number: string;
  type: string;
}

const SALES_KEYS: RowKeys = {
  lp: 'LpSprzedazy',
  taxId: 'NrKontrahenta',
  name: 'NazwaKontrahenta',
  number: 'DowodSprzedazy',
  type: 'TypDokumentu',
};
const PURCHASE_KEYS: RowKeys = {
  lp: 'LpZakupu',
  taxId: 'NrDostawcy',
  name: 'NazwaDostawcy',
  number: 'DowodZakupu',
  type: 'DokumentZakupu',
};

function rowBase(row: XmlNode, where: string, keys: RowKeys) {
  const fields: Partial<Record<JpkField, number>> = {};
  for (const key of Object.keys(row)) {
    if (AMOUNT_FIELD.test(key)) fields[key as JpkField] = parseJpkAmount(required(row, key, where));
  }
  const taxId = text(row, keys.taxId)?.trim();
  const markers = (['OFF', 'BFK', 'DI'] as const).filter((m) => text(row, m) === '1');
  if (markers.length > 1) throw new JpkParseError(`${where}: кілька позначок ${markers.join(', ')}`);
  const lp = Number(required(row, keys.lp, where));
  if (!Number.isSafeInteger(lp) || lp < 1) throw new JpkParseError(`${where}: некоректний Lp`);

  return {
    lp,
    contractorTaxId: !taxId || taxId.toLowerCase() === 'brak' ? undefined : taxId.replace(/\s+/g, ''),
    contractorCountry: text(row, 'KodKrajuNadaniaTIN'),
    contractorName: required(row, keys.name, where),
    number: required(row, keys.number, where),
    ksefNumber: text(row, 'NrKSeF'),
    marker: markers[0],
    documentType: text(row, keys.type),
    fields,
  };
}

/** Відкидає undefined-поля, щоб рядок можна було порівнювати й зберігати як є */
function compact<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/**
 * Розбирає XML JPK_V7M. Структурні помилки (не той формуляр, немає обов'язкового поля, сума чи дата
 * в неправильному форматі) дають JpkParseError; контрольні суми перевіряє jpkCtrlIssues.
 */
export function parseJpkV7M(xml: string): JpkV7M {
  let doc: XmlNode;
  try {
    doc = parser.parse(xml, true) as XmlNode;
  } catch (e) {
    throw new JpkParseError(`Не XML: ${(e as Error).message}`);
  }
  const jpk = child(doc, 'JPK', 'Файл');
  const header = child(jpk, 'Naglowek', 'JPK');
  const form = header['KodFormularza'] as XmlNode | undefined;
  const code = form && typeof form === 'object' ? String(form['@kodSystemowy'] ?? '') : '';
  const match = /^JPK_V7M \(([23])\)$/.exec(code);
  if (!match)
    throw new JpkParseError(`Непідтримуваний формуляр: «${code || 'невідомий'}». Потрібен JPK_V7M (2) або (3)`);

  const year = Number(required(header, 'Rok', 'Naglowek'));
  const month = Number(required(header, 'Miesiac', 'Naglowek'));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new JpkParseError('Naglowek: некоректний період');
  }

  const declaration: Partial<Record<JpkDeclarationField, number>> = {};
  const positions = (jpk['Deklaracja'] as XmlNode | undefined)?.['PozycjeSzczegolowe'] as XmlNode | undefined;
  for (const [key, value] of Object.entries(positions ?? {})) {
    const n = /^P_(\d+)$/.exec(key);
    if (n && DECLARATION_AMOUNT(Number(n[1]))) {
      declaration[key as JpkDeclarationField] = parseJpkAmount(String(value));
    }
  }

  const ewidencja = (jpk['Ewidencja'] ?? {}) as XmlNode;
  const sales = ((ewidencja['SprzedazWiersz'] ?? []) as XmlNode[]).map((row, i): JpkSalesRow => {
    const where = `SprzedazWiersz ${i + 1}`;
    return compact({
      ...rowBase(row, where, SALES_KEYS),
      issueDate: date(row, 'DataWystawienia', where),
      saleDate: optionalDate(row, 'DataSprzedazy', where),
    });
  });
  const purchases = ((ewidencja['ZakupWiersz'] ?? []) as XmlNode[]).map((row, i): JpkPurchaseRow => {
    const where = `ZakupWiersz ${i + 1}`;
    return compact({
      ...rowBase(row, where, PURCHASE_KEYS),
      issueDate: date(row, 'DataZakupu', where),
      receivedDate: optionalDate(row, 'DataWplywu', where),
    });
  });

  const salesCtrl = (ewidencja['SprzedazCtrl'] ?? {}) as XmlNode;
  const purchaseCtrl = (ewidencja['ZakupCtrl'] ?? {}) as XmlNode;
  const amountOr0 = (node: XmlNode, key: string) => {
    const v = text(node, key);
    return v === undefined ? 0 : parseJpkAmount(v);
  };

  return {
    variant: Number(match[1]) as 2 | 3,
    year,
    month,
    correction: text(header, 'CelZlozenia') === '2',
    declaration,
    sales,
    purchases,
    ctrl: {
      salesRows: Number(text(salesCtrl, 'LiczbaWierszySprzedazy') ?? 0),
      outputVat: amountOr0(salesCtrl, 'PodatekNalezny'),
      purchaseRows: Number(text(purchaseCtrl, 'LiczbaWierszyZakupow') ?? 0),
      inputVat: amountOr0(purchaseCtrl, 'PodatekNaliczony'),
    },
  };
}

const sumFields = (rows: readonly JpkRowBase[], fields: readonly JpkField[]) =>
  rows.reduce((a, r) => a + fields.reduce((b, f) => b + (r.fields[f] ?? 0), 0), 0);

/**
 * Перевірка контрольних сум файла. PodatekNalezny рахується без рядків з позначкою FP
 * (faktura do paragonu), як того вимагає структура.
 */
export function jpkCtrlIssues(jpk: JpkV7M): JpkCtrlIssue[] {
  const issues: JpkCtrlIssue[] = [];
  const counted = jpk.sales.filter((r) => r.documentType !== 'FP');
  const output = sumFields(counted, OUTPUT_VAT_PLUS) - sumFields(counted, OUTPUT_VAT_MINUS);
  if (jpk.ctrl.salesRows !== jpk.sales.length) issues.push('salesRows');
  if (jpk.ctrl.outputVat !== output) issues.push('outputVat');
  if (jpk.ctrl.purchaseRows !== jpk.purchases.length) issues.push('purchaseRows');
  if (jpk.ctrl.inputVat !== sumFields(jpk.purchases, INPUT_VAT)) issues.push('inputVat');
  return issues;
}

/** Період файла: 'YYYY-MM' */
export const jpkPeriod = (jpk: Pick<JpkV7M, 'year' | 'month'>) => `${jpk.year}-${String(jpk.month).padStart(2, '0')}`;
