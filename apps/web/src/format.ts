/** Гроші ↔ злоті для інтерфейсу. Облік рахує в грошах; злоті з'являються лише на екрані. */

const pln = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: true });

/** 123456 → «1 234,56»: польський формат, тисячі через нерозривний пробіл */
export function formatPln(grosze: number): string {
  return pln.format(grosze / 100);
}

/** Різниця зі знаком: «+0,01», «−12,30», «0,00» */
export function formatDiff(grosze: number): string {
  if (grosze === 0) return formatPln(0);
  return `${grosze > 0 ? '+' : '−'}${formatPln(Math.abs(grosze))}`;
}

/**
 * Значення поля (злоті) → гроші, точно: число розбирається як десятковий запис, без множення float
 * (1.005 × 100 = 100.4999…). Третій знак після коми округлюється від половини вгору. Порожнє чи не число — null.
 */
export function toGrosze(value: number | string | null | undefined): number | null {
  if (value === '' || value === null || value === undefined) return null;
  const text = typeof value === 'number' ? String(value) : value.replace(/\s/g, '').replace(',', '.');
  const m = /^(-)?(\d+)(?:\.(\d*))?$/.exec(text);
  if (!m) return null;
  const decimals = (m[3] ?? '').padEnd(3, '0');
  const abs = Number(m[2]) * 100 + Number(decimals.slice(0, 2)) + (Number(decimals[2]) >= 5 ? 1 : 0);
  return m[1] && abs !== 0 ? -abs : abs;
}

/** Гроші → значення NumberInput; null — порожнє поле */
export function fromGrosze(grosze: number | null | undefined): number | '' {
  return grosze === null || grosze === undefined ? '' : grosze / 100;
}
