import { describe, expect, it } from 'vitest';
import { groszeToCsv, toCsv } from './csv';

describe('toCsv', () => {
  it('екранує крапку з комою, лапки й переноси', () => {
    expect(
      toCsv(
        ['a', 'b'],
        [
          ['x;y', 'He said "hi"'],
          ['line\nbreak', null],
        ],
      ),
    ).toBe('a;b\r\n"x;y";"He said ""hi"""\r\n"line\nbreak";\r\n');
  });

  it('нейтралізує формули, але не чіпає числа', () => {
    expect(toCsv(['a'], [['=SUM(A1)'], ['@cmd'], ['+1 firma'], ['-12.50'], ['-x'], [5]])).toBe(
      "a\r\n'=SUM(A1)\r\n'@cmd\r\n'+1 firma\r\n-12.50\r\n'-x\r\n5\r\n",
    );
  });

  it('порожній набір рядків дає лише заголовок', () => {
    expect(toCsv(['a'], [])).toBe('a\r\n');
  });
});

describe('groszeToCsv', () => {
  it.each([
    [0, '0.00'],
    [5, '0.05'],
    [123456, '1234.56'],
    [-79918, '-799.18'],
    [-5, '-0.05'],
  ])('%i → %s', (grosze, text) => {
    expect(groszeToCsv(grosze)).toBe(text);
  });
});
