/**
 * Точна арифметика грошей. Суми — цілі найменші одиниці (гроші, центи).
 * Округлення «від половини вгору» за модулем: końcówki poniżej 0,5 grosza pomija się,
 * od 0,5 grosza zaokrągla się do 1 grosza (art. 106e ust. 11 ustawy o VAT).
 * Множення йде через BigInt: у float половина гроша губиться (1.005 × 100 = 100.49999…).
 */

/** Ставки, частки й курси зводяться до дробу з цим знаменником: 6 знаків після коми */
const RATE_SCALE = 1_000_000;

/** round(amount × num / den). amount, num, den — цілі; num ≥ 0, den > 0. Не цілі числа дають RangeError. */
export function mulDiv(amount: number, num: number, den: number): number {
  const n = BigInt(Math.abs(amount)) * BigInt(num);
  const d = BigInt(den);
  const q = Number((2n * n + d) / (2n * d));
  // -q || 0: без «мінус нуля» для від'ємної суми, що округлилася до нуля
  return amount < 0 ? -q || 0 : q;
}

/** amount × rate, де rate — частка (0.23, 0.5) або курс (4.3775); у rate враховується 6 знаків після коми */
export function mulRate(amount: number, rate: number): number {
  return mulDiv(amount, Math.round(rate * RATE_SCALE), RATE_SCALE);
}

/**
 * До повних злотих: końcówki poniżej 50 groszy pomija się, 50 i więcej groszy podwyższa się
 * do pełnych złotych (art. 63 § 1 Ordynacji podatkowej). Так округлюється кожна позиція декларації.
 */
export function toFullZloty(grosze: number): number {
  return mulDiv(grosze, 1, 100) * 100;
}
