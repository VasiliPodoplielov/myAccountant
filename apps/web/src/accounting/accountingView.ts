import {
  jpkPeriod,
  documentDates,
  shiftedDueDates,
  valueDocument,
  type FxTables,
  type LedgerDocument,
  type MonthResult,
} from '@jdg/core';

/** Підсумок року: суми місяців; надвишку VAT і накопичувані показники не складаємо */
export interface YearTotals {
  income: number;
  costs: number;
  vatDue: number;
  zus: number;
  health: number;
  pitAdvance: number;
  totalToPay: number;
  netCash: number;
  missingFxRates: number;
}

/**
 * Koszty місяця, як у KPiR (кол. 15): koszty PIT із документів плюс FP і zdrowotna в kosztach, сплачені
 * в цьому місяці. Саме цю суму порівнює «Звірка».
 */
export const kpirCosts = (r: MonthResult): number => r.pitCosts + r.fpPaid + r.healthInCosts;

export function yearTotals(results: readonly MonthResult[]): YearTotals {
  const total: YearTotals = {
    income: 0,
    costs: 0,
    vatDue: 0,
    zus: 0,
    health: 0,
    pitAdvance: 0,
    totalToPay: 0,
    netCash: 0,
    missingFxRates: 0,
  };
  for (const r of results) {
    total.income += r.income;
    total.costs += kpirCosts(r);
    total.vatDue += r.vatDue;
    total.zus += r.zusTotal;
    total.health += r.health;
    total.pitAdvance += r.pitAdvance;
    total.totalToPay += r.totalToPay;
    total.netCash += r.netCash;
    total.missingFxRates += r.missingFxRates;
  }
  return total;
}

export interface Payment {
  key: 'zus' | 'health' | 'pit' | 'vat';
  label: string;
  amount: number;
  /** Термін сплати з перенесенням з вихідних і свят, 'YYYY-MM-DD' */
  due: string;
  /** Чому термін перенесено з 20-го чи 25-го; null — не переносився */
  shiftedFrom: string | null;
}

/**
 * Що і до якого числа платити за місяць (ZUS, zdrowotna, PIT — до 20-го M+1; VAT — до 25-го).
 * Термін, що припав на суботу, неділю чи свято, переноситься на наступний робочий день.
 */
export function monthPayments(year: number, result: MonthResult): Payment[] {
  const due = shiftedDueDates(year, result.month);
  const payment = (key: Payment['key'], label: string, amount: number): Payment => ({
    key,
    label,
    amount,
    due: due[key].due,
    shiftedFrom: due[key].reason ? due[key].nominal : null,
  });
  return [
    payment('zus', 'ZUS: społeczne + FP', result.zusTotal),
    payment('health', 'ZUS: zdrowotna', result.health),
    payment('pit', 'Zaliczka PIT', result.pitAdvance),
    payment('vat', 'VAT (JPK_V7M)', result.vatDue),
  ];
}

export interface DeadlineGroup {
  /** Термін, 'YYYY-MM-DD' */
  due: string;
  /** Дата за правилом, якщо термін перенесено; null — не переносився */
  shiftedFrom: string | null;
  /** Причина перенесення: «sobota», «niedziela» чи назва свята */
  reason: string | null;
  /** Термін уже минув відносно `today` */
  past: boolean;
  payments: (Payment & { month: number })[];
  total: number;
}

/**
 * Календар року: платежі всіх місяців, згруповані за фактичним терміном. Платежі за грудень потрапляють
 * у січень наступного року. Нульові суми лишаються: термін настає, навіть якщо платити нічого.
 */
export function yearDeadlines(year: number, results: readonly MonthResult[], today: string): DeadlineGroup[] {
  const groups = new Map<string, DeadlineGroup>();
  for (const result of results) {
    const shifted = shiftedDueDates(year, result.month);
    for (const p of monthPayments(year, result)) {
      const group = groups.get(p.due) ?? {
        due: p.due,
        shiftedFrom: p.shiftedFrom,
        reason: shifted[p.key].reason,
        past: p.due < today,
        payments: [],
        total: 0,
      };
      group.payments.push({ ...p, month: result.month });
      group.total += p.amount;
      groups.set(p.due, group);
    }
  }
  return [...groups.values()].sort((a, b) => a.due.localeCompare(b.due));
}

export interface MonthDocumentRow {
  id: string;
  kind: LedgerDocument['kind'];
  number: string;
  /** Назва контрагента; для внутрішнього документа — порожньо */
  contractor: string;
  description?: string;
  pitDate: string;
  vatDate: string | null;
  /** Przychód (дохід) або koszt PIT; для внутрішнього — сума зі знаком колонки (10 — дохід, 15 — витрата) */
  pitAmount: number | null;
  /** VAT документа; null — немає */
  vat: number | null;
  /** Документ потрапляє в KPiR цього місяця (за датою PIT) */
  inKpir: boolean;
  /** Документ потрапляє в реєстр VAT цього місяця */
  inVat: boolean;
  /** Валютний документ без курсу: не враховано в сумах */
  missingFx: boolean;
  /** Внесений вручну: лише такі можна видаляти в застосунку (імпорт з JPK перезаписується повторним імпортом) */
  deletable: boolean;
}

/**
 * Документи, що стосуються місяця: за датою події для PIT (KPiR) або за датою VAT (реєстр).
 * Від найранішої дати до найпізнішої.
 */
export function monthDocuments(
  docs: readonly (LedgerDocument & { id: string })[],
  year: number,
  month: number,
  fx: FxTables = {},
): MonthDocumentRow[] {
  const key = jpkPeriod({ year, month });
  const rows: MonthDocumentRow[] = [];
  for (const doc of docs) {
    const dates = documentDates(doc);
    const inKpir = dates.pit.startsWith(key);
    const inVat = dates.vat?.startsWith(key) ?? false;
    if (!inKpir && !inVat) continue;

    const base = {
      id: doc.id,
      kind: doc.kind,
      number: doc.number,
      description: doc.description,
      pitDate: dates.pit,
      vatDate: dates.vat,
      inKpir,
      inVat,
      deletable: doc.source === 'manual',
    };
    if (doc.kind === 'internal') {
      rows.push({
        ...base,
        contractor: '',
        pitAmount: doc.column === 10 ? doc.amount : -doc.amount,
        vat: null,
        missingFx: false,
      });
      continue;
    }
    const value = valueDocument(doc, fx);
    rows.push({
      ...base,
      contractor: doc.contractor.name,
      pitAmount: value?.pitAmount ?? null,
      vat: value ? value.vat : null,
      missingFx: value === null,
    });
  }
  return rows.sort((a, b) => a.pitDate.localeCompare(b.pitDate) || a.number.localeCompare(b.number));
}

/** Дата за місцевим часом, 'YYYY-MM-DD': toISOString дав би UTC і до 02:00 влітку показав би вчорашню дату */
export function localIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const localToday = () => localIsoDate(new Date());

/** 'YYYY-MM-DD' → «20/11/2026» */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** «20/11/2026» → 'YYYY-MM-DD'; null, якщо запис не відповідає формату dd/mm/yyyy */
export function parseDate(text: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}
