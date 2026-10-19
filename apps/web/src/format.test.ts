import { describe, expect, it } from 'vitest';
import { formatDiff, formatPln, fromGrosze, toGrosze } from './format';

// Intl пише нерозривний пробіл між тисячами: порівнюємо зі звичайним
const plain = (s: string) => s.replace(/\s/g, ' ');

describe('формат сум', () => {
  it('гроші в злоті з польським розділювачем', () => {
    expect(formatPln(0)).toBe('0,00');
    expect(formatPln(5)).toBe('0,05');
    expect(plain(formatPln(1_856_000))).toBe('18 560,00');
    expect(plain(formatPln(-123_456))).toBe('-1 234,56');
  });
  it('різниця зі знаком', () => {
    expect(formatDiff(1)).toBe('+0,01');
    expect(formatDiff(-1_230)).toBe('−12,30');
    expect(formatDiff(0)).toBe('0,00');
  });
  it('значення поля в гроші і назад', () => {
    expect(toGrosze(12.3)).toBe(1_230);
    expect(toGrosze(1.005)).toBe(101);
    expect(toGrosze('1 234,56')).toBe(123_456);
    expect(toGrosze('')).toBeNull();
    expect(toGrosze(null)).toBeNull();
    expect(toGrosze('abc')).toBeNull();
    expect(toGrosze(-0.5)).toBe(-50);
    expect(toGrosze('7')).toBe(700);
    expect(toGrosze(1e21)).toBeNull();
    expect(fromGrosze(123_456)).toBe(1234.56);
    expect(fromGrosze(null)).toBe('');
    expect(fromGrosze(0)).toBe(0);
  });
});
