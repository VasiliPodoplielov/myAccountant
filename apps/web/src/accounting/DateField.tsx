import { ActionIcon, TextInput, type TextInputProps } from '@mantine/core';
import { useRef, useState } from 'react';
import { formatDate, parseDate } from './accountingView';

type Props = Omit<TextInputProps, 'value' | 'onChange' | 'type'> & {
  /** 'YYYY-MM-DD'; будь-що інше показується як є, щоб валідація форми вказала на помилку */
  value: string;
  onChange: (value: string) => void;
};

const toText = (value: string) => (parseDate(formatDate(value)) === value ? formatDate(value) : value);

const CalendarIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);

/**
 * Поле дати: ручне введення у форматі dd/mm/yyyy або вибір у календарі браузера (кнопка справа).
 * У формі зберігається ISO-рядок, який приймає решта коду.
 */
export function DateField({ value, onChange, label, ...rest }: Props) {
  const [text, setText] = useState(() => toText(value));
  const picker = useRef<HTMLInputElement>(null);

  // значення змінила форма (швидка кнопка, очищення після збереження), а не користувач
  if ((parseDate(text) ?? text) !== value) setText(toText(value));

  const set = (next: string) => {
    setText(next);
    onChange(parseDate(next) ?? next);
  };

  return (
    <TextInput
      {...rest}
      label={label}
      placeholder="дд/мм/рррр"
      inputMode="numeric"
      maxLength={10}
      value={text}
      onChange={(e) => set(e.currentTarget.value)}
      rightSectionPointerEvents="all"
      rightSection={
        <>
          <ActionIcon
            variant="subtle"
            color="gray"
            aria-label={`Обрати дату в календарі: ${typeof label === 'string' ? label : ''}`}
            onClick={() => {
              const el = picker.current;
              if (!el) return;
              el.value = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
              if (typeof el.showPicker === 'function') el.showPicker();
              else el.click();
            }}
          >
            <CalendarIcon />
          </ActionIcon>
          <input
            ref={picker}
            type="date"
            tabIndex={-1}
            aria-hidden="true"
            style={{ position: 'absolute', inset: 0, opacity: 0, pointerEvents: 'none' }}
            onChange={(e) => e.currentTarget.value && set(formatDate(e.currentTarget.value))}
          />
        </>
      }
    />
  );
}
