import type { YearSettings } from '@jdg/core';
import { fromGrosze, toGrosze } from '../format';

/** Поля форми налаштувань року: суми — у злотих, як їх показує NumberInput */
export interface SettingsForm {
  chorobowe: boolean;
  prevDecemberIncome: number | '';
  prevDecemberSocial: number | '';
  prevDecemberFp: number | '';
  prevDecemberHealth: number | '';
  /** '' — без wakacji składkowych, інакше номер місяця рядком (для Select) */
  contributionHolidayMonth: string;
  healthAsCost: boolean;
  openingVatCarry: number | '';
}

export function toSettingsForm(s: YearSettings | null): SettingsForm {
  return {
    chorobowe: s?.chorobowe ?? false,
    prevDecemberIncome: fromGrosze(s?.prevDecemberIncome),
    prevDecemberSocial: fromGrosze(s?.prevDecemberContributions?.social),
    prevDecemberFp: fromGrosze(s?.prevDecemberContributions?.fp),
    prevDecemberHealth: fromGrosze(s?.prevDecemberContributions?.health),
    contributionHolidayMonth: s?.contributionHolidayMonth ? String(s.contributionHolidayMonth) : '',
    healthAsCost: s?.healthAsCost ?? true,
    openingVatCarry: s?.openingVatCarry ? fromGrosze(s.openingVatCarry) : '',
  };
}

export type SettingsFormResult = { ok: true; settings: YearSettings } | { ok: false; error: string };

export function fromSettingsForm(f: SettingsForm): SettingsFormResult {
  const contributions = [f.prevDecemberSocial, f.prevDecemberFp, f.prevDecemberHealth].map(toGrosze);
  const filled = contributions.filter((c) => c !== null).length;
  if (filled !== 0 && filled !== 3) {
    return { ok: false, error: 'Składki за грудень: заповніть усі три суми або жодної' };
  }
  const [social, fp, health] = contributions;
  const amounts = [toGrosze(f.prevDecemberIncome), ...contributions, toGrosze(f.openingVatCarry)];
  if (amounts.some((a) => a !== null && a < 0)) return { ok: false, error: "Суми не можуть бути від'ємними" };

  const settings: YearSettings = {
    chorobowe: f.chorobowe,
    prevDecemberIncome: toGrosze(f.prevDecemberIncome),
    prevDecemberContributions: filled === 3 ? { social: social!, fp: fp!, health: health! } : null,
    contributionHolidayMonth: f.contributionHolidayMonth ? Number(f.contributionHolidayMonth) : null,
    healthAsCost: f.healthAsCost,
  };
  const carry = toGrosze(f.openingVatCarry);
  if (carry) settings.openingVatCarry = carry;
  return { ok: true, settings };
}

/** Налаштування, з якими рахується рік, поки їх не заповнено */
export const EMPTY_SETTINGS: YearSettings = {
  chorobowe: false,
  prevDecemberIncome: null,
  prevDecemberContributions: null,
};
