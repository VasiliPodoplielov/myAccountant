// @vitest-environment jsdom
import {
  calcYearFromDocuments,
  TAX_CONFIG,
  yearFigures,
  type LedgerDocument,
  type MonthReference,
  type PeriodRecord,
} from '@jdg/core';
import { MantineProvider } from '@mantine/core';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_SETTINGS } from '../settings/settingsForm';
import { installDomPolyfills } from '../test/domPolyfills';

type Doc = LedgerDocument & { id: string };

const sale: Doc = {
  id: 'sale',
  kind: 'income',
  number: 'FV 1',
  issueDate: '2026-03-10',
  contractor: { name: 'Firma', nip: '1111111111', country: 'PL' },
  currency: 'PLN',
  lines: [{ net: 1_000_000, vatRate: '23', vat: 230_000 }],
  source: 'manual',
};
const results = calcYearFromDocuments([sale], EMPTY_SETTINGS, TAX_CONFIG[2026]!);
const march = yearFigures([sale], EMPTY_SETTINGS, TAX_CONFIG[2026]!)[2]!;
/** Повний еталон за березень, що збігається з обліком */
const MARCH_REFERENCE: MonthReference = {
  vat: march.vat,
  kpir: { col9: march.kpir.col9, col15: march.kpir.col15 },
  zus: march.zus,
  pitAdvance: march.pitAdvance,
};

const mocks = vi.hoisted(() => ({
  auth: { state: { status: 'signedIn', user: { uid: 'u1' } } } as { state: { status: string; user?: { uid: string } } },
  savePeriod: vi.fn(),
  periods: {} as Record<string, unknown>,
  references: {} as Record<string, unknown>,
  results: null as unknown,
  hasSettings: true,
}));

vi.mock('../auth/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('../data/hooks', () => ({
  savePeriod: mocks.savePeriod,
  useYearSettings: () => ({ status: 'ready', data: null }),
  useReferences: () => ({ status: 'ready', data: mocks.references }),
}));
vi.mock('./useLedgerYear', () => ({
  useLedgerYear: () => ({
    status: 'ready',
    docs: [sale],
    fx: { EUR: {}, USD: {} },
    periods: mocks.periods,
    hasSettings: mocks.hasSettings,
    results: mocks.results,
    error: null,
  }),
}));

import { ClosePage } from './ClosePage';

const CONFIRMED = { documents: true, ksef: true };
const closed = (over: Partial<PeriodRecord> = {}): PeriodRecord => ({
  status: 'closed',
  confirmations: CONFIRMED,
  closedAt: '2026-04-05T10:00:00.000Z',
  snapshot: results[2]!,
  documentCount: 1,
  ...over,
});

beforeAll(installDomPolyfills);
beforeEach(() => {
  mocks.auth.state = { status: 'signedIn', user: { uid: 'u1' } };
  mocks.savePeriod.mockReset().mockResolvedValue(undefined);
  mocks.periods = { '2026-02': closed() };
  mocks.references = { '2026-03': MARCH_REFERENCE };
  mocks.results = results;
  mocks.hasSettings = true;
});
afterEach(cleanup);

function setup(path = '/close/2026/3') {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(
    <MantineProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/close/:year/:month" element={<ClosePage />} />
          <Route path="/" element={<div>Головна</div>} />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );
  return user;
}

const closeButton = () => screen.getByRole('button', { name: 'Закрити місяць' }) as HTMLButtonElement;

describe('чекліст закриття', () => {
  it('ручні пункти без підтвердження: закрити не можна', () => {
    setup();
    expect(screen.getByText('Відкрито')).toBeTruthy();
    expect(closeButton().disabled).toBe(true);
    expect((screen.getByLabelText(/Усі документи місяця внесено/) as HTMLInputElement).checked).toBe(false);
  });

  it('підтвердження ручного пункту записується в periods, місяць лишається відкритим', async () => {
    const user = setup();
    await user.click(screen.getByLabelText(/Усі документи місяця внесено/));
    await waitFor(() => expect(mocks.savePeriod).toHaveBeenCalledTimes(1));
    expect(mocks.savePeriod).toHaveBeenCalledWith('u1', '2026-03', {
      status: 'open',
      confirmations: { documents: true },
    });
  });

  it('усе виконано: кнопка активна', () => {
    mocks.periods = { '2026-02': closed(), '2026-03': { status: 'open', confirmations: CONFIRMED } };
    setup();
    expect(closeButton().disabled).toBe(false);
  });

  it('немає еталона: пояснення і закрити не можна', () => {
    mocks.periods = { '2026-02': closed(), '2026-03': { status: 'open', confirmations: CONFIRMED } };
    mocks.references = {};
    setup();
    expect(screen.getByText(/Немає еталона за місяць/)).toBeTruthy();
    expect(closeButton().disabled).toBe(true);
  });

  it('еталон без DRA і zaliczki: називає, чого бракує, і закрити не можна', () => {
    mocks.periods = { '2026-02': closed(), '2026-03': { status: 'open', confirmations: CONFIRMED } };
    mocks.references = { '2026-03': { vat: MARCH_REFERENCE.vat, kpir: MARCH_REFERENCE.kpir } };
    setup();
    expect(screen.getByText(/В еталоні немає: DRA, zaliczka PIT$/)).toBeTruthy();
    expect(closeButton().disabled).toBe(true);
  });

  it('налаштування року не заповнені: закрити не можна', () => {
    mocks.periods = { '2026-02': closed(), '2026-03': { status: 'open', confirmations: CONFIRMED } };
    mocks.hasSettings = false;
    setup();
    expect(screen.getByText(/Без даних за грудень/)).toBeTruthy();
    expect(closeButton().disabled).toBe(true);
  });

  it('попередній місяць не закрито: закрити не можна', () => {
    mocks.periods = { '2026-03': { status: 'open', confirmations: CONFIRMED } };
    setup();
    expect(screen.getByText(/Спершу закрийте попередній місяць/)).toBeTruthy();
    expect(closeButton().disabled).toBe(true);
  });

  it('без входу закрити не можна', () => {
    mocks.auth.state = { status: 'signedOut' };
    mocks.periods = { '2026-02': closed(), '2026-03': { status: 'open', confirmations: CONFIRMED } };
    setup();
    expect(closeButton().disabled).toBe(true);
  });
});

describe('закриття', () => {
  beforeEach(() => {
    mocks.periods = { '2026-02': closed(), '2026-03': { status: 'open', confirmations: CONFIRMED } };
  });

  it('діалог показує суми; скасування нічого не пише', async () => {
    const user = setup();
    await user.click(closeButton());
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('table', { name: 'Суми для закриття' })).toBeTruthy();
    await user.click(within(dialog).getByRole('button', { name: 'Скасувати' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.savePeriod).not.toHaveBeenCalled();
  });

  it('підтвердження пише закритий запис зі знімком і кількістю документів', async () => {
    const user = setup();
    await user.click(closeButton());
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Закрити' }));
    await waitFor(() => expect(mocks.savePeriod).toHaveBeenCalledTimes(1));
    const [uid, period, record] = mocks.savePeriod.mock.calls[0]!;
    expect(uid).toBe('u1');
    expect(period).toBe('2026-03');
    expect(record).toMatchObject({ status: 'closed', confirmations: CONFIRMED, documentCount: 1 });
    expect(record.snapshot).toEqual(results[2]);
    expect(typeof record.closedAt).toBe('string');
  });

  it('помилка запису показується, діалог лишається', async () => {
    mocks.savePeriod.mockRejectedValue(new Error('permission-denied'));
    const user = setup();
    await user.click(closeButton());
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Закрити' }));
    expect((await screen.findAllByText(/Не вдалося зберегти: permission-denied/)).length).toBeGreaterThan(0);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('закритий місяць', () => {
  beforeEach(() => {
    mocks.periods = { '2026-02': closed(), '2026-03': closed() };
  });

  it('показує знімок, а чекліст ховає', () => {
    setup();
    expect(screen.getByText('Закрито')).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Знімок сум місяця' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Закрити місяць' })).toBeNull();
    expect(screen.queryByText('Суми змінилися після закриття')).toBeNull();
  });

  it('суми змінилися після закриття: попередження зі старим і новим значенням', () => {
    mocks.periods = { '2026-03': closed({ snapshot: { ...results[2]!, income: results[2]!.income - 100 } }) };
    setup();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Суми змінилися після закриття');
    expect(alert.textContent).toContain('Przychód');
  });

  it('повторне відкриття пише відкритий запис без знімка', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Відкрити знову (корекція)' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Відкрити' }));
    await waitFor(() => expect(mocks.savePeriod).toHaveBeenCalledTimes(1));
    const record = mocks.savePeriod.mock.calls[0]![2];
    expect(record).toMatchObject({ status: 'open', confirmations: CONFIRMED });
    expect('snapshot' in record).toBe(false);
    expect(typeof record.reopenedAt).toBe('string');
  });

  it('пізніші закриті місяці згадуються в попередженні', async () => {
    mocks.periods = { '2026-03': closed(), '2026-04': closed() };
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Відкрити знову (корекція)' }));
    expect((await screen.findByRole('dialog')).textContent).toContain('2026-04');
  });
});

describe('адреса', () => {
  it('неправильний місяць веде на головну', () => {
    setup('/close/2026/13');
    expect(screen.getByText('Головна')).toBeTruthy();
  });

  it('рік без ставок веде на головну', () => {
    setup('/close/1999/3');
    expect(screen.getByText('Головна')).toBeTruthy();
  });
});
