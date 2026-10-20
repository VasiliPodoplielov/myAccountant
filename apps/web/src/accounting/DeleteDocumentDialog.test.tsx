// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installDomPolyfills } from '../test/domPolyfills';
import type { MonthDocumentRow } from './accountingView';

const mocks = vi.hoisted(() => ({ deleteDocument: vi.fn() }));
vi.mock('../data/hooks', () => ({ deleteDocument: mocks.deleteDocument }));

import { DeleteDocumentDialog } from './DeleteDocumentDialog';

const row: MonthDocumentRow = {
  id: 'manual-1',
  kind: 'cost',
  number: 'TEST/1',
  contractor: 'Test Sp. z o.o.',
  pitDate: '2026-10-20',
  vatDate: '2026-10-20',
  pitAmount: 8_363,
  vat: 2_300,
  inKpir: true,
  inVat: true,
  missingFx: false,
  deletable: true,
};

beforeAll(installDomPolyfills);
beforeEach(() => mocks.deleteDocument.mockReset().mockResolvedValue(undefined));
afterEach(cleanup);

function setup(r: MonthDocumentRow | null = row) {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  const onClose = vi.fn();
  render(
    <MantineProvider>
      <DeleteDocumentDialog uid="u1" row={r} onClose={onClose} />
    </MantineProvider>,
  );
  return { user, onClose };
}

describe('підтвердження видалення документа', () => {
  it('без документа діалог закритий', () => {
    setup(null);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('показує, що саме видаляється, і нічого не видаляє без підтвердження', () => {
    setup();
    const table = within(screen.getByRole('dialog')).getByRole('table', { name: 'Документ для видалення' });
    expect(within(table).getByText('TEST/1')).toBeTruthy();
    expect(within(table).getByText('Test Sp. z o.o.')).toBeTruthy();
    expect(within(table).getByText('20.10.2026')).toBeTruthy();
    expect(within(table).getByText(/83,63/)).toBeTruthy();
    expect(screen.getByText(/неможливо/)).toBeTruthy();
    expect(mocks.deleteDocument).not.toHaveBeenCalled();
  });

  it('«Скасувати» закриває діалог без видалення', async () => {
    const { user, onClose } = setup();
    await user.click(screen.getByRole('button', { name: 'Скасувати' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mocks.deleteDocument).not.toHaveBeenCalled();
  });

  it('Escape закриває діалог без видалення', async () => {
    const { user, onClose } = setup();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
    expect(mocks.deleteDocument).not.toHaveBeenCalled();
  });

  it('фокус на безпечній кнопці «Скасувати», а не на «Видалити»', async () => {
    setup();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Скасувати' })));
  });

  it('«Видалити» видаляє саме цей документ і закриває діалог', async () => {
    const { user, onClose } = setup();
    await user.click(screen.getByRole('button', { name: 'Видалити' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mocks.deleteDocument).toHaveBeenCalledTimes(1);
    expect(mocks.deleteDocument).toHaveBeenCalledWith('u1', 'manual-1');
  });

  it('помилка видалення: показується, діалог лишається відкритим, можна повторити', async () => {
    mocks.deleteDocument.mockRejectedValueOnce(new Error('permission-denied'));
    const { user, onClose } = setup();
    await user.click(screen.getByRole('button', { name: 'Видалити' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/permission-denied/);
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Видалити' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(mocks.deleteDocument).toHaveBeenCalledTimes(2);
  });

  it('документ без суми (внутрішній) показує прочерк', () => {
    setup({ ...row, pitAmount: null, contractor: '', description: 'Коригування' });
    const table = screen.getByRole('table', { name: 'Документ для видалення' });
    expect(within(table).getByText('Коригування')).toBeTruthy();
    expect(within(table).getByText('—')).toBeTruthy();
  });
});
