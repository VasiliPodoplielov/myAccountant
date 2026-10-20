// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { state: { status: 'signedIn', user: { uid: 'u1' } } } as { state: { status: string; user?: { uid: string } } },
  saveDocument: vi.fn(),
  syncFxRates: vi.fn(),
  eur: {} as Record<string, number>,
}));

vi.mock('../auth/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('../data/hooks', () => ({
  saveDocument: mocks.saveDocument,
  useFxRates: (currency: string) => ({ status: 'ready', data: currency === 'EUR' ? mocks.eur : EMPTY }),
}));
vi.mock('../data/fxSync', () => ({ syncFxRates: mocks.syncFxRates }));

const EMPTY: Record<string, number> = {};

import { installDomPolyfills } from '../test/domPolyfills';
import { AddDocumentPage } from './AddDocumentPage';

beforeAll(installDomPolyfills);

beforeEach(() => {
  mocks.auth.state = { status: 'signedIn', user: { uid: 'u1' } };
  mocks.saveDocument.mockReset().mockResolvedValue(undefined);
  mocks.syncFxRates.mockReset().mockResolvedValue(0);
  mocks.eur = {};
});
afterEach(cleanup);

function setup() {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(
    <MantineProvider>
      <MemoryRouter>
        <AddDocumentPage />
      </MemoryRouter>
    </MantineProvider>,
  );
  return user;
}

const field = (label: string | RegExp) => screen.getByLabelText(label) as HTMLInputElement;
const setDate = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });
const saveButton = () => screen.getByRole('button', { name: 'Зберегти' });

async function fillBasics(user: ReturnType<typeof userEvent.setup>, net = '100') {
  await user.type(field('Номер документа'), 'FV 1/10/2026');
  await user.type(field(/^(Постачальник|Покупець)$/), 'Test Sp. z o.o.');
  await user.type(field('Netto'), net);
}

describe('форма «Додати документ»', () => {
  it('без входу показує завантаження, а не форму', () => {
    mocks.auth.state = { status: 'signedOut' };
    setup();
    expect(screen.getByLabelText('Завантаження')).toBeTruthy();
    expect(screen.queryByText('Додати документ')).toBeNull();
  });

  it('показує швидкі кнопки лише для витрат', async () => {
    const user = setup();
    for (const name of ['Паливо', 'Claude (EUR)', 'Офіс']) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
    await user.click(screen.getByText('Дохід'));
    expect(screen.queryByRole('button', { name: 'Паливо' })).toBeNull();
    expect(screen.getByLabelText('Покупець')).toBeTruthy();
  });

  it('витрата «Паливо»: попередній розрахунок і запис у Firestore', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Паливо' }));
    setDate('Дата виставлення', '2026-10-20');
    await fillBasics(user);
    await user.type(field('VAT з фактури, zł'), '23');

    // netto 100 + невідлічений VAT 11,50, 75% = 83,63 (округлення від половини вгору)
    const preview = await screen.findByRole('table', { name: 'Попередній розрахунок' });
    expect(within(preview).queryByText(/Курс NBP/)).toBeNull();
    expect(within(preview).getByText(/Koszt PIT \(75%\)/)).toBeTruthy();
    expect(within(preview).getByText(/83,63/)).toBeTruthy();
    expect(within(preview).getByText('20.10.2026')).toBeTruthy();
    expect(within(preview).getByText('2026-10')).toBeTruthy();

    await user.click(saveButton());

    await waitFor(() => expect(mocks.saveDocument).toHaveBeenCalledTimes(1));
    const [uid, id, doc] = mocks.saveDocument.mock.calls[0]!;
    expect(uid).toBe('u1');
    expect(id).toMatch(/^manual-[0-9a-f]{32}$/);
    expect(doc).toMatchObject({
      kind: 'cost',
      category: 'carMixed',
      number: 'FV 1/10/2026',
      issueDate: '2026-10-20',
      source: 'manual',
      currency: 'PLN',
      description: 'Paliwo',
      contractor: { name: 'Test Sp. z o.o.', country: 'PL' },
      lines: [{ net: 10_000, vatRate: '23', vat: 2_300 }],
    });
    expect(mocks.syncFxRates).not.toHaveBeenCalled();
  });

  it('після збереження: повідомлення, посилання на місяць, очищені номер і сума, лишений постачальник', async () => {
    const user = setup();
    setDate('Дата виставлення', '2026-10-20');
    await fillBasics(user);
    await user.click(saveButton());

    const status = await screen.findByRole('status');
    expect(status.textContent).toMatch(/Збережено/);
    expect(within(status).getByRole('link', { name: 'Відкрити місяць' }).getAttribute('href')).toBe('/month/2026/10');
    expect(field('Номер документа').value).toBe('');
    expect(field('Netto').value).toBe('');
    expect(field('Постачальник').value).toBe('Test Sp. z o.o.');
  });

  it('порожня форма: помилка біля кнопки, нічого не пишеться', async () => {
    const user = setup();
    await user.click(saveButton());
    expect((await screen.findByRole('alert')).textContent).toMatch(/netto/);
    expect(mocks.saveDocument).not.toHaveBeenCalled();
  });

  it('без номера документа: помилка про номер', async () => {
    const user = setup();
    await user.type(field('Постачальник'), 'Test');
    await user.type(field('Netto'), '10');
    await user.click(saveButton());
    expect((await screen.findByRole('alert')).textContent).toMatch(/номер/);
    expect(mocks.saveDocument).not.toHaveBeenCalled();
  });

  it('помилка запису показується і не повідомляє про успіх', async () => {
    mocks.saveDocument.mockRejectedValue(new Error('permission-denied'));
    const user = setup();
    await fillBasics(user);
    await user.click(saveButton());
    expect((await screen.findByRole('alert')).textContent).toBe('permission-denied');
    expect(screen.queryByRole('status')).toBeNull();
    // дані не втрачені: можна натиснути ще раз
    expect(field('Номер документа').value).toBe('FV 1/10/2026');
  });

  it('помилка змінюється на чисту, щойно користувач править поле', async () => {
    const user = setup();
    await user.click(saveButton());
    await screen.findByRole('alert');
    await user.type(field('Номер документа'), 'X');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  describe('Claude (EUR)', () => {
    it('ховає поле VAT, підтягує курси і рахує VAT самим платником', async () => {
      mocks.eur = { '2026-10-19': 4.25 };
      const user = setup();
      await user.click(screen.getByRole('button', { name: 'Claude (EUR)' }));
      expect(screen.queryByLabelText('VAT з фактури, zł')).toBeNull();
      setDate('Дата виставлення', '2026-10-20');
      await fillBasics(user, '20');

      const preview = await screen.findByRole('table', { name: 'Попередній розрахунок' });
      expect(within(preview).getByText('Курс NBP')).toBeTruthy();
      expect(within(preview).getByText('4,2500 (з 19.10.2026)')).toBeTruthy();
      // 20 EUR × 4,25 = 85,00 zł; VAT 23% = 19,55
      expect(within(preview).getByText(/VAT \(нараховує платник\)/)).toBeTruthy();
      expect(within(preview).getByText(/19,55/)).toBeTruthy();
      // netto за курсом і koszt PIT (100%) однакові
      expect(within(preview).getAllByText(/85,00/)).toHaveLength(2);

      await waitFor(() => expect(mocks.syncFxRates).toHaveBeenCalled());
      expect(mocks.syncFxRates).toHaveBeenCalledWith('u1', 'EUR', '2026-10-06', '2026-10-20', mocks.eur);

      await user.click(saveButton());
      await waitFor(() => expect(mocks.saveDocument).toHaveBeenCalledTimes(1));
      expect(mocks.saveDocument.mock.calls[0]![2]).toMatchObject({
        category: 'importServices',
        currency: 'EUR',
        contractor: { country: 'IE' },
        lines: [{ net: 2_000, vatRate: '23' }],
      });
      expect(mocks.saveDocument.mock.calls[0]![2].lines[0]).not.toHaveProperty('vat');
    });

    it('поки курсу немає, пише про завантаження і не показує таблицю', async () => {
      mocks.syncFxRates.mockReturnValue(new Promise(() => {}));
      const user = setup();
      await user.click(screen.getByRole('button', { name: 'Claude (EUR)' }));
      setDate('Дата виставлення', '2026-10-20');
      await fillBasics(user, '20');
      expect(await screen.findByText('Курс NBP завантажується…')).toBeTruthy();
      expect(screen.queryByRole('table', { name: 'Попередній розрахунок' })).toBeNull();
    });

    it('NBP відповів без курсу: пояснення замість вічного «завантажується»', async () => {
      const user = setup();
      await user.click(screen.getByRole('button', { name: 'Claude (EUR)' }));
      setDate('Дата виставлення', '2026-10-20');
      await fillBasics(user, '20');
      expect(await screen.findByText('Курсу NBP на цю дату немає')).toBeTruthy();
      expect(screen.queryByText('Курс NBP завантажується…')).toBeNull();
    });

    it('NBP недоступний: попередження, але документ зберігається', async () => {
      mocks.syncFxRates.mockRejectedValue(new Error('NBP 503'));
      const user = setup();
      await user.click(screen.getByRole('button', { name: 'Claude (EUR)' }));
      setDate('Дата виставлення', '2026-10-20');
      await fillBasics(user, '20');
      expect(await screen.findByText('Курси NBP не завантажено')).toBeTruthy();

      await user.click(saveButton());
      await waitFor(() => expect(mocks.saveDocument).toHaveBeenCalledTimes(1));
      expect(await screen.findByText(/документ збережено, але без курсу/)).toBeTruthy();
    });

    it('період курсів розширюється датою оплати', async () => {
      const user = setup();
      await user.click(screen.getByRole('button', { name: 'Claude (EUR)' }));
      setDate('Дата виставлення', '2026-10-01');
      await fillBasics(user, '20');
      await user.click(screen.getByLabelText('Додатково'));
      setDate('Дата оплати', '2026-10-20');
      await waitFor(() =>
        expect(mocks.syncFxRates).toHaveBeenLastCalledWith('u1', 'EUR', '2026-09-17', '2026-10-20', mocks.eur),
      );
    });
  });

  describe('дохід', () => {
    it('розрахунковий період без дати продажу — помилка, з датою — запис', async () => {
      const user = setup();
      await user.click(screen.getByText('Дохід'));
      setDate('Дата виставлення', '2026-10-05');
      await fillBasics(user, '1000');
      await user.click(screen.getByLabelText('Додатково'));
      await user.click(screen.getByLabelText(/Розрахункові періоди/));

      await user.click(saveButton());
      expect((await screen.findByRole('alert')).textContent).toMatch(/період/);
      expect(mocks.saveDocument).not.toHaveBeenCalled();

      setDate('Дата продажу чи виконання послуги', '2026-10-31');
      await user.click(saveButton());
      await waitFor(() => expect(mocks.saveDocument).toHaveBeenCalledTimes(1));
      expect(mocks.saveDocument.mock.calls[0]![2]).toMatchObject({
        kind: 'income',
        periodicSettlement: true,
        saleDate: '2026-10-31',
        issueDate: '2026-10-05',
      });
      // дохід за розрахунковий період іде в KPiR останнім днем періоду
      expect((await screen.findByRole('link', { name: 'Відкрити місяць' })).getAttribute('href')).toBe(
        '/month/2026/10',
      );
    });

    it('попередній розрахунок показує przychód', async () => {
      const user = setup();
      await user.click(screen.getByText('Дохід'));
      setDate('Дата виставлення', '2026-10-05');
      await fillBasics(user, '1000');
      const preview = await screen.findByRole('table', { name: 'Попередній розрахунок' });
      expect(within(preview).getByText('Przychód')).toBeTruthy();
      expect(within(preview).getAllByText(/1\s000,00/).length).toBeGreaterThan(0);
    });
  });

  it('перемикання пресетів: «Офіс» після «Claude» повертає поле VAT і польського контрагента', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Claude (EUR)' }));
    expect(screen.queryByLabelText('VAT з фактури, zł')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Офіс' }));
    expect(screen.getByLabelText('VAT з фактури, zł')).toBeTruthy();
    await user.click(screen.getByLabelText('Додатково'));
    expect(field('Країна контрагента').value).toBe('PL');
  });
});
