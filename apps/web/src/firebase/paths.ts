/** Шляхи Firestore за моделлю даних з ROADMAP.md. Усе користувацьке лежить під users/{uid}. */

export type Path = readonly string[];

const userRoot = (uid: string) => ['users', uid] as const;

export const paths = {
  settings: (uid: string, year: number): Path => [...userRoot(uid), 'settings', String(year)],
  documentsCollection: (uid: string): Path => [...userRoot(uid), 'documents'],
  document: (uid: string, id: string): Path => [...userRoot(uid), 'documents', id],
  fxRatesCollection: (uid: string): Path => [...userRoot(uid), 'fxRates'],
  fxRate: (uid: string, date: string): Path => [...userRoot(uid), 'fxRates', date],
  referenceCollection: (uid: string): Path => [...userRoot(uid), 'reference'],
  /** Еталон бухгалтера за місяць 'YYYY-MM' */
  reference: (uid: string, period: string): Path => [...userRoot(uid), 'reference', period],
  vendorRulesCollection: (uid: string): Path => [...userRoot(uid), 'vendorRules'],
  /** Правило контрагента; ключ (NIP або назва) кодується, бо '/' в id документа заборонений */
  vendorRule: (uid: string, key: string): Path => [...userRoot(uid), 'vendorRules', encodeURIComponent(key)],
};
