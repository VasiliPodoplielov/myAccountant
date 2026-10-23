import { TAX_CONFIG } from '@jdg/core';
import { Alert, Anchor, Badge, Group, Loader, Select, Stack, Table, Text, Title } from '@mantine/core';
import { useState } from 'react';
import { Link } from 'react-router';
import { formatPln } from '../format';
import { MONTH_NAMES } from '../reconciliation/referenceForm';
import { formatDate, localToday, yearDeadlines } from './accountingView';
import { useLedgerYear } from './useLedgerYear';

const YEARS = Object.keys(TAX_CONFIG);

export function CalendarPage() {
  const [year, setYear] = useState(YEARS.at(-1)!);
  const ledger = useLedgerYear(Number(year));

  if (ledger.status === 'error') {
    return <Alert color="red">Не вдалося прочитати дані: {ledger.error.message}</Alert>;
  }
  if (ledger.status === 'loading') return <Loader aria-label="Завантаження" />;

  const groups = ledger.results ? yearDeadlines(Number(year), ledger.results, localToday()) : [];
  const nextIndex = groups.findIndex((g) => !g.past);

  return (
    <Stack maw={900}>
      <Group justify="space-between" align="end">
        <Title order={2}>Календар термінів</Title>
        <Select label="Рік" data={YEARS} value={year} onChange={(v) => v && setYear(v)} allowDeselect={false} w={120} />
      </Group>
      <Text size="sm" c="dimmed">
        ZUS, zdrowotna і zaliczka PIT — до 20-го числа наступного місяця, VAT (JPK_V7M) — до 25-го. Якщо термін припадає
        на суботу, неділю чи свято, він переноситься на наступний робочий день (art. 12 § 5 Ordynacji podatkowej). Суми
        — за поточним обліком.
      </Text>
      {ledger.error && (
        <Alert color="red" title="Не вдалося порахувати рік">
          {ledger.error}
        </Alert>
      )}
      {groups.map((g, i) => (
        <Stack key={g.due} gap="xs" aria-label={`Термін ${formatDate(g.due)}`} opacity={g.past ? 0.6 : 1}>
          <Group gap="sm">
            <Title order={3} size="h4">
              {formatDate(g.due)}
            </Title>
            {i === nextIndex && <Badge>найближчий</Badge>}
            {g.past && (
              <Badge color="gray" variant="light">
                минув
              </Badge>
            )}
            {g.shiftedFrom && (
              <Badge color="orange" variant="light">
                перенесено з {formatDate(g.shiftedFrom)} ({g.reason})
              </Badge>
            )}
          </Group>
          <Table.ScrollContainer minWidth={420}>
            <Table>
              <Table.Tbody>
                {g.payments.map((p) => (
                  <Table.Tr key={`${p.key}-${p.month}`}>
                    <Table.Td>{p.label}</Table.Td>
                    <Table.Td>
                      <Anchor component={Link} to={`/month/${year}/${p.month}`} size="sm">
                        за {MONTH_NAMES[p.month - 1]!.toLowerCase()}
                      </Anchor>
                    </Table.Td>
                    <Table.Td ta="right">{formatPln(p.amount)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
              <Table.Tfoot>
                <Table.Tr fw={700}>
                  <Table.Td colSpan={2}>Разом</Table.Td>
                  <Table.Td ta="right">{formatPln(g.total)}</Table.Td>
                </Table.Tr>
              </Table.Tfoot>
            </Table>
          </Table.ScrollContainer>
        </Stack>
      ))}
    </Stack>
  );
}
