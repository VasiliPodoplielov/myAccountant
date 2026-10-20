// @vitest-environment jsdom
import type { LedgerDocument } from '@jdg/core';
import { MantineProvider } from '@mantine/core';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDomPolyfills } from '../test/domPolyfills';

type Doc = LedgerDocument & { id: string };

const mocks = vi.hoisted(() => ({
  auth: { state: { status: 'signedIn', user: { uid: 'u1' } } } as { state: { status: string; user?: { uid: string } } },
  deleteDocument: vi.fn(),
  docs: [] as unknown[],
}));

vi.mock('../auth/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('../data/hooks', () => ({ deleteDocument: mocks.deleteDocument }));
vi.mock('./useLedgerYear', () => ({
  useLedgerYear: () => ({
    status: 'ready',
    docs: mocks.docs,
    fx: { EUR: {}, USD: {} },
    hasSettings: true,
    results: null,
    error: null,
  }),
}));

import { MonthPage } from './MonthPage';

const contractor = { name: 'Firma', country: 'PL' };
const cost = (id: string, number: string, source: 'manual' | 'import'): Doc => ({
  id,
  kind: 'cost',
  category: 'office',
  number,
  issueDate: '2026-10-05',
  contractor,
  currency: 'PLN',
  lines: [{ net: 10_000, vatRate: '23', vat: 2_300 }],
  source,
});

beforeAll(installDomPolyfills);
beforeEach(() => {
  mocks.auth.state = { status: 'signedIn', user: { uid: 'u1' } };
  mocks.deleteDocument.mockReset().mockResolvedValue(undefined);
  mocks.docs = [cost('manual-1', 'TEST/1', 'manual'), cost('jpk-1', 'JPK/1', 'import')];
});
afterEach(cleanup);

function setup() {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(
    <MantineProvider>
      <MemoryRouter initialEntries={['/month/2026/10']}>
        <Routes>
          <Route path="/month/:year/:month" element={<MonthPage />} />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );
  return user;
}

describe('видалення документа на екрані місяця', () => {
  it('кнопка «Видалити» є лише в документів, внесених вручну', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Видалити документ TEST/1' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Видалити документ JPK/1' })).toBeNull();
    expect(screen.getAllByRole('button', { name: /^Видалити документ/ })).toHaveLength(1);
  });

  it('клік відкриває підтвердження з потрібним документом і нічого не видаляє', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Видалити документ TEST/1' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('TEST/1')).toBeTruthy();
    expect(mocks.deleteDocument).not.toHaveBeenCalled();
  });

  it('скасування лишає документ і не викликає видалення', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Видалити документ TEST/1' }));
    await user.click(await screen.findByRole('button', { name: 'Скасувати' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.deleteDocument).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Видалити документ TEST/1' })).toBeTruthy();
  });

  it('підтвердження видаляє лише обраний документ', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Видалити документ TEST/1' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Видалити' }));
    await waitFor(() => expect(mocks.deleteDocument).toHaveBeenCalledTimes(1));
    expect(mocks.deleteDocument).toHaveBeenCalledWith('u1', 'manual-1');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('без входу кнопок видалення немає', () => {
    mocks.auth.state = { status: 'signedOut' };
    setup();
    expect(screen.queryByRole('button', { name: /^Видалити документ/ })).toBeNull();
  });
});
