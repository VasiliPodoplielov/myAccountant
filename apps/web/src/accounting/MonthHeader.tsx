import { ActionIcon, Anchor, Breadcrumbs, Group, SegmentedControl, Stack, Text, Title } from '@mantine/core';
import { Link, useNavigate } from 'react-router';
import { MONTH_NAMES } from '../reconciliation/referenceForm';

export type MonthSection = 'month' | 'books';

const SECTIONS: { value: MonthSection; label: string }[] = [
  { value: 'month', label: 'Документи' },
  { value: 'books', label: 'KPiR і VAT' },
];

function StepButton({ to, label, children }: { to: string | null; label: string; children: string }) {
  if (!to) {
    return (
      <ActionIcon variant="default" size="lg" disabled aria-label={label}>
        {children}
      </ActionIcon>
    );
  }
  return (
    <ActionIcon component={Link} to={to} variant="default" size="lg" aria-label={label}>
      {children}
    </ActionIcon>
  );
}

const sectionPath = (section: MonthSection, year: number, month: number) => `/${section}/${year}/${month}`;

/** Спільна шапка сторінок місяця: хлібні крихти, перемикач розділу та стрілки між місяцями. */
export function MonthHeader({ year, month, section }: { year: number; month: number; section: MonthSection }) {
  const navigate = useNavigate();
  const prev = month > 1 ? month - 1 : null;
  const next = month < 12 ? month + 1 : null;

  return (
    <Stack gap="xs">
      <Breadcrumbs aria-label="Навігація">
        <Anchor component={Link} to="/" size="sm">
          Облік
        </Anchor>
        <Text size="sm" c="dimmed">
          {MONTH_NAMES[month - 1]} {year}
        </Text>
      </Breadcrumbs>
      <Group justify="space-between" align="center">
        <Group gap="xs">
          <StepButton
            to={prev ? sectionPath(section, year, prev) : null}
            label={prev ? `Попередній місяць: ${MONTH_NAMES[prev - 1]}` : 'Попереднього місяця немає'}
          >
            ‹
          </StepButton>
          <Title order={2} miw={200} ta="center">
            {MONTH_NAMES[month - 1]} {year}
          </Title>
          <StepButton
            to={next ? sectionPath(section, year, next) : null}
            label={next ? `Наступний місяць: ${MONTH_NAMES[next - 1]}` : 'Наступного місяця немає'}
          >
            ›
          </StepButton>
        </Group>
        <SegmentedControl
          aria-label="Розділ місяця"
          color="blue"
          data={SECTIONS}
          value={section}
          onChange={(value) => void navigate(sectionPath(value as MonthSection, year, month))}
        />
      </Group>
    </Stack>
  );
}
