import { describe, expect, it } from 'vitest';
import { cleanNotes, fromReferenceForm, metricLabel, toReferenceForm } from './referenceForm';

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
