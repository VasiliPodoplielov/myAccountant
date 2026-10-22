import { Switch, useComputedColorScheme, useMantineColorScheme } from '@mantine/core';

/** Перемикач «Тема»: увімкнено — темна. Початкове значення береться із системи (defaultColorScheme="auto"), вибір Mantine зберігає в localStorage */
export function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme('light');
  return (
    <Switch
      size="md"
      label="Тема"
      labelPosition="left"
      aria-label="Темна тема"
      onLabel="🌙"
      offLabel="☀️"
      checked={computed === 'dark'}
      onChange={(e) => setColorScheme(e.currentTarget.checked ? 'dark' : 'light')}
    />
  );
}
