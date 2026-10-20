import { TAX_CONFIG } from '@jdg/core';
import { Alert, Anchor, Badge, Button, Group, Loader, Select, Stack, Table, Text, Title } from '@mantine/core';
import { useState } from 'react';
import { Link } from 'react-router';
import { formatPln } from '../format';
import { MONTH_NAMES } from '../reconciliation/referenceForm';
import { downloadCsv, toCsv } from '../csv';
import { kpirCosts, yearTotals } from './accountingView';
import { YEAR_CSV_HEADER, yearCsvRows } from './exportCsv';
import { useLedgerYear } from './useLedgerYear';

const YEARS = Object.keys(TAX_CONFIG);

export function YearPage() {
  const [year, setYear] = useState(YEARS.at(-1)!);
  const ledger = useLedgerYear(Number(year));

  if (ledger.status === 'error') {
    return <Alert color="red">Не вдалося прочитати дані: {ledger.error.message}</Alert>;
  }
  if (ledger.status === 'loading') return <Loader aria-label="Завантаження" />;

  const results = ledger.results;
  const totals = results ? yearTotals(results) : null;

  return (
    <Stack maw={1100}>
      <Group justify="space-between" align="end">
        <Title order={2}>Рік {year}</Title>
        <Group align="end">
          {results && (
            <Button
              variant="default"
              onClick={() => downloadCsv(`rik-${year}.csv`, toCsv(YEAR_CSV_HEADER, yearCsvRows(results)))}
            >
              Експорт CSV
            </Button>
          )}
          <Select
            label="Рік"
            data={YEARS}
            value={year}
            onChange={(v) => v && setYear(v)}
            allowDeselect={false}
            w={120}
          />
        </Group>
      </Group>
      {!ledger.hasSettings && (
        <Alert color="yellow" title="Налаштування року не заповнені">
          ZUS, zdrowotna і zaliczka PIT рахуються без доходу й składek за грудень попереднього року.{' '}
          <Anchor component={Link} to="/settings">
            Заповнити
          </Anchor>
        </Alert>
      )}
      {ledger.error && (
        <Alert color="red" title="Не вдалося порахувати рік">
          {ledger.error}
        </Alert>
      )}
      {totals && totals.missingFxRates > 0 && (
        <Alert color="orange" title="Немає курсу NBP">
          Документів у валюті без курсу: {totals.missingFxRates}. Їх не враховано в сумах.
        </Alert>
      )}
      {results && totals && (
        <Table.ScrollContainer minWidth={860}>
          <Table striped highlightOnHover aria-label={`Підсумки ${year} року по місяцях`}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Місяць</Table.Th>
                <Table.Th ta="right">Przychód</Table.Th>
                <Table.Th ta="right">Koszty (KPiR)</Table.Th>
                <Table.Th ta="right">VAT</Table.Th>
                <Table.Th ta="right">ZUS</Table.Th>
                <Table.Th ta="right">Zdrowotna</Table.Th>
                <Table.Th ta="right">PIT</Table.Th>
                <Table.Th ta="right">Разом</Table.Th>
                <Table.Th ta="right">На руки</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {results.map((r) => (
                <Table.Tr key={r.month}>
                  <Table.Td>
                    <Anchor component={Link} to={`/month/${year}/${r.month}`}>
                      {MONTH_NAMES[r.month - 1]}
                    </Anchor>
                    {r.missingFxRates > 0 && (
                      <Badge color="orange" ml="xs" size="xs">
                        без курсу
                      </Badge>
                    )}
                  </Table.Td>
                  <Table.Td ta="right">{formatPln(r.income)}</Table.Td>
                  <Table.Td ta="right">{formatPln(kpirCosts(r))}</Table.Td>
                  <Table.Td ta="right">{formatPln(r.vatDue)}</Table.Td>
                  <Table.Td ta="right">{formatPln(r.zusTotal)}</Table.Td>
                  <Table.Td ta="right">{formatPln(r.health)}</Table.Td>
                  <Table.Td ta="right">{formatPln(r.pitAdvance)}</Table.Td>
                  <Table.Td ta="right">{formatPln(r.totalToPay)}</Table.Td>
                  <Table.Td ta="right">{formatPln(r.netCash)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
            <Table.Tfoot>
              <Table.Tr fw={700}>
                <Table.Td>Разом</Table.Td>
                <Table.Td ta="right">{formatPln(totals.income)}</Table.Td>
                <Table.Td ta="right">{formatPln(totals.costs)}</Table.Td>
                <Table.Td ta="right">{formatPln(totals.vatDue)}</Table.Td>
                <Table.Td ta="right">{formatPln(totals.zus)}</Table.Td>
                <Table.Td ta="right">{formatPln(totals.health)}</Table.Td>
                <Table.Td ta="right">{formatPln(totals.pitAdvance)}</Table.Td>
                <Table.Td ta="right">{formatPln(totals.totalToPay)}</Table.Td>
                <Table.Td ta="right">{formatPln(totals.netCash)}</Table.Td>
              </Table.Tr>
            </Table.Tfoot>
          </Table>
        </Table.ScrollContainer>
      )}
      <Text size="sm" c="dimmed">
        Суми в злотих. «Koszty (KPiR)» — як у кол. 15 KPiR: koszty PIT плюс FP і zdrowotna в kosztach, сплачені в
        місяці; «ZUS» — społeczne + FP за місяць; «Разом» — VAT, ZUS, zdrowotna і zaliczka PIT, які платяться до 20-го і
        25-го наступного місяця; «На руки» — przychód мінус реальні витрати і ці платежі.
      </Text>
    </Stack>
  );
}
