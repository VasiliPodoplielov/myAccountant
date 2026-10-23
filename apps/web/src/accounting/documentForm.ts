import {
  CATEGORY_RULES,
  documentDates,
  documentIssues,
  isIsoDate,
  type CostCategory,
  type Currency,
  type DocumentIssue,
  type LedgerDocument,
  type VatRateCode,
} from '@jdg/core';
import { toGrosze } from '../format';

export type FormKind = 'cost' | 'income';

/** Поля форми «Додати документ»: суми — у одиницях валюти (злоті, євро), як їх показує NumberInput */
export interface DocumentForm {
  kind: FormKind;
  number: string;
  issueDate: string;
  contractorName: string;
  contractorNip: string;
  country: string;
  currency: Currency;
  net: number | '';
  vatRate: VatRateCode;
  /** VAT з фактури, PLN; порожньо — рахується від netto за ставкою */
  vat: number | '';
  category: CostCategory;
  description: string;
  /** Дата продажу чи виконання послуги */
  saleDate: string;
  paidAt: string;
  ksefNumber: string;
  periodicSettlement: boolean;
}

export function emptyForm(today: string): DocumentForm {
  return {
    kind: 'cost',
    number: '',
    issueDate: today,
    contractorName: '',
    contractorNip: '',
    country: 'PL',
    currency: 'PLN',
    net: '',
    vatRate: '23',
    vat: '',
    category: 'other',
    description: '',
    saleDate: '',
    paidAt: '',
    ksefNumber: '',
    periodicSettlement: false,
  };
}

// ---------------------------------------------------------------- presets

export interface Preset {
  id: string;
  label: string;
  patch: Partial<DocumentForm>;
}

/**
 * Швидкі кнопки: заповнюють усе, крім номера, дати й суми.
 * «Claude (EUR)»: рахунок Anthropic виставлений приватній особі без NIP, з польським VAT 23%, який не
 * відлічується. За рішенням бухгалтера (2026-10-23) у koszty йде netto без цього VAT: витрата «Інше» зі ставкою np.
 */
export const PRESETS: Preset[] = [
  {
    id: 'fuel',
    label: 'Паливо',
    patch: {
      kind: 'cost',
      category: 'carMixed',
      currency: 'PLN',
      country: 'PL',
      vatRate: '23',
      description: 'Paliwo',
    },
  },
  {
    id: 'claude',
    label: 'Claude (EUR)',
    patch: {
      kind: 'cost',
      category: 'other',
      currency: 'EUR',
      country: 'US',
      vatRate: 'np',
      vat: '',
      contractorName: 'Anthropic, PBC',
      description: 'Subskrypcja Claude Pro',
    },
  },
  {
    id: 'office',
    label: 'Офіс',
    patch: {
      kind: 'cost',
      category: 'office',
      currency: 'PLN',
      country: 'PL',
      vatRate: '23',
      description: 'Wyposażenie biura',
    },
  },
];

/** Пресет перезаписує лише свої поля; введені номер, дата й сума лишаються */
export function applyPreset(form: DocumentForm, preset: Preset): DocumentForm {
  return { ...form, ...preset.patch };
}

/** Зміна виду документа скидає поля, що мають сенс лише для іншого виду */
export function switchKind(form: DocumentForm, kind: FormKind): DocumentForm {
  if (form.kind === kind) return form;
  return { ...form, kind, category: 'other', periodicSettlement: false };
}

/** Import usług: фактура без VAT, платник нараховує його сам */
export function isReverseCharge(form: DocumentForm): boolean {
  return form.kind === 'cost' && CATEGORY_RULES[form.category].reverseCharge;
}

// ---------------------------------------------------------------- form → document

export type FormResult = { ok: true; doc: LedgerDocument } | { ok: false; error: string };

const ISSUE_TEXT: Record<DocumentIssue, string> = {
  number: 'Вкажіть номер документа',
  date: 'Некоректна дата',
  saleDate: 'Для розрахункового періоду вкажіть кінець періоду (дата продажу)',
  contractor: 'Вкажіть контрагента і двобуквений код країни (наприклад, PL)',
  lines: 'Немає позицій',
  amount: 'Некоректна сума',
  vat: 'Для цієї ставки VAT на фактурі має бути нуль',
  fxRate: 'Некоректний курс',
  ksef: 'Номер KSeF і позначка разом не бувають',
  reverseCharge: 'Import usług не може бути від польського контрагента',
  payment: 'Некоректна оплата',
};

/**
 * Документ із форми. Порожні необов'язкові поля в документ не потрапляють: Firestore не приймає undefined.
 * Дати перевіряються тут, а не лише в documentIssues, щоб повідомлення було про конкретне поле.
 */
export function fromDocumentForm(f: DocumentForm): FormResult {
  const net = toGrosze(f.net);
  if (net === null) return { ok: false, error: 'Вкажіть суму netto' };
  if (net === 0) return { ok: false, error: 'Сума netto не може бути нульовою' };
  if (net < 0) return { ok: false, error: "Сума netto не може бути від'ємною" };

  const reverse = isReverseCharge(f);
  const vat = reverse ? null : toGrosze(f.vat);
  if (vat !== null && vat < 0) return { ok: false, error: "VAT не може бути від'ємним" };

  for (const [label, value, required] of [
    ['дата виставлення', f.issueDate, true],
    ['дата продажу', f.saleDate, false],
    ['дата оплати', f.paidAt, false],
  ] as const) {
    if (!value ? required : !isIsoDate(value)) {
      return { ok: false, error: `Некоректна ${label}` };
    }
  }

  const nip = f.contractorNip.replace(/[\s-]/g, '');
  const description = f.description.trim();
  const ksefNumber = f.ksefNumber.trim();
  const common = {
    number: f.number.trim(),
    issueDate: f.issueDate,
    ...(description && { description }),
    source: 'manual' as const,
    contractor: {
      name: f.contractorName.trim(),
      country: f.country.trim().toUpperCase(),
      ...(nip && { nip }),
    },
    lines: [{ net, vatRate: f.vatRate, ...(vat !== null && { vat }) }],
    currency: f.currency,
    ...(f.saleDate && { saleDate: f.saleDate }),
    ...(ksefNumber && { ksefNumber }),
    ...(f.paidAt && { paidAt: f.paidAt }),
  };

  const doc: LedgerDocument =
    f.kind === 'income'
      ? { kind: 'income', ...common, ...(f.periodicSettlement && { periodicSettlement: true }) }
      : { kind: 'cost', category: f.category, ...common };

  const [issue] = documentIssues(doc);
  return issue ? { ok: false, error: ISSUE_TEXT[issue] } : { ok: true, doc };
}

// ---------------------------------------------------------------- fx range

const DAY_MS = 86_400_000;

/** Запас днів перед найранішою датою: курс береться з останнього робочого дня, а свята бувають довгими */
const FX_LOOKBACK_DAYS = 14;

const shiftDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/**
 * Період, за який треба мати курси NBP, щоб порахувати валютний документ: від найранішої дати події
 * (з запасом на вихідні й свята) до найпізнішої, включно з оплатою. null — документ у PLN.
 */
export function fxRange(doc: LedgerDocument): { from: string; to: string } | null {
  if (doc.kind === 'internal' || doc.currency === 'PLN') return null;
  const dates = documentDates(doc);
  const all = [dates.pit, dates.vat, doc.issueDate, doc.saleDate, doc.paidAt].filter(
    (d) => d !== undefined && d !== null,
  );
  const sorted = [...all].sort();
  return { from: shiftDays(sorted[0]!, -FX_LOOKBACK_DAYS), to: sorted.at(-1)! };
}

/**
 * Новий id документа, внесеного вручну. getRandomValues, а не randomUUID: randomUUID є лише в захищеному
 * контексті (https, localhost), а форму відкривають і з телефона на dev-сервері за http.
 */
export function newDocumentId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `manual-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
