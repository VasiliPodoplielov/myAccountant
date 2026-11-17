/**
 * Запис вхідних з KSeF (users/{uid}/ksefInbox/{ksefNumber}, етап 9). Його пише сервіс apps/ksef-sync,
 * а екран «Нові з KSeF» (етап 10) робить з нього документ. Тут — лише чиста збірка запису з метаданих
 * KSeF і XML фактури: розбір FA(3), позиції документа, підказка категорії з vendorRules.
 */

import type { DocumentLine } from './document';
import { FaParseError, faDocumentLines, parseFa3, type FaInvoice, type FaIssue } from './fa';
import { contractorKey, type ContractorRules } from './jpkImport';
import type { CostCategory } from './tax';

export type KsefInboxStatus = 'new' | 'accepted' | 'ignored';

/** cost — власник покупець (Podmiot 2), income — продавець (Podmiot 1) */
export type KsefRole = 'cost' | 'income';

/** Те, що сервіс бере з метаданих KSeF (POST /invoices/query/metadata) */
export interface KsefInvoiceRef {
  ksefNumber: string;
  invoiceNumber: string;
  issueDate: string;
  /** Дата надання номера KSeF — дата отримання фактури (ISO date-time) */
  acquisitionDate: string;
  /** Дата трвалого запису в KSeF: за нею йде синхронізація (ISO date-time) */
  permanentStorageDate: string;
  /** SHA-256 XML фактури, Base64 */
  invoiceHash: string;
  sellerNip: string;
  sellerName?: string;
  buyerName?: string;
  currency: string;
  /** Разом brutto у валюті фактури, гроші */
  gross: number;
  /** FormCode.value: FA, PEF, RR */
  formCode: string;
  /** Vat, Kor, Zal, … як у метаданих */
  invoiceType: string;
}

export interface KsefInboxItem extends KsefInvoiceRef {
  role: KsefRole;
  status: KsefInboxStatus;
  /** Дата отримання за часом Польщі, 'YYYY-MM-DD': receivedDate документа витрати */
  receivedDate: string;
  /** Розібрана фактура; немає, якщо розбір не вдався (parseError) */
  invoice?: FaInvoice;
  parseError?: string;
  /** Позиції документа з сум фактури (faDocumentLines) */
  lines?: DocumentLine[];
  issues?: FaIssue[];
  /** Категорія з правила постачальника (лише для витрат) */
  suggestedCategory?: CostCategory;
  /** Правило клієнта каже, що продаж розраховується періодами (лише для доходу) */
  suggestedPeriodicSettlement?: boolean;
  /** XML фактури як отримано з KSeF; немає, якщо він більший за ліміт документа Firestore (xmlOmitted) */
  xml?: string;
  xmlOmitted?: boolean;
  /** SHA-256 отриманого XML не збігся з invoiceHash із метаданих: файл треба перевірити */
  hashMismatch?: boolean;
  /** Позиції фактури (invoice.lines) не вмістилися в документ Firestore; суми за ставками лишилися */
  linesOmitted?: boolean;
  /** Коли сервіс записав фактуру (ISO date-time) */
  syncedAt: string;
}

/** Документ Firestore — до 1 MiB разом з іменами полів: запис тримаємо в межах KSEF_ITEM_LIMIT_BYTES */
export const KSEF_ITEM_LIMIT_BYTES = 900_000;

/** Довжина рядка в UTF-8, байти */
export function utf8Length(s: string): number {
  let n = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

const warsawDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Warsaw',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Дата за часом Польщі для моменту ISO: 2026-03-31T22:30:00Z → 2026-04-01 */
export function warsawDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) throw new RangeError(`Не дата й час: «${iso}»`);
  return warsawDay.format(t);
}

/** Сума з метаданих KSeF (number, злоті) → гроші */
export const ksefAmount = (zl: number): number => Math.round(zl * 100);

/** Відкидає undefined-поля: Firestore їх не приймає */
function compact<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/**
 * Збирає запис вхідних. Фактура, яку не вдалося розібрати (не FA(3), помилка у файлі), теж записується:
 * з parseError і XML, щоб власник побачив її й вніс вручну.
 */
export function ksefInboxItem(
  ref: KsefInvoiceRef,
  role: KsefRole,
  xml: string,
  rules: ContractorRules,
  syncedAt: string,
): KsefInboxItem {
  let invoice: FaInvoice | undefined;
  let parseError: string | undefined;
  try {
    invoice = parseFa3(xml);
  } catch (e) {
    if (!(e instanceof FaParseError)) throw e;
    parseError = e.message;
  }

  const mapped = invoice ? faDocumentLines(invoice) : undefined;
  const contractor = invoice ? (role === 'cost' ? invoice.seller : invoice.buyer) : undefined;
  const key = contractor
    ? contractorKey({ contractorTaxId: contractor.nip, contractorName: contractor.name ?? '' })
    : role === 'cost'
      ? ref.sellerNip
      : undefined;
  const rule = key ? rules[key] : undefined;

  const item: KsefInboxItem = compact({
    ...ref,
    role,
    status: 'new' as const,
    receivedDate: warsawDate(ref.acquisitionDate),
    invoice,
    parseError,
    lines: mapped?.lines,
    issues: mapped?.issues.length ? mapped.issues : undefined,
    suggestedCategory: role === 'cost' ? rule?.category : undefined,
    suggestedPeriodicSettlement: role === 'income' && rule?.periodicSettlement ? true : undefined,
    xml,
    syncedAt,
  });

  // запис, більший за документ Firestore, зупинив би синхронізацію: спершу без XML, далі без позицій
  const fits = () => utf8Length(JSON.stringify(item)) <= KSEF_ITEM_LIMIT_BYTES;
  if (!fits()) {
    delete item.xml;
    item.xmlOmitted = true;
  }
  if (!fits() && item.invoice) {
    item.invoice = { ...item.invoice, lines: [] };
    item.linesOmitted = true;
  }
  return item;
}
