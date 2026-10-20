import { TAX_CONFIG, type MonthResult } from '@jdg/core';
import { Alert, Anchor, Badge, Button, Group, Loader, Stack, Table, Text, Title } from '@mantine/core';
import { Link, Navigate, useParams } from 'react-router';
import { formatPln } from '../format';
import { MONTH_NAMES } from '../reconciliation/referenceForm';
import { downloadCsv, toCsv } from '../csv';
import { formatDate, monthDocuments, monthPayments, type MonthDocumentRow } from './accountingView';
import { MONTH_DOCS_CSV_HEADER, monthDocumentsCsvRows } from './exportCsv';
import { useLedgerYear } from './useLedgerYear';

const LATEST_YEAR = Number(Object.keys(TAX_CONFIG).at(-1));

const KIND_LABEL: Record<MonthDocumentRow['kind'], string> = {
  income: 'Дохід',
  cost: 'Витрата',
  internal: 'Внутрішній',
};

function PitDetails({ r }: { r: MonthResult }) {
  const rows: [string, number][] = [
    ['Przychód', r.income],
    ['Koszty PIT', r.pitCosts],
    ['FP, сплачений у місяці', r.fpPaid],
    ['Społeczne, сплачені в місяці', r.zusSocialPaid],
    ['Zdrowotna в kosztach', r.healthInCosts],
    ['Дохід місяця', r.monthlyIncomeAfterZus],
    ['Дохід з початку року', r.cumulativeIncome],
    ['Podstawa (з початку року)', r.pitBase],
    ['Податок (з початку року)', r.pitTaxCumulative],
    ['Zaliczka за місяць', r.pitAdvance],
  ];
  return (
    <Table aria-label="Деталі zaliczki PIT">
      <Table.Tbody>
        {rows.map(([label, value]) => (
          <Table.Tr key={label}>
            <Table.Td>{label}</Table.Td>
            <Table.Td ta="right">{formatPln(value)}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

export function MonthPage() {
  const params = useParams();
  const year = Number(params.year);
  const month = Number(params.month);
  const valid = TAX_CONFIG[year] !== undefined && Number.isInteger(month) && month >= 1 && month <= 12;
  // для неправильної адреси підписуємось на останній рік, щоб не відкривати слухач на неіснуючий; далі Navigate
  const ledger = useLedgerYear(valid ? year : LATEST_YEAR);

  if (!valid) return <Navigate to="/" replace />;
  if (ledger.status === 'error') {
    return <Alert color="red">Не вдалося прочитати дані: {ledger.error.message}</Alert>;
  }
  if (ledger.status === 'loading') return <Loader aria-label="Завантаження" />;

  const result = ledger.results?.[month - 1];
  const rows = monthDocuments(ledger.docs, year, month, ledger.fx);
  const prev = month > 1 ? month - 1 : null;
  const next = month < 12 ? month + 1 : null;

  return (
    <Stack maw={1100}>
      <Group justify="space-between" align="end">
        <Title order={2}>
          {MONTH_NAMES[month - 1]} {year}
        </Title>
        <Group gap="md">
          {prev && (
            <Anchor component={Link} to={`/month/${year}/${prev}`}>
              ← {MONTH_NAMES[prev - 1]}
            </Anchor>
          )}
          <Anchor component={Link} to="/">
            Рік
          </Anchor>
          {next && (
            <Anchor component={Link} to={`/month/${year}/${next}`}>
              {MONTH_NAMES[next - 1]} →
            </Anchor>
          )}
        </Group>
      </Group>

      {ledger.error && (
        <Alert color="red" title="Не вдалося порахувати рік">
          {ledger.error}
        </Alert>
      )}

      {result && (
        <>
          <Title order={3} size="h4">
            До сплати
          </Title>
          <Table.ScrollContainer minWidth={420}>
            <Table aria-label="До сплати">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Що</Table.Th>
                  <Table.Th>Термін</Table.Th>
                  <Table.Th ta="right">Сума</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {monthPayments(year, result).map((p) => (
                  <Table.Tr key={p.key}>
                    <Table.Td>{p.label}</Table.Td>
                    <Table.Td>{formatDate(p.due)}</Table.Td>
                    <Table.Td ta="right">{formatPln(p.amount)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
              <Table.Tfoot>
                <Table.Tr fw={700}>
                  <Table.Td colSpan={2}>Разом</Table.Td>
                  <Table.Td ta="right">{formatPln(result.totalToPay)}</Table.Td>
                </Table.Tr>
              </Table.Tfoot>
            </Table>
          </Table.ScrollContainer>
          {result.vatCarryOut > 0 && (
            <Text size="sm" c="dimmed">
              Надвишка VAT на наступний місяць: {formatPln(result.vatCarryOut)} zł.
            </Text>
          )}
          {result.missingFxRates > 0 && (
            <Alert color="orange" title="Немає курсу NBP">
              Документів у валюті без курсу: {result.missingFxRates}. Їх не враховано в сумах.
            </Alert>
          )}
        </>
      )}

      <Group justify="space-between">
        <Title order={3} size="h4">
          Документи ({rows.length})
        </Title>
        {rows.length > 0 && (
          <Button
            variant="default"
            size="xs"
            onClick={() =>
              downloadCsv(
                `dokumenty-${year}-${String(month).padStart(2, '0')}.csv`,
                toCsv(MONTH_DOCS_CSV_HEADER, monthDocumentsCsvRows(rows)),
              )
            }
          >
            Експорт CSV
          </Button>
        )}
      </Group>
      {rows.length === 0 ? (
        <Text c="dimmed">За цей місяць документів немає.</Text>
      ) : (
        <Table.ScrollContainer minWidth={760}>
          <Table striped aria-label="Документи місяця">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Дата (PIT)</Table.Th>
                <Table.Th>Вид</Table.Th>
                <Table.Th>Номер</Table.Th>
                <Table.Th>Контрагент</Table.Th>
                <Table.Th ta="right">Przychód / koszt</Table.Th>
                <Table.Th ta="right">VAT</Table.Th>
                <Table.Th>Облік</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((d) => (
                <Table.Tr key={d.id}>
                  <Table.Td>{formatDate(d.pitDate)}</Table.Td>
                  <Table.Td>{KIND_LABEL[d.kind]}</Table.Td>
                  <Table.Td>{d.number}</Table.Td>
                  <Table.Td>{d.contractor || d.description || '—'}</Table.Td>
                  <Table.Td ta="right">{d.pitAmount === null ? '—' : formatPln(d.pitAmount)}</Table.Td>
                  <Table.Td ta="right">{d.vat === null ? '—' : formatPln(d.vat)}</Table.Td>
                  <Table.Td>
                    <Group gap={4}>
                      {d.missingFx && (
                        <Badge color="orange" size="xs">
                          без курсу
                        </Badge>
                      )}
                      {d.inKpir && (
                        <Badge variant="light" size="xs">
                          KPiR
                        </Badge>
                      )}
                      {d.inVat && (
                        <Badge variant="light" color="grape" size="xs">
                          VAT
                        </Badge>
                      )}
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      {result && (
        <>
          <Title order={3} size="h4">
            Zaliczka PIT наростаючим підсумком
          </Title>
          <PitDetails r={result} />
        </>
      )}
    </Stack>
  );
}
