// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ColorSchemeToggle } from './ColorSchemeToggle';
import { installDomPolyfills } from './test/domPolyfills';

const scheme = () => document.documentElement.getAttribute('data-mantine-color-scheme');
const toggle = () => screen.getByRole('switch', { name: 'Темна тема' }) as HTMLInputElement;

beforeAll(installDomPolyfills);
beforeEach(() => localStorage.clear());
afterEach(cleanup);

function setup(defaultColorScheme: 'auto' | 'light' | 'dark' = 'light') {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(
    <MantineProvider defaultColorScheme={defaultColorScheme}>
      <ColorSchemeToggle />
    </MantineProvider>,
  );
  return user;
}

describe('перемикач теми', () => {
  it('показує підпис «Тема», а стан відповідає поточній темі', () => {
    setup('light');
    expect(screen.getByText('Тема')).toBeTruthy();
    expect(toggle().checked).toBe(false);
  });

  it('вмикає темну тему на сторінці й повертає світлу', async () => {
    const user = setup('light');
    await user.click(toggle());
    expect(scheme()).toBe('dark');
    expect(toggle().checked).toBe(true);
    await user.click(toggle());
    expect(scheme()).toBe('light');
  });

  it('вибір запам’ятовується в localStorage', async () => {
    const user = setup('light');
    await user.click(toggle());
    expect(localStorage.getItem('mantine-color-scheme-value')).toBe('dark');
  });

  it('при «auto» стан береться із системи (у jsdom — світла)', () => {
    setup('auto');
    expect(toggle().checked).toBe(false);
  });
});
