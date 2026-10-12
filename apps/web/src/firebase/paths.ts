/** Шляхи Firestore за моделлю даних з ROADMAP.md. Усе користувацьке лежить під users/{uid}. */

export type Path = readonly string[];

const userRoot = (uid: string) => ['users', uid] as const;

export const paths = {
  settings: (uid: string, year: number): Path => [...userRoot(uid), 'settings', String(year)],
  documentsCollection: (uid: string): Path => [...userRoot(uid), 'documents'],
  document: (uid: string, id: string): Path => [...userRoot(uid), 'documents', id],
  fxRatesCollection: (uid: string): Path => [...userRoot(uid), 'fxRates'],
  fxRate: (uid: string, date: string): Path => [...userRoot(uid), 'fxRates', date],
};
