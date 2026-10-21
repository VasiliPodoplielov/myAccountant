// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { installDomPolyfills } from '../test/domPolyfills';
import { DateField } from './DateField';

beforeAll(installDomPolyfills);
afterEach(cleanup);

/** Керована обгортка, як у формі: значення — ISO-рядок */
function Harness({ initial, spy }: { initial: string; spy?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <MantineProvider>
      <DateField
        label="Дата"
        value={value}
        onChange={(v) => {
          setValue(v);
          spy?.(v);
        }}
      />
      <button onClick={() => setValue('2026-03-31')}>Підставити</button>
      <output data-testid="iso">{value}</output>
    </MantineProvider>
  );
}

const input = () =>
  screen.getByLabelText('Дата', { selector: 'input[type="text"], input:not([type])' }) as HTMLInputElement;

describe('DateField', () => {
  it('показує ISO-значення як dd/mm/yyyy', () => {
    render(<Harness initial="2026-02-05" />);
    expect(input().value).toBe('05/02/2026');
  });

  it('повний запис dd/mm/yyyy віддає форме ISO', () => {
    const spy = vi.fn();
    render(<Harness initial="" spy={spy} />);
    fireEvent.change(input(), { target: { value: '20/10/2026' } });
    expect(spy).toHaveBeenLastCalledWith('2026-10-20');
    expect(screen.getByTestId('iso').textContent).toBe('2026-10-20');
  });

  it('неповний чи хибний запис іде як є: валідація форми покаже помилку', () => {
    const spy = vi.fn();
    render(<Harness initial="2026-02-05" spy={spy} />);
    fireEvent.change(input(), { target: { value: '20/10/20' } });
    expect(spy).toHaveBeenLastCalledWith('20/10/20');
    expect(input().value).toBe('20/10/20');
  });

  it('значення, змінене формою ззовні, оновлює текст', () => {
    render(<Harness initial="2026-02-05" />);
    fireEvent.click(screen.getByText('Підставити'));
    expect(input().value).toBe('31/03/2026');
  });

  it('вибір у календарі браузера записує дату', () => {
    const spy = vi.fn();
    const { container } = render(<Harness initial="" spy={spy} />);
    const picker = container.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(picker, { target: { value: '2026-07-04' } });
    expect(spy).toHaveBeenLastCalledWith('2026-07-04');
    expect(input().value).toBe('04/07/2026');
  });

  it('кнопка календаря відкриває вибір дати з поточним значенням', () => {
    const { container } = render(<Harness initial="2026-02-05" />);
    const picker = container.querySelector('input[type="date"]') as HTMLInputElement;
    const showPicker = vi.fn();
    picker.showPicker = showPicker;
    fireEvent.click(screen.getByRole('button', { name: /Обрати дату в календарі: Дата/ }));
    expect(showPicker).toHaveBeenCalledTimes(1);
    expect(picker.value).toBe('2026-02-05');
  });
});
