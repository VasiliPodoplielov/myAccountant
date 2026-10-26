import { describe, expect, it } from 'vitest';
import {
  cleanNotes,
  derivedFromLabel,
  diffStatus,
  fromReferenceForm,
  metricLabel,
  toReferenceForm,
} from './referenceForm';

describe('стан рядка звірки', () => {
  it('нульова різниця збігається, навіть якщо першопричина й наслідок компенсуються', () => {
    expect(diffStatus({ diff: 0, root: 50 }, undefined)).toBe('match');
  });
  it('уся різниця — наслідок: пояснення не потрібне', () => {
    expect(diffStatus({ diff: -50, root: 0 }, undefined)).toBe('derived');
  });
  it('першопричина без пояснення потребує його; з поясненням — пояснена', () => {
    expect(diffStatus({ diff: 2_000, root: 2_050 }, undefined)).toBe('unexplained');
    expect(diffStatus({ diff: 2_000, root: 2_050 }, '  ')).toBe('unexplained');
    expect(diffStatus({ diff: 2_000, root: 2_050 }, 'Постачальник вніс netto')).toBe('explained');
  });
});

describe('звідки наслідок', () => {
  it('місяці в родовому відмінку', () => {
    expect(derivedFromLabel([4, 6])).toBe('від квітня, червня');
    expect(derivedFromLabel([1])).toBe('від січня');
  });
  it('без джерел — порожньо', () => {
    expect(derivedFromLabel(undefined)).toBe('');
    expect(derivedFromLabel([])).toBe('');
  });
});

describe('форма еталона', () => {
  it('порожня форма — у еталоні нічого немає', () => {
    expect(fromReferenceForm(toReferenceForm(undefined))).toEqual({
      kpir: undefined,
      zus: undefined,
      pitAdvance: undefined,
    });
  });
  it('внесене зберігається без порожніх полів; нуль — це значення', () => {
    const ref = { kpir: { col9: 1_856_000, col15: 267_341 }, zus: { social: 0, fp: 0, health: 89_055 }, pitAdvance: 0 };
    expect(fromReferenceForm(toReferenceForm(ref))).toEqual(ref);
  });
});

describe('назви показників', () => {
  it('поля реєстрів і відомі показники', () => {
    expect(metricLabel('sales.K_19')).toBe('Реєстр продажу, K_19');
    expect(metricLabel('purchases.K_43')).toBe('Реєстр закупівлі, K_43');
    expect(metricLabel('vat.due')).toBe('VAT до сплати (P_51)');
    expect(metricLabel('kpir.col15')).toBe('KPiR, кол. 15: pozostałe wydatki');
  });
});

describe('пояснення', () => {
  it('порожні прибираються, решта обрізається', () => {
    expect(cleanNotes({ 'kpir.col15': ' Anthropic ', 'zus.health': '  ', pitAdvance: '' })).toEqual({
      'kpir.col15': 'Anthropic',
    });
  });
});
