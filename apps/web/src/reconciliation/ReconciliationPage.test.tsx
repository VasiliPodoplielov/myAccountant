// @vitest-environment jsdom
import { TAX_CONFIG, yearFigures, type LedgerDocument, type MonthReference, type YearSettings } from '@jdg/core';
import { MantineProvider } from '@mantine/core';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDomPolyfills } from '../test/domPolyfills';

type Doc = LedgerDocument & { id: string };

const cfg = TAX_CONFIG[2026]!;
const SETTINGS: YearSettings = {
  chorobowe: false,
  prevDecemberIncome: 1_500_000,
  prevDecemberContributions: null,
  contributionHolidayMonth: 2,
};
const pad = (m: number) => String(m).padStart(2, '0');

/** Вигаданий рік: продаж 20 000 zł щомісяця; `extra` — додаткова витрата 100 zł у квітні */
function docs(extra: boolean): Doc[] {
  const list: Doc[] = [];
  for (let m = 1; m <= 12; m++) {
    list.push({
      id: `s${m}`,
      kind: 'income',
      number: `FV ${m}/2026`,
      issueDate: `2026-${pad(m)}-28`,
      contractor: { name: 'Klient', nip: '5250000000', country: 'PL' },
      currency: 'PLN',
      lines: [{ net: 2_000_000, vatRate: '23' }],
      source: 'manual',
    });
  }
  if (extra) {
    list.push({
      id: 'x4',
      kind: 'cost',
      number: 'X 4/2026',
      issueDate: '2026-04-15',
      contractor: { name: 'Dostawca', nip: '1130000000', country: 'PL' },
      currency: 'PLN',
      category: 'other',
      lines: [{ net: 10_000, vatRate: 'zw' }],
      source: 'manual',
    });
  }
  return list;
}

const APP_DOCS = docs(true);
/** Еталон бухгалтера: той самий рік без квітневої витрати; VAT — як в обліку */
function references(): Record<string, MonthReference> {
  const app = yearFigures(APP_DOCS, SETTINGS, cfg);
  const acc = yearFigures(docs(false), SETTINGS, cfg);
  return Object.fromEntries(
    [4, 5, 6].map((m) => [
      `2026-${pad(m)}`,
      {
        vat: app[m - 1].vat,
        kpir: { col9: acc[m - 1].kpir.col9, col15: acc[m - 1].kpir.col15 },
        zus: acc[m - 1].zus,
        pitAdvance: acc[m - 1].pitAdvance,
      },
    ]),
  );
}

const mocks = vi.hoisted(() => ({
  references: {} as Record<string, unknown>,
  docs: [] as unknown[],
  settings: null as unknown,
  saveReferenceParts: vi.fn(),
}));

vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ state: { status: 'signedIn', user: { uid: 'u1' } } }) }));
vi.mock('../data/hooks', () => ({
  saveReferenceParts: mocks.saveReferenceParts,
  useDocuments: () => ({ status: 'ready', data: mocks.docs }),
  useYearSettings: () => ({ status: 'ready', data: mocks.settings }),
  useReferences: () => ({ status: 'ready', data: mocks.references }),
  useFxRates: () => ({ status: 'ready', data: {} }),
}));

import { ReconciliationPage } from './ReconciliationPage';

beforeAll(installDomPolyfills);
beforeEach(() => {
  mocks.docs = APP_DOCS;
  mocks.settings = SETTINGS;
  mocks.references = references();
  mocks.saveReferenceParts.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

function setup() {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(
    <MantineProvider>
      <MemoryRouter>
        <ReconciliationPage />
      </MemoryRouter>
    </MantineProvider>,
  );
  return user;
}

/** Кнопка місяця в акордеоні */
const monthControl = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name} 2026`) });
/** Рядок таблиці з показником у відкритій панелі місяця (чекає, поки панель розгорнеться) */
async function metricRow(label: RegExp): Promise<HTMLElement> {
  const rows = await screen.findAllByRole('row');
  return rows.find((r) => label.test(r.textContent ?? ''))!;
}

describe('звірка: першопричина й наслідок', () => {
  it('статуси місяців: першопричина в квітні, наслідки травня й червня звірені, решта без еталона', () => {
    setup();
    expect(within(monthControl('Квітень')).getByText('непояснених різниць: 1')).toBeTruthy();
    expect(within(monthControl('Травень')).getByText('звірено')).toBeTruthy();
    expect(within(monthControl('Червень')).getByText('звірено')).toBeTruthy();
    expect(within(monthControl('Березень')).getByText('немає еталона')).toBeTruthy();
  });

  it('квітень: різниця кол. 15 потребує пояснення', async () => {
    const user = setup();
    await user.click(monthControl('Квітень'));
    const row = await metricRow(/KPiR, кол\. 15/);
    expect(within(row).getByText('+100,00')).toBeTruthy();
    expect(within(row).getByLabelText('Пояснення: KPiR, кол. 15: pozostałe wydatki')).toBeTruthy();
  });

  it('червень: кол. 15 — наслідок квітня, поле пояснення не потрібне', async () => {
    const user = setup();
    await user.click(monthControl('Червень'));
    const row = await metricRow(/KPiR, кол\. 15/);
    expect(within(row).getAllByText('−4,90')).toHaveLength(2);
    expect(within(row).getByText('від квітня')).toBeTruthy();
    expect(within(row).getByText('Наслідок різниць KPiR, пояснення не потрібне')).toBeTruthy();
    expect(within(row).queryByRole('textbox')).toBeNull();
  });

  it('пояснення першопричини зберігається при втраті фокуса', async () => {
    const user = setup();
    await user.click(monthControl('Квітень'));
    await user.type(screen.getByLabelText('Пояснення: KPiR, кол. 15: pozostałe wydatki'), 'Бухгалтер вніс netto');
    await user.tab();
    expect(mocks.saveReferenceParts).toHaveBeenCalledWith(
      'u1',
      '2026-04',
      { notes: { 'kpir.col15': 'Бухгалтер вніс netto' } },
      ['notes'],
    );
  });

  it('еталон без zaliczki: місяць неповний, пояснено чого бракує', async () => {
    const refs = references();
    delete refs['2026-05'].pitAdvance;
    mocks.references = refs;
    const user = setup();
    expect(within(monthControl('Травень')).getByText('еталон неповний')).toBeTruthy();
    await user.click(monthControl('Травень'));
    expect(screen.getByText(/Немає: zaliczka PIT\./)).toBeTruthy();
  });
});
