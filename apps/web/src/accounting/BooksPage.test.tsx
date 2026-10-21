// @vitest-environment jsdom
import type { LedgerDocument, MonthResult } from '@jdg/core';
import { MantineProvider } from '@mantine/core';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDomPolyfills } from '../test/domPolyfills';

type Doc = LedgerDocument & { id: string };

const mocks = vi.hoisted(() => ({
  docs: [] as unknown[],
  results: null as unknown[] | null,
  hasSettings: true,
  downloadCsv: vi.fn(),
}));

vi.mock('./useLedgerYear', () => ({
  useLedgerYear: () => ({
    status: 'ready',
    docs: mocks.docs,
    fx: { EUR: {}, USD: {} },
    hasSettings: mocks.hasSettings,
    results: mocks.results,
    error: mocks.results ? null : 'Помилка розрахунку',
  }),
}));
vi.mock('../csv', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../csv')>()),
  downloadCsv: mocks.downloadCsv,
}));

import { BooksPage } from './BooksPage';

const contractor = { name: 'Firma Testowa', nip: '1111111111', country: 'PL' };
const sale: Doc = {
  id: 's1',
  kind: 'income',
  number: 'FV 1/10',
  issueDate: '2026-10-05',
  contractor,
  currency: 'PLN',
  lines: [{ net: 1_000_000, vatRate: '23', vat: 230_000 }],
  source: 'import',
};
const cost: Doc = {
  id: 'c1',
  kind: 'cost',
  category: 'office',
  number: 'F 7/10',
  issueDate: '2026-10-06',
  contractor,
  currency: 'PLN',
  lines: [{ net: 10_000, vatRate: '23', vat: 2_300 }],
  source: 'import',
};

beforeAll(installDomPolyfills);
beforeEach(() => {
  mocks.docs = [sale, cost];
  // composite results не потрібні для документів; składki в тесті окремо не перевіряємо
  mocks.results = [] as MonthResult[];
  mocks.hasSettings = true;
  mocks.downloadCsv.mockReset();
});
afterEach(cleanup);

function setup(path = '/books/2026/10') {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(
    <MantineProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/books/:year/:month" element={<BooksPage />} />
          <Route path="/" element={<div>Рік</div>} />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );
  return user;
}

describe('екран KPiR і реєстрів VAT', () => {
  it('показує KPiR місяця з документами й підсумками', () => {
    setup();
    const table = screen.getByRole('table', { name: 'KPiR' });
    expect(within(table).getByText('FV 1/10')).toBeTruthy();
    expect(within(table).getByText('F 7/10')).toBeTruthy();
    expect(within(table).getAllByText('PL1111111111 · Firma Testowa')).toHaveLength(2);
    expect(within(table).getByText('Razem miesiąc')).toBeTruthy();
    expect(within(table).getByText('Razem od początku roku')).toBeTruthy();
  });

  it('вкладка продажу показує поля K_19/K_20 і VAT należny', async () => {
    const user = setup();
    await user.click(screen.getByRole('tab', { name: /Rejestr sprzedaży/ }));
    const table = screen.getByRole('table', { name: 'Rejestr sprzedaży' });
    expect(within(table).getByText('FV 1/10')).toBeTruthy();
    expect(within(table).getByText(/K 19/)).toBeTruthy();
    expect(within(table).getByText(/K 20/)).toBeTruthy();
    expect(within(table).getAllByText('2 300,00')).toHaveLength(2); // рядок і Razem
    expect(screen.getByText(/VAT należny до декларації/)).toBeTruthy();
  });

  it('вкладка закупівлі показує K_42/K_43', async () => {
    const user = setup();
    await user.click(screen.getByRole('tab', { name: /Rejestr zakupu/ }));
    const table = screen.getByRole('table', { name: 'Rejestr zakupu' });
    expect(within(table).getByText('F 7/10')).toBeTruthy();
    expect(within(table).getByText(/K 42/)).toBeTruthy();
    expect(within(table).getByText(/K 43/)).toBeTruthy();
  });

  it('порожній місяць: повідомлення замість таблиць, кнопки експорту немає', async () => {
    const user = setup('/books/2026/3');
    expect(screen.getByText('За цей місяць записів KPiR немає.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Експорт CSV' })).toBeNull();
    await user.click(screen.getByRole('tab', { name: /Rejestr sprzedaży/ }));
    expect(screen.getByText('За цей місяць у реєстрі продажу записів немає.')).toBeTruthy();
  });

  it('експорт KPiR викликає завантаження файла з місяцем у назві', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Експорт CSV' }));
    expect(mocks.downloadCsv).toHaveBeenCalledTimes(1);
    expect(mocks.downloadCsv.mock.calls[0][0]).toBe('kpir-2026-10.csv');
    expect(mocks.downloadCsv.mock.calls[0][1]).toContain('FV 1/10');
  });

  it('без розрахунку року попереджає, що книга неповна', () => {
    mocks.results = null;
    setup();
    expect(screen.getByText(/книга неповна/)).toBeTruthy();
  });

  it('без налаштувань року попереджає й веде на «Налаштування»', () => {
    mocks.hasSettings = false;
    setup();
    expect(screen.getByText('Налаштування року не заповнені')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Заповнити' }).getAttribute('href')).toBe('/settings');
  });

  it('неправильна адреса веде на головну', () => {
    setup('/books/2026/13');
    expect(screen.getByText('Рік')).toBeTruthy();
  });
});
