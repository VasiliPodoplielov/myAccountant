import { describe, expect, it } from 'vitest';
import { fromSettingsForm, toSettingsForm } from './settingsForm';

describe('форма налаштувань року', () => {
  it('порожні налаштування: типові значення', () => {
    expect(toSettingsForm(null)).toEqual({
      chorobowe: false,
      prevDecemberIncome: '',
      prevDecemberSocial: '',
      prevDecemberFp: '',
      prevDecemberHealth: '',
      contributionHolidayMonth: '',
      healthAsCost: true,
      openingVatCarry: '',
    });
    expect(fromSettingsForm(toSettingsForm(null))).toEqual({
      ok: true,
      settings: {
        chorobowe: false,
        prevDecemberIncome: null,
        prevDecemberContributions: null,
        contributionHolidayMonth: null,
        healthAsCost: true,
      },
    });
  });
  it('налаштування 2026 проходять форму без змін', () => {
    const settings = {
      chorobowe: false,
      prevDecemberIncome: 1_612_451,
      prevDecemberContributions: { social: 164_982, fp: 13_847, health: 79_010 },
      contributionHolidayMonth: 2,
      healthAsCost: true,
      openingVatCarry: 12_300,
    };
    expect(fromSettingsForm(toSettingsForm(settings))).toEqual({ ok: true, settings });
  });
  it('składki за грудень — усі три або жодної', () => {
    const form = { ...toSettingsForm(null), prevDecemberSocial: 1649.82 };
    expect(fromSettingsForm(form)).toMatchObject({ ok: false, error: expect.stringMatching(/усі три/) });
  });
  it("від'ємна сума — помилка", () => {
    expect(fromSettingsForm({ ...toSettingsForm(null), openingVatCarry: -1 })).toMatchObject({ ok: false });
  });
});
