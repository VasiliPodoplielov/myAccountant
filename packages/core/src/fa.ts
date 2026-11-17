/**
 * Розбір e-фактури FA(3) з KSeF (етап 9). Схема: faktury/schemy/FA/schemat_FA(3)_v1-0E.xsd з офіційної
 * документації KSeF 2.0 (github.com/CIRFMF/ksef-docs), простір імен http://crd.gov.pl/wzor/2025/06/25/13775/.
 *
 * Береться те, що потрібно обліку: сторони, номер, дати, валюта, суми за ставками (P_13_x, P_14_x),
 * разом до сплати (P_15), позиції (FaWiersz) для опису, оплата й дані коригованої фактури. Суми — гроші
 * у валюті фактури, VAT у PLN для валютної фактури — з P_14_xW. Текст рахується точно, без float.
 */

import { XMLParser } from 'fast-xml-parser';
import { isIsoDate } from './dates';
import type { DocumentLine, VatRateCode } from './document';
import { parseJpkAmount } from './jpk';
import type { Currency } from './tax';

export const FA3_NAMESPACE = 'http://crd.gov.pl/wzor/2025/06/25/13775/';

/** RodzajFaktury: VAT — основна, KOR — коригувальна, ZAL — авансова, ROZ — розрахункова, UPR — спрощена */
export type FaInvoiceType = 'VAT' | 'KOR' | 'ZAL' | 'ROZ' | 'UPR' | 'KOR_ZAL' | 'KOR_ROZ';

/**
 * Група сум фактури за ставкою:
 * 23, 8, 5 — P_13_1…P_13_3 (стандартна й знижені ставки); 4 — P_13_4 (ryczałt dla taksówek);
 * oss — P_13_5 (procedura szczególna OSS); 0kr, 0wdt, 0ex — P_13_6_1…P_13_6_3 (0%: у країні, WDT, eksport);
 * zw — P_13_7; np — P_13_8 (поза країною); np100 — P_13_9 (послуги з art. 100 ust. 1 pkt 4);
 * oo — P_13_10 (odwrotne obciążenie в країні); marza — P_13_11 (procedura marży).
 */
export type FaRateGroup =
  '23' | '8' | '5' | '4' | 'oss' | '0kr' | '0wdt' | '0ex' | 'zw' | 'np' | 'np100' | 'oo' | 'marza';

export interface FaRateSum {
  group: FaRateGroup;
  /** Netto у валюті фактури; у коригувальній фактурі — різниця, може бути від'ємною */
  net: number;
  /** VAT у валюті фактури (P_14_x) */
  vat?: number;
  /** VAT, перерахований у PLN (P_14_xW), для валютної фактури */
  vatPln?: number;
}

export interface FaParty {
  /** NIP (10 цифр) */
  nip?: string;
  /** Номер VAT UE: KodUE + NrVatUE */
  vatUe?: { country: string; number: string };
  /** Інший податковий номер: KodKraju? + NrID */
  otherId?: { country?: string; id: string };
  name?: string;
  /** Країна з адреси (KodKraju) */
  country?: string;
  /** AdresL1, AdresL2 через кому */
  address?: string;
}

export interface FaLine {
  /** NrWierszaFa */
  no: number;
  /** P_7 */
  name?: string;
  /** P_8A, P_8B — як у файлі */
  unit?: string;
  quantity?: string;
  /** P_11 — netto, P_11A — brutto (для фактур, де ціни брутто), P_11Vat — VAT позиції */
  net?: number;
  gross?: number;
  vat?: number;
  /** P_12 як у файлі: 23, 8, 5, 0 KR, zw, np I тощо */
  rate?: string;
  /** P_6A — дата продажу позиції */
  saleDate?: string;
}

export interface FaCorrectedInvoice {
  number: string;
  issueDate: string;
  ksefNumber?: string;
}

export interface FaInvoice {
  invoiceType: FaInvoiceType;
  /** P_2 */
  number: string;
  /** P_1 */
  issueDate: string;
  /** P_6, або кінець OkresFa, або спільна P_6A всіх позицій */
  saleDate?: string;
  /** OkresFa: P_6_Od, P_6_Do */
  period?: { from: string; to: string };
  /** KodWaluty, ISO 4217 */
  currency: string;
  seller: FaParty;
  buyer: FaParty;
  sums: FaRateSum[];
  /** P_15: разом до сплати у валюті фактури */
  total: number;
  lines: FaLine[];
  /** Дата оплати, якщо фактуру оплачено повністю (Zaplacono = 1) */
  paidAt?: string;
  /** Перший термін оплати (TerminPlatnosci/Termin) */
  dueDate?: string;
  /** DaneFaKorygowanej для коригувальної фактури */
  corrected?: FaCorrectedInvoice[];
  /** PrzyczynaKorekty */
  correctionReason?: string;
}

export class FaParseError extends Error {
  override name = 'FaParseError';
}

// ---------------------------------------------------------------- xml

type XmlNode = Record<string, unknown>;

const ARRAYS = new Set(['FaWiersz', 'DaneFaKorygowanej', 'TerminPlatnosci', 'ZaplataCzesciowa']);

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => ARRAYS.has(name),
});

function text(node: XmlNode, key: string): string | undefined {
  const v = node[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && '#text' in v) return String((v as XmlNode)['#text']);
  if (typeof v === 'object') return undefined;
  return String(v);
}

function required(node: XmlNode, key: string, where: string): string {
  const v = text(node, key);
  if (v === undefined || v === '') throw new FaParseError(`${where}: немає ${key}`);
  return v;
}

function optionalChild(node: XmlNode, key: string): XmlNode | undefined {
  const v = node[key];
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as XmlNode) : undefined;
}

function child(node: XmlNode, key: string, where: string): XmlNode {
  const v = optionalChild(node, key);
  if (!v) throw new FaParseError(`${where}: немає ${key}`);
  return v;
}

function list(node: XmlNode, key: string): XmlNode[] {
  const v = node[key];
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as XmlNode[]) : [];
}

function date(node: XmlNode, key: string, where: string): string {
  const v = required(node, key, where);
  if (!isIsoDate(v)) throw new FaParseError(`${where}: ${key} не дата: «${v}»`);
  return v;
}

function optionalDate(node: XmlNode, key: string, where: string): string | undefined {
  return text(node, key) === undefined ? undefined : date(node, key, where);
}

function amount(node: XmlNode, key: string, where: string): number {
  const v = required(node, key, where);
  try {
    return parseJpkAmount(v);
  } catch {
    throw new FaParseError(`${where}: ${key} не сума: «${v}»`);
  }
}

function optionalAmount(node: XmlNode, key: string, where: string): number | undefined {
  return text(node, key) === undefined ? undefined : amount(node, key, where);
}

/** Відкидає undefined-поля: об'єкт можна порівнювати й писати у Firestore як є */
function compact<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

// ---------------------------------------------------------------- parts

function address(node: XmlNode | undefined): Pick<FaParty, 'country' | 'address'> {
  if (!node) return {};
  const lines = [text(node, 'AdresL1'), text(node, 'AdresL2')].filter((l) => l);
  return { country: text(node, 'KodKraju'), address: lines.length ? lines.join(', ') : undefined };
}

function seller(fa: XmlNode): FaParty {
  const p = child(fa, 'Podmiot1', 'Faktura');
  const id = child(p, 'DaneIdentyfikacyjne', 'Podmiot1');
  return compact({
    nip: required(id, 'NIP', 'Podmiot1'),
    name: required(id, 'Nazwa', 'Podmiot1'),
    ...address(optionalChild(p, 'Adres')),
  });
}

function buyer(fa: XmlNode): FaParty {
  const p = child(fa, 'Podmiot2', 'Faktura');
  const id = child(p, 'DaneIdentyfikacyjne', 'Podmiot2');
  const ue = text(id, 'NrVatUE');
  const other = text(id, 'NrID');
  const addr = address(optionalChild(p, 'Adres'));
  return compact({
    nip: text(id, 'NIP'),
    vatUe: ue ? { country: required(id, 'KodUE', 'Podmiot2'), number: ue } : undefined,
    otherId: other ? compact({ country: text(id, 'KodKraju'), id: other }) : undefined,
    name: text(id, 'Nazwa'),
    ...addr,
    country: addr.country ?? (ue ? text(id, 'KodUE') : text(id, 'KodKraju')),
  });
}

/** Поля сум: netto, VAT, VAT у PLN */
const SUM_FIELDS: [FaRateGroup, string, string?, string?][] = [
  ['23', 'P_13_1', 'P_14_1', 'P_14_1W'],
  ['8', 'P_13_2', 'P_14_2', 'P_14_2W'],
  ['5', 'P_13_3', 'P_14_3', 'P_14_3W'],
  ['4', 'P_13_4', 'P_14_4', 'P_14_4W'],
  ['oss', 'P_13_5', 'P_14_5'],
  ['0kr', 'P_13_6_1'],
  ['0wdt', 'P_13_6_2'],
  ['0ex', 'P_13_6_3'],
  ['zw', 'P_13_7'],
  ['np', 'P_13_8'],
  ['np100', 'P_13_9'],
  ['oo', 'P_13_10'],
  ['marza', 'P_13_11'],
];

function sums(fa: XmlNode): FaRateSum[] {
  const out: FaRateSum[] = [];
  for (const [group, netKey, vatKey, vatPlnKey] of SUM_FIELDS) {
    const net = optionalAmount(fa, netKey, 'Fa');
    if (net === undefined) continue;
    out.push(
      compact({
        group,
        net,
        vat: vatKey ? optionalAmount(fa, vatKey, 'Fa') : undefined,
        vatPln: vatPlnKey ? optionalAmount(fa, vatPlnKey, 'Fa') : undefined,
      }),
    );
  }
  return out;
}

function lines(fa: XmlNode): FaLine[] {
  return list(fa, 'FaWiersz').map((w, i) => {
    const where = `FaWiersz ${i + 1}`;
    const no = Number(required(w, 'NrWierszaFa', where));
    if (!Number.isSafeInteger(no) || no < 1) throw new FaParseError(`${where}: некоректний NrWierszaFa`);
    return compact({
      no,
      name: text(w, 'P_7'),
      unit: text(w, 'P_8A'),
      quantity: text(w, 'P_8B'),
      net: optionalAmount(w, 'P_11', where),
      gross: optionalAmount(w, 'P_11A', where),
      vat: optionalAmount(w, 'P_11Vat', where),
      rate: text(w, 'P_12'),
      saleDate: optionalDate(w, 'P_6A', where),
    });
  });
}

function payment(fa: XmlNode): Pick<FaInvoice, 'paidAt' | 'dueDate'> {
  const p = optionalChild(fa, 'Platnosc');
  if (!p) return {};
  const paidAt = text(p, 'Zaplacono') === '1' ? date(p, 'DataZaplaty', 'Platnosc') : undefined;
  const due = list(p, 'TerminPlatnosci')
    .map((t) => text(t, 'Termin'))
    .find((t) => t !== undefined && isIsoDate(t));
  return { paidAt, dueDate: due };
}

function corrected(fa: XmlNode): FaCorrectedInvoice[] | undefined {
  const items = list(fa, 'DaneFaKorygowanej').map((d, i) =>
    compact({
      number: required(d, 'NrFaKorygowanej', `DaneFaKorygowanej ${i + 1}`),
      issueDate: date(d, 'DataWystFaKorygowanej', `DaneFaKorygowanej ${i + 1}`),
      ksefNumber: text(d, 'NrKSeFFaKorygowanej'),
    }),
  );
  return items.length ? items : undefined;
}

const INVOICE_TYPES = new Set<string>(['VAT', 'KOR', 'ZAL', 'ROZ', 'UPR', 'KOR_ZAL', 'KOR_ROZ']);

/** Дата продажу: P_6, інакше кінець OkresFa, інакше спільна P_6A всіх позицій */
function saleDate(fa: XmlNode, period: FaInvoice['period'], items: FaLine[]): string | undefined {
  const p6 = optionalDate(fa, 'P_6', 'Fa');
  if (p6) return p6;
  if (period) return period.to;
  const dates = new Set(items.map((l) => l.saleDate));
  const [only] = [...dates];
  return dates.size === 1 && only ? only : undefined;
}

// ---------------------------------------------------------------- parse

/**
 * Розбирає XML фактури FA(3). Інша структура (FA(2), PEF), відсутнє обов'язкове поле, сума чи дата
 * в неправильному форматі дають FaParseError.
 */
export function parseFa3(xml: string): FaInvoice {
  let doc: XmlNode;
  try {
    doc = parser.parse(xml, true) as XmlNode;
  } catch (e) {
    throw new FaParseError(`Не XML: ${(e as Error).message}`);
  }
  const root = optionalChild(doc, 'Faktura');
  if (!root) throw new FaParseError('Не фактура FA: немає елемента Faktura');
  const header = child(root, 'Naglowek', 'Faktura');
  const form = optionalChild(header, 'KodFormularza');
  const system = form ? String(form['@kodSystemowy'] ?? '') : '';
  if (system !== 'FA (3)' || text(header, 'WariantFormularza') !== '3') {
    throw new FaParseError(`Непідтримана структура: «${system || 'невідома'}», підтримано лише FA (3)`);
  }

  const fa = child(root, 'Fa', 'Faktura');
  const invoiceType = required(fa, 'RodzajFaktury', 'Fa');
  if (!INVOICE_TYPES.has(invoiceType)) throw new FaParseError(`Fa: невідомий RodzajFaktury «${invoiceType}»`);

  const okres = optionalChild(fa, 'OkresFa');
  const period = okres ? { from: date(okres, 'P_6_Od', 'OkresFa'), to: date(okres, 'P_6_Do', 'OkresFa') } : undefined;
  const items = lines(fa);

  return compact({
    invoiceType: invoiceType as FaInvoiceType,
    number: required(fa, 'P_2', 'Fa'),
    issueDate: date(fa, 'P_1', 'Fa'),
    saleDate: saleDate(fa, period, items),
    period,
    currency: required(fa, 'KodWaluty', 'Fa'),
    seller: seller(root),
    buyer: buyer(root),
    sums: sums(fa),
    total: amount(fa, 'P_15', 'Fa'),
    lines: items,
    ...payment(fa),
    corrected: corrected(fa),
    correctionReason: text(fa, 'PrzyczynaKorekty'),
  });
}

// ---------------------------------------------------------------- to document

/** Що з фактури не лягає в модель документа: такий документ треба внести вручну або дописати */
export type FaIssueCode =
  /** валюта, якої немає в обліку (лише PLN, EUR, USD) */
  | 'currency'
  /** ставка, якої модель не веде: taxi, OSS, odwrotne obciążenie, marża */
  | 'rate'
  /** фактура без сум за ставками */
  | 'noSums';

export interface FaIssue {
  code: FaIssueCode;
  detail?: string;
}

const RATE_CODES: Partial<Record<FaRateGroup, VatRateCode>> = {
  '23': '23',
  '8': '8',
  '5': '5',
  '0kr': '0',
  '0wdt': '0',
  '0ex': '0',
  zw: 'zw',
  np: 'np',
  np100: 'np',
};

const LEDGER_CURRENCIES = new Set<string>(['PLN', 'EUR', 'USD']);

export const isLedgerCurrency = (c: string): c is Currency => LEDGER_CURRENCIES.has(c);

/**
 * Позиції документа (DocumentLine) з сум фактури за ставками. VAT — PLN-гроші: для PLN-фактури це
 * P_14_x, для валютної — P_14_xW; якщо його немає, документ порахує VAT від netto за курсом NBP.
 * Групи, яких модель не веде, у позиції не потрапляють і йдуть у issues.
 */
export function faDocumentLines(inv: FaInvoice): { lines: DocumentLine[]; issues: FaIssue[] } {
  const issues: FaIssue[] = [];
  const out: DocumentLine[] = [];
  const pln = inv.currency === 'PLN';
  if (!isLedgerCurrency(inv.currency)) issues.push({ code: 'currency', detail: inv.currency });
  for (const s of inv.sums) {
    const rate = RATE_CODES[s.group];
    if (!rate) {
      issues.push({ code: 'rate', detail: s.group });
      continue;
    }
    const vat = pln ? s.vat : s.vatPln;
    out.push(
      rate === 'zw' || rate === 'np' || vat === undefined
        ? { net: s.net, vatRate: rate }
        : { net: s.net, vatRate: rate, vat },
    );
  }
  if (inv.sums.length === 0) issues.push({ code: 'noSums' });
  return { lines: out, issues };
}
