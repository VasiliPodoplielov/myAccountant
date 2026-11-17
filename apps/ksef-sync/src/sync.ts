/**
 * Інкрементальна синхронізація вхідних з KSeF (етап 9) за pobieranie-faktur/przyrostowe-pobieranie-faktur.md
 * і limity-api.md («scenariusze niskiego wolumenu»): метадані через POST /invoices/query/metadata за датою
 * PermanentStorage з restrictToPermanentStorageHwmDate, далі XML кожної нової фактури через
 * GET /invoices/ksef/{ksefNumber}. Пакетний експорт (/invoices/exports) для кількох десятків фактур на місяць
 * не потрібен.
 *
 * Точка продовження — для кожної ролі окремо (Podmiot 2 — витрати, Podmiot 1 — доходи): кінець вікна,
 * обмежений HWM. Дані до HWM KSeF гарантує повними, тож вікна прилягають без пропусків. Точка зберігається
 * лише після того, як усі фактури вікна записано: збій посередині повторить вікно, а дублікати відсіє
 * номер KSeF (id запису).
 */

import { createHash } from 'node:crypto';
import {
  ksefAmount,
  ksefInboxItem,
  type ContractorRules,
  type KsefInboxItem,
  type KsefInvoiceRef,
  type KsefRole,
} from '@jdg/core';
import { isoSeconds } from './http';
import type { InvoiceMetadata, InvoiceQueryFilters, InvoiceSubjectType, QueryInvoicesMetadataResponse } from './api';

export interface SyncPoint {
  /** Початок наступного вікна (ISO date-time) */
  from: string;
  updatedAt: string;
}

export type SyncState = Partial<Record<KsefRole, SyncPoint>>;

export interface SyncSource {
  queryMetadata(
    filters: InvoiceQueryFilters,
    page: { pageOffset: number; pageSize: number },
  ): Promise<QueryInvoicesMetadataResponse>;
  invoiceXml(ksefNumber: string): Promise<Buffer>;
}

export interface SyncStore {
  loadState(): Promise<SyncState>;
  saveState(role: KsefRole, point: SyncPoint): Promise<void>;
  /** Які з номерів уже є у вхідних */
  existing(ksefNumbers: string[]): Promise<Set<string>>;
  /** Пише новий запис; false — запис уже був (його не перезаписуємо: статус міг змінити власник) */
  add(item: KsefInboxItem): Promise<boolean>;
  vendorRules(): Promise<ContractorRules>;
}

export interface SyncOptions {
  /** Звідки починати, якщо точки продовження ще немає (ISO date-time) */
  startFrom: string;
  now?: () => Date;
  roles?: KsefRole[];
  /** Довжина вікна: API приймає не більше 100 днів */
  windowDays?: number;
  pageSize?: number;
  log?: (message: string) => void;
}

export interface RoleReport {
  role: KsefRole;
  /** Перший і останній кінець вікна цього запуску */
  from: string;
  to: string;
  /** Фактур у метаданих */
  found: number;
  /** Записано нових */
  added: number;
  /** Номери, у яких хеш XML не збігся з метаданими */
  hashMismatch: string[];
  /** Номери, які не вдалося розібрати як FA(3) (записані з parseError) */
  unparsed: string[];
}

export class SyncError extends Error {
  override name = 'SyncError';
}

const SUBJECT: Record<KsefRole, InvoiceSubjectType> = { cost: 'Subject2', income: 'Subject1' };
const DAY = 86_400_000;
const MAX_QUERIES_PER_WINDOW = 1000;

export function invoiceRef(m: InvoiceMetadata): KsefInvoiceRef {
  const ref: KsefInvoiceRef = {
    ksefNumber: m.ksefNumber,
    invoiceNumber: m.invoiceNumber,
    issueDate: m.issueDate,
    acquisitionDate: m.acquisitionDate,
    permanentStorageDate: m.permanentStorageDate,
    invoiceHash: m.invoiceHash,
    sellerNip: m.seller.nip,
    currency: m.currency,
    gross: ksefAmount(m.grossAmount),
    formCode: m.formCode.value,
    invoiceType: m.invoiceType,
  };
  if (m.seller.name) ref.sellerName = m.seller.name;
  if (m.buyer.name) ref.buyerName = m.buyer.name;
  return ref;
}

/** XML з байтів: UTF-8, без BOM */
export function decodeXml(bytes: Buffer): string {
  const s = bytes.toString('utf8');
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('base64');

interface Collected {
  invoices: InvoiceMetadata[];
  hwm?: string;
}

/** Усі метадані вікна: сторінки, а після обрізання (10 000 записів) — нове вікно від останньої дати */
async function collectWindow(
  source: SyncSource,
  subjectType: InvoiceSubjectType,
  from: string,
  to: string | undefined,
  pageSize: number,
): Promise<Collected> {
  const byNumber = new Map<string, InvoiceMetadata>();
  let windowFrom = from;
  let pageOffset = 0;
  let hwm: string | undefined;
  for (let i = 0; ; i++) {
    if (i >= MAX_QUERIES_PER_WINDOW) throw new SyncError('Забагато запитів метаданих в одному вікні');
    const res = await source.queryMetadata(
      {
        subjectType,
        dateRange: { dateType: 'PermanentStorage', from: windowFrom, to, restrictToPermanentStorageHwmDate: true },
      },
      { pageOffset, pageSize },
    );
    if (res.permanentStorageHwmDate) hwm = res.permanentStorageHwmDate;
    for (const inv of res.invoices) byNumber.set(inv.ksefNumber, inv);
    if (!res.hasMore) break;
    if (res.isTruncated) {
      const last = res.invoices.at(-1)?.permanentStorageDate;
      if (!last || last === windowFrom) throw new SyncError(`Обрізана відповідь без зсуву дати (${windowFrom})`);
      windowFrom = last;
      pageOffset = 0;
    } else {
      pageOffset++;
    }
  }
  const invoices = [...byNumber.values()].sort(
    (a, b) => Date.parse(a.permanentStorageDate) - Date.parse(b.permanentStorageDate),
  );
  return { invoices, hwm };
}

async function syncRole(
  role: KsefRole,
  source: SyncSource,
  store: SyncStore,
  rules: ContractorRules,
  start: string,
  opts: Required<Omit<SyncOptions, 'startFrom' | 'roles'>>,
): Promise<RoleReport> {
  const report: RoleReport = { role, from: start, to: start, found: 0, added: 0, hashMismatch: [], unparsed: [] };
  let from = start;
  for (;;) {
    const nowMs = opts.now().getTime();
    const windowEnd = Date.parse(from) + opts.windowDays * DAY;
    // вікно в минулому — з явним кінцем; останнє — без кінця, KSeF обріже його до HWM
    const to = windowEnd < nowMs ? isoSeconds(windowEnd) : undefined;
    const { invoices, hwm } = await collectWindow(source, SUBJECT[role], from, to, opts.pageSize);
    if (!hwm) throw new SyncError(`KSeF не повернув permanentStorageHwmDate (${role}, від ${from})`);

    report.found += invoices.length;
    const existing = await store.existing(invoices.map((i) => i.ksefNumber));
    for (const meta of invoices) {
      if (existing.has(meta.ksefNumber)) continue;
      const bytes = await source.invoiceXml(meta.ksefNumber);
      const item = ksefInboxItem(invoiceRef(meta), role, decodeXml(bytes), rules, opts.now().toISOString());
      if (sha256(bytes) !== meta.invoiceHash) {
        item.hashMismatch = true;
        report.hashMismatch.push(meta.ksefNumber);
        opts.log(`${meta.ksefNumber}: хеш XML не збігається з метаданими`);
      }
      if (item.parseError) report.unparsed.push(meta.ksefNumber);
      if (await store.add(item)) report.added++;
    }

    const next = to && Date.parse(to) <= Date.parse(hwm) ? to : hwm;
    if (Date.parse(next) > Date.parse(from)) {
      await store.saveState(role, { from: next, updatedAt: opts.now().toISOString() });
      report.to = next;
    }
    if (!to || next !== to) break;
    from = next;
  }
  return report;
}

/** Синхронізує ролі по черзі; кожна продовжує зі своєї точки */
export async function syncKsef(source: SyncSource, store: SyncStore, options: SyncOptions): Promise<RoleReport[]> {
  if (Number.isNaN(Date.parse(options.startFrom)))
    throw new SyncError(`Некоректна дата початку: «${options.startFrom}»`);
  const opts = {
    now: options.now ?? (() => new Date()),
    windowDays: options.windowDays ?? 90,
    pageSize: options.pageSize ?? 250,
    log: options.log ?? (() => {}),
  };
  if (opts.windowDays < 1 || opts.windowDays > 100) throw new SyncError('Вікно має бути від 1 до 100 днів');
  const state = await store.loadState();
  const rules = await store.vendorRules();
  const reports: RoleReport[] = [];
  for (const role of options.roles ?? (['cost', 'income'] as const)) {
    reports.push(await syncRole(role, source, store, rules, state[role]?.from ?? options.startFrom, opts));
  }
  return reports;
}
