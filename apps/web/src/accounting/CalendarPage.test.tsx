// @vitest-environment jsdom
import { calcYearFromDocuments, TAX_CONFIG } from '@jdg/core';
import { MantineProvider } from '@mantine/core';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_SETTINGS } from '../settings/settingsForm';
import { installDomPolyfills } from '../test/domPolyfills';

const mocks = vi.hoisted(() => ({ results: null as unknown, error: null as string | null }));

vi.mock('./useLedgerYear', () => ({
  useLedgerYear: () => ({
    status: 'ready',
    docs: [],
    fx: { EUR: {}, USD: {} },
    periods: {},
    hasSettings: true,
    results: mocks.results,
    error: mocks.error,
  }),
}));

import { CalendarPage } from './CalendarPage';

const emptyYear = () => calcYearFromDocuments([], EMPTY_SETTINGS, TAX_CONFIG[2026]!);

beforeAll(installDomPolyfills);
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 22, 12, 0)); // 22.10.2026, четвер
  mocks.results = emptyYear();
  mocks.error = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup() {
  render(
    <MantineProvider>
      <MemoryRouter>
        <CalendarPage />
      </MemoryRouter>
    </MantineProvider>,
  );
}

describe('календар термінів', () => {
  it('платежі згруповані за терміном: 20-те (ZUS, zdrowotna, PIT) і 25-те (VAT)', () => {
    setup();
    const nov20 = screen.getByLabelText('Термін 20/11/2026');
    expect(within(nov20).getByText('ZUS: społeczne + FP')).toBeTruthy();
    expect(within(nov20).getByText('ZUS: zdrowotna')).toBeTruthy();
    expect(within(nov20).getByText('Zaliczka PIT')).toBeTruthy();
    expect(within(nov20).queryByText('VAT (JPK_V7M)')).toBeNull();
    expect(within(screen.getByLabelText('Термін 25/11/2026')).getByText('VAT (JPK_V7M)')).toBeTruthy();
  });

  it('термін, що припав на неділю, перенесено на понеділок з поясненням', () => {
    setup();
    const group = screen.getByLabelText('Термін 21/09/2026');
    expect(within(group).getByText('перенесено з 20/09/2026 (niedziela)')).toBeTruthy();
    expect(screen.queryByLabelText('Термін 20/09/2026')).toBeNull();
  });

  it('VAT 25.10.2026 (неділя) → 26.10', () => {
    setup();
    expect(within(screen.getByLabelText('Термін 26/10/2026')).getByText(/перенесено з 25\/10\/2026/)).toBeTruthy();
  });

  it('минулі терміни позначені, найближчий — один', () => {
    setup();
    expect(within(screen.getByLabelText('Термін 20/10/2026')).getByText('минув')).toBeTruthy();
    expect(within(screen.getByLabelText('Термін 26/10/2026')).getByText('найближчий')).toBeTruthy();
    expect(screen.getAllByText('найближчий')).toHaveLength(1);
    expect(within(screen.getByLabelText('Термін 20/11/2026')).queryByText('минув')).toBeNull();
  });

  it('платежі за грудень потрапляють у січень наступного року', () => {
    setup();
    const jan = screen.getByLabelText('Термін 20/01/2027');
    expect(within(jan).getAllByText('за грудень').length).toBeGreaterThan(0);
  });

  it('суми беруться з розрахунку', () => {
    const docs = calcYearFromDocuments(
      [
        {
          id: 's',
          kind: 'income',
          number: 'FV 1',
          issueDate: '2026-10-05',
          contractor: { name: 'Firma', nip: '1111111111', country: 'PL' },
          currency: 'PLN',
          lines: [{ net: 1_000_000, vatRate: '23', vat: 230_000 }],
          source: 'manual',
        },
      ],
      EMPTY_SETTINGS,
      TAX_CONFIG[2026]!,
    );
    mocks.results = docs;
    setup();
    // VAT за жовтень: 2 300,00 zł, термін 25.11
    expect(within(screen.getByLabelText('Термін 25/11/2026')).getAllByText(/2\s300,00/).length).toBeGreaterThan(0);
  });

  it('помилка розрахунку: повідомлення, а таблиць немає', () => {
    mocks.results = null;
    mocks.error = 'Немає ставок';
    setup();
    expect(screen.getByText('Немає ставок')).toBeTruthy();
    expect(screen.queryByLabelText(/^Термін /)).toBeNull();
  });
});
