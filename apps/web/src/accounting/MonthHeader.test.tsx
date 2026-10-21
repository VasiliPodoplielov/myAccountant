// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { installDomPolyfills } from '../test/domPolyfills';
import { MonthHeader, type MonthSection } from './MonthHeader';

beforeAll(installDomPolyfills);
afterEach(cleanup);

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function setup(section: MonthSection, month: number) {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(
    <MantineProvider>
      <MemoryRouter initialEntries={[`/${section}/2026/${month}`]}>
        <MonthHeader year={2026} month={month} section={section} />
        <Routes>
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </MantineProvider>,
  );
  return user;
}

describe('шапка місяця', () => {
  it('перемикач з документів веде на KPiR і VAT того ж місяця', async () => {
    const user = setup('month', 10);
    await user.click(screen.getByLabelText('KPiR і VAT'));
    expect(screen.getByTestId('where').textContent).toBe('/books/2026/10');
  });

  it('перемикач з KPiR і VAT веде на документи того ж місяця', async () => {
    const user = setup('books', 10);
    await user.click(screen.getByLabelText('Документи'));
    expect(screen.getByTestId('where').textContent).toBe('/month/2026/10');
  });

  it('стрілки лишаються в тому ж розділі', async () => {
    const user = setup('books', 10);
    await user.click(screen.getByRole('link', { name: /Наступний місяць/ }));
    expect(screen.getByTestId('where').textContent).toBe('/books/2026/11');
  });

  it('«Облік» у крихтах веде на рік', async () => {
    const user = setup('books', 10);
    await user.click(screen.getByRole('link', { name: 'Облік' }));
    expect(screen.getByTestId('where').textContent).toBe('/');
  });

  it('у січні немає попереднього місяця', () => {
    setup('month', 1);
    expect((screen.getByRole('button', { name: 'Попереднього місяця немає' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
