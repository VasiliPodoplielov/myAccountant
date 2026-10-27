/**
 * Бекап року (етап 8, критерій переходу 6): повний знімок даних року у JSON, перевірка файла і відновлення.
 * Усе чисте: читання й запис Firestore робить веб-додаток, тут лише формат, перевірка й список записів.
 * Відновлення лише дописує: нічого не видаляє, документ із тим самим id перезаписується.
 * Похідне поле документа touchedPeriods (closing.ts) у файл не йде: відновлення проставляє його заново.
 */

import {
  closedPeriodList,
  closedPeriodsAffected,
  withoutTouchedPeriods,
  withTouchedPeriods,
  type PeriodRecord,
} from './closing';
import { documentDates, type LedgerDocument } from './document';
import { stableStringify } from './json';
import { isIsoDate } from './dates';
import type { CategoryOverrides, ContractorRule } from './jpkImport';
import { calcYearFromDocuments } from './ledger';
import type { MonthReference } from './reference';
import type { TaxYearConfig, YearSettings } from './tax';

export const BACKUP_FORMAT = 'jdg-ledger-backup';
export const BACKUP_VERSION = 1;

export type StoredDocument = LedgerDocument & { id: string };

/** Курси NBP одного дня (fxRates/{date}) */
export interface FxRateEntry {
  EUR?: number;
  USD?: number;
}

/** Дані, з яких складається бекап; те саме, що читає застосунок із Firestore */
export interface BackupData {
  settings: YearSettings | null;
  documents: StoredDocument[];
  /** 'YYYY-MM' → еталон */
  references: Record<string, MonthReference>;
  /** 'YYYY-MM' → стан місяця */
  periods: Record<string, PeriodRecord>;
  /** Ключ (NIP або назва) → правило */
  vendorRules: Record<string, ContractorRule>;
  /** id документа → категорія */
  categoryOverrides: CategoryOverrides;
  /** 'YYYY-MM-DD' → курси */
  fxRates: Record<string, FxRateEntry>;
}

export interface Backup extends BackupData {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  /** ISO-момент експорту */
  exportedAt: string;
  year: number;
}

const sortedEntries = <T>(rec: Record<string, T>) => Object.entries(rec).sort(([a], [b]) => a.localeCompare(b));
const sortedRecord = <T>(rec: Record<string, T>): Record<string, T> => Object.fromEntries(sortedEntries(rec));

/**
 * Документ належить року, якщо його дата PIT, VAT чи оплати припадає на цей рік: оплата валютного документа
 * минулого року дає курсову різницю в KPiR цього року. Документ із поганими датами теж береться.
 */
function inYear(doc: LedgerDocument, year: number): boolean {
  try {
    const dates = documentDates(doc);
    const paidAt = doc.kind === 'internal' ? undefined : doc.paidAt;
    return [dates.pit, dates.vat, paidAt].some((d) => d?.startsWith(`${year}-`));
  } catch {
    return true;
  }
}

/** Курси, потрібні документам року: від середини грудня попереднього року (курс — за останній робочий день до дати) */
const fxInScope = (date: string, year: number) => date >= `${year - 1}-12-15` && date <= `${year}-12-31`;

/** Бекап року: документи й місячні записи року плюс загальні правила контрагентів і категорій */
export function buildBackup(data: BackupData, year: number, now: Date): Backup {
  const prefix = `${year}-`;
  const byPrefix = <T>(rec: Record<string, T>) =>
    sortedRecord(Object.fromEntries(Object.entries(rec).filter(([key]) => key.startsWith(prefix))));
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    year,
    settings: data.settings,
    documents: data.documents
      .filter((d) => inYear(d, year))
      .map((d) => withoutTouchedPeriods(d) as StoredDocument)
      .sort((a, b) => a.id.localeCompare(b.id)),
    references: byPrefix(data.references),
    periods: byPrefix(data.periods),
    vendorRules: sortedRecord(data.vendorRules),
    categoryOverrides: sortedRecord(data.categoryOverrides),
    fxRates: sortedRecord(Object.fromEntries(Object.entries(data.fxRates).filter(([d]) => fxInScope(d, year)))),
  };
}

export const backupToJson = (backup: Backup): string => JSON.stringify(backup, null, 2);

// ---------------------------------------------------------------- parse

export type ParsedBackup = { ok: true; backup: Backup } | { ok: false; errors: string[] };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const KINDS = new Set(['income', 'cost', 'internal']);
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Розбір і структурна перевірка файла; помилки зібрані всі разом, а не лише перша */
export function parseBackup(text: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['Файл не є JSON'] };
  }
  if (!isRecord(raw) || raw.format !== BACKUP_FORMAT) {
    return { ok: false, errors: ['Це не бекап JDG Ledger (немає позначки формату)'] };
  }
  if (raw.version !== BACKUP_VERSION) {
    return { ok: false, errors: [`Непідтримувана версія бекапу: ${String(raw.version)} (потрібна ${BACKUP_VERSION})`] };
  }

  const errors: string[] = [];
  if (!Number.isInteger(raw.year)) errors.push('Не вказано рік');
  if (typeof raw.exportedAt !== 'string') errors.push('Не вказано час експорту');
  if (raw.settings !== null && !isRecord(raw.settings)) errors.push('settings: очікується об’єкт або null');
  for (const key of ['references', 'periods', 'vendorRules', 'categoryOverrides', 'fxRates'] as const) {
    if (!isRecord(raw[key])) errors.push(`${key}: очікується об’єкт`);
  }
  // ключі стають id документів Firestore: місяць 'YYYY-MM', id без '/'
  for (const key of ['references', 'periods'] as const) {
    const rec = raw[key];
    if (!isRecord(rec)) continue;
    for (const [period, entry] of Object.entries(rec)) {
      if (!PERIOD.test(period) || !isRecord(entry)) errors.push(`${key}.${period}: некоректний запис`);
    }
  }
  if (isRecord(raw.periods)) {
    for (const [period, entry] of Object.entries(raw.periods)) {
      if (isRecord(entry) && entry.status !== 'open' && entry.status !== 'closed') {
        errors.push(`periods.${period}: невідомий стан`);
      }
    }
  }
  if (isRecord(raw.categoryOverrides)) {
    for (const id of Object.keys(raw.categoryOverrides)) {
      if (id === '' || id.includes('/')) errors.push(`categoryOverrides.${id}: некоректний id`);
    }
  }
  if (!Array.isArray(raw.documents)) {
    errors.push('documents: очікується масив');
  } else {
    const ids = new Set<string>();
    raw.documents.forEach((d: unknown, i) => {
      const label = `documents[${i}]`;
      if (!isRecord(d)) return errors.push(`${label}: очікується об’єкт`);
      if (typeof d.id !== 'string' || d.id === '' || d.id.includes('/')) errors.push(`${label}: некоректний id`);
      else if (ids.has(d.id)) errors.push(`${label}: id ${d.id} повторюється`);
      else ids.add(d.id);
      if (typeof d.kind !== 'string' || !KINDS.has(d.kind)) errors.push(`${label}: невідомий вид документа`);
      if (typeof d.number !== 'string') errors.push(`${label}: немає номера`);
      if (typeof d.issueDate !== 'string' || !isIsoDate(d.issueDate)) errors.push(`${label}: некоректна дата`);
    });
  }
  if (isRecord(raw.fxRates)) {
    for (const [date, entry] of Object.entries(raw.fxRates)) {
      if (!isIsoDate(date) || !isRecord(entry)) errors.push(`fxRates.${date}: некоректний запис`);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, backup: raw as unknown as Backup };
}

// ---------------------------------------------------------------- restore

export type RestoreCollection =
  'settings' | 'documents' | 'reference' | 'periods' | 'locks' | 'vendorRules' | 'categoryOverrides' | 'fxRates';

/** Один запис відновлення: колекція користувача, id документа і дані */
export interface RestoreOp {
  collection: RestoreCollection;
  id: string;
  data: object;
  /** Курси EUR і USD одного дня пишуться окремо, тому зливаються з наявним записом */
  merge?: boolean;
}

/**
 * Що треба записати, щоб відновити бекап. Ключ правила контрагента кодується так само, як у шляхах Firestore.
 * Документи йдуть першими, а стан місяців і locks/periods — останніми: firestore.rules пускають закриття
 * місяця лише разом зі списком закритих, тож ці записи мають іти одним пакетом (isClosingOp), і документи
 * пишуться, поки місяці ще не закриті. livePeriods — стан місяців у базі: місяці поза файлом лишаються як були.
 */
export function restoreOps(backup: Backup, livePeriods: Readonly<Record<string, PeriodRecord>> = {}): RestoreOp[] {
  const closed = closedPeriodList({ ...livePeriods, ...backup.periods });
  return [
    ...(backup.settings ? [{ collection: 'settings' as const, id: String(backup.year), data: backup.settings }] : []),
    ...backup.documents.map(({ id, ...data }): RestoreOp => ({
      collection: 'documents',
      id,
      data: withTouchedPeriods(data as LedgerDocument),
    })),
    ...sortedEntries(backup.references).map(([id, data]): RestoreOp => ({ collection: 'reference', id, data })),
    ...sortedEntries(backup.vendorRules).map(([key, data]): RestoreOp => ({
      collection: 'vendorRules',
      id: encodeURIComponent(key),
      data,
    })),
    ...sortedEntries(backup.categoryOverrides).map(([id, category]): RestoreOp => ({
      collection: 'categoryOverrides',
      id,
      data: { category },
    })),
    ...sortedEntries(backup.fxRates).map(([id, data]): RestoreOp => ({ collection: 'fxRates', id, data, merge: true })),
    ...sortedEntries(backup.periods).map(([id, data]): RestoreOp => ({ collection: 'periods', id, data })),
    ...(Object.keys(backup.periods).length > 0
      ? [{ collection: 'locks' as const, id: 'periods', data: { closed } }]
      : []),
  ];
}

/** Записи стану місяців: пишуться одним пакетом наприкінці відновлення */
export const isClosingOp = (op: RestoreOp) => op.collection === 'periods' || op.collection === 'locks';

/**
 * Закриті місяці, які відновлення змінило б: документи файла, що відрізняються від бази й торкаються
 * закритого місяця. Firestore такий запис відхилить; документи без змін записуються.
 */
export function restoreTouchesClosed(backup: Backup, live: Pick<BackupData, 'documents' | 'periods'>): string[] {
  const existing = new Map(live.documents.map(({ id, ...doc }) => [id, doc as LedgerDocument]));
  const touched = new Set<string>();
  for (const { id, ...doc } of backup.documents) {
    try {
      for (const p of closedPeriodsAffected(doc as LedgerDocument, existing.get(id), live.periods)) touched.add(p);
    } catch {
      // документ із поганими датами не належить жодному місяцю
    }
  }
  return [...touched].sort();
}

// ---------------------------------------------------------------- verify

export { stableStringify } from './json';

export interface BackupVerification {
  /** Файл і поточні дані збігаються в межах року */
  identical: boolean;
  /** Опис розбіжностей, по колекціях */
  differences: string[];
  /** Розрахунок року з файла дає ті самі місячні суми, що й поточний облік; null — не перевірялося */
  figuresMatch: boolean | null;
}

function diffRecords(label: string, fromFile: Record<string, unknown>, live: Record<string, unknown>): string[] {
  const missing = Object.keys(fromFile).filter((k) => !(k in live));
  const extra = Object.keys(live).filter((k) => !(k in fromFile));
  const changed = Object.keys(fromFile).filter(
    (k) => k in live && stableStringify(fromFile[k]) !== stableStringify(live[k]),
  );
  const out: string[] = [];
  if (missing.length) out.push(`${label}: у файлі є, у базі немає — ${missing.length}`);
  if (extra.length) out.push(`${label}: у базі є, у файлі немає — ${extra.length}`);
  if (changed.length) out.push(`${label}: відрізняються — ${changed.length}`);
  return out;
}

function yearFigures(data: BackupData, cfg: TaxYearConfig, emptySettings: YearSettings): string | null {
  const fx = {
    EUR: Object.fromEntries(Object.entries(data.fxRates).flatMap(([d, r]) => (r.EUR ? [[d, r.EUR]] : []))),
    USD: Object.fromEntries(Object.entries(data.fxRates).flatMap(([d, r]) => (r.USD ? [[d, r.USD]] : []))),
  };
  try {
    return stableStringify(calcYearFromDocuments(data.documents, data.settings ?? emptySettings, cfg, { fx }));
  } catch {
    return null;
  }
}

/**
 * Порівняння бекапу з поточними даними. Записи порівнюються в межах року файла, тож зайве за межами року
 * різницею не вважається. Якщо передано cfg, місячні суми з файла порівнюються з розрахунком року з усіх
 * поточних даних: так видно, що файл відтворює облік, а не лише сам себе.
 */
export function verifyBackup(
  backup: Backup,
  live: BackupData,
  options?: { cfg: TaxYearConfig; emptySettings: YearSettings },
): BackupVerification {
  const scoped = buildBackup(live, backup.year, new Date(backup.exportedAt));
  const differences = [
    ...diffRecords(
      'Документи',
      Object.fromEntries(backup.documents.map((d) => [d.id, withoutTouchedPeriods(d)])),
      Object.fromEntries(scoped.documents.map((d) => [d.id, d])),
    ),
    ...diffRecords('Еталон', backup.references, scoped.references),
    ...diffRecords('Місяці', backup.periods, scoped.periods),
    ...diffRecords('Правила контрагентів', backup.vendorRules, scoped.vendorRules),
    ...diffRecords('Категорії документів', backup.categoryOverrides, scoped.categoryOverrides),
    ...diffRecords('Курси NBP', backup.fxRates, scoped.fxRates),
  ];
  if (stableStringify(backup.settings) !== stableStringify(scoped.settings))
    differences.push('Налаштування року відрізняються');

  let figuresMatch: boolean | null = null;
  if (options) {
    const fromFile = yearFigures(backup, options.cfg, options.emptySettings);
    const fromLive = yearFigures(live, options.cfg, options.emptySettings);
    figuresMatch = fromFile !== null && fromFile === fromLive;
  }
  return { identical: differences.length === 0, differences, figuresMatch };
}
