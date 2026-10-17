/** Дата 'YYYY-MM-DD', що реально існує: 2026-02-31 відсіюється (Date мовчки зсунув би її на 3 березня) */
export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}
