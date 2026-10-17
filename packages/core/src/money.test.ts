import { describe, expect, it } from 'vitest';
import { mulDiv, mulRate, toFullZloty } from './money';

describe('округлення грошей', () => {
  it('половина гроша округлюється вгору, менше половини відкидається', () => {
    expect(mulDiv(1, 1, 2)).toBe(1); // 0,5
    expect(mulDiv(149, 1, 100)).toBe(1); // 1,49
    expect(mulDiv(150, 1, 100)).toBe(2); // 1,50
    expect(mulDiv(0, 23, 100)).toBe(0);
  });
  it("від'ємні суми округлюються дзеркально, без «мінус нуля»", () => {
    expect(mulDiv(-1, 1, 2)).toBe(-1);
    expect(mulDiv(-149, 1, 100)).toBe(-1);
    expect(mulDiv(-1, 1, 3)).toBe(0);
  });
  it('не губить половину гроша у float', () => {
    expect(Math.round(100 * 1.005)).toBe(100); // 100.49999999999999
    expect(mulRate(100, 1.005)).toBe(101);
  });
  it('ставка VAT і курс NBP', () => {
    expect(mulRate(350, 0.23)).toBe(81); // 80,5
    expect(mulRate(10_000, 4.3775)).toBe(43_775);
    expect(mulRate(2, 4.25)).toBe(9); // 8,5
    expect(mulRate(12_345, 1)).toBe(12_345);
  });
  it('великі суми рахуються точно', () => {
    const exact = Number((2n * 99_999_999_999n * 4_999_999n + 1_000_000n) / 2_000_000n);
    expect(mulRate(99_999_999_999, 4.999999)).toBe(exact);
  });
  it('неціла сума — виняток, а не тихе округлення', () => {
    expect(() => mulDiv(10.5, 1, 2)).toThrow(RangeError);
  });
});

describe('до повних злотих', () => {
  it('менше 50 groszy відкидається, 50 і більше — до злотого', () => {
    expect(toFullZloty(0)).toBe(0);
    expect(toFullZloty(49)).toBe(0);
    expect(toFullZloty(50)).toBe(100);
    expect(toFullZloty(149)).toBe(100);
    expect(toFullZloty(150)).toBe(200);
  });
  it("від'ємна сума (коригування) — дзеркально", () => {
    expect(toFullZloty(-49)).toBe(0);
    expect(toFullZloty(-50)).toBe(-100);
  });
});
