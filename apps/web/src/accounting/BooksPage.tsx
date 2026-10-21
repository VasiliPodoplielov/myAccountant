import { TAX_CONFIG, type KpirTotals } from '@jdg/core';
import { Alert, Anchor, Button, Group, Loader, Stack, Table, Tabs, Text } from '@mantine/core';
import { useMemo } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { downloadCsv, toCsv } from '../csv';
import { formatPln } from '../format';
import { formatDate } from './accountingView';
import {
  kpirContractor,
  monthBooks,
  PURCHASE_FIELD_ORDER,
  SALES_FIELD_ORDER,
  usedFields,
  type MonthBooks,
} from './booksView';
import { KPIR_CSV_HEADER, kpirCsvRows, vatRegisterCsv } from './exportCsv';
import { MonthHeader } from './MonthHeader';
import { useLedgerYear } from './useLedgerYear';

const LATEST_YEAR = Number(Object.keys(TAX_CONFIG).at(-1));

const COLUMNS = ['col9', 'col10', 'col11', 'col12', 'col13', 'col14', 'col15', 'col16'] as const;
const COLUMN_NUMBER = (c: (typeof COLUMNS)[number]) => c.slice(3);

const FIELD_LABEL: Record<string, string> = {
  K_10: 'zw',
  K_11: 'poza PL',
  K_12: 'w tym UE',
  K_13: '0%',
  K_15: '5% netto',
  K_16: '5% VAT',
  K_17: '8% netto',
  K_18: '8% VAT',
  K_19: '23% netto',
  K_20: '23% VAT',
  K_27: 'Import usług (poza UE) netto',
  K_28: 'Import usług (poza UE) VAT',
  K_29: 'Import usług (UE) netto',
  K_30: 'Import usług (UE) VAT',
  K_42: 'Nabycia netto',
  K_43: 'VAT do odliczenia',
};

function TotalsRow({ label, totals }: { label: string; totals: KpirTotals }) {
  return (
    <Table.Tr fw={700}>
      <Table.Td colSpan={5}>{label}</Table.Td>
      {COLUMNS.map((c) => (
        <Table.Td key={c} ta="right">
          {formatPln(totals[c])}
        </Table.Td>
      ))}
    </Table.Tr>
  );
}

function KpirTab({ books, year, month }: { books: MonthBooks; year: number; month: number }) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  return (
    <Stack>
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          Взірець з 1.01.2026: колонки 1–16 (17–19 не ведуться). Lp. наскрізний за рік.
        </Text>
        {books.kpir.length > 0 && (
          <Button
            variant="default"
            size="xs"
            onClick={() => downloadCsv(`kpir-${prefix}.csv`, toCsv(KPIR_CSV_HEADER, kpirCsvRows(books.kpir)))}
          >
            Експорт CSV
          </Button>
        )}
      </Group>
      {books.kpir.length === 0 ? (
        <Text c="dimmed">За цей місяць записів KPiR немає.</Text>
      ) : (
        <Table.ScrollContainer minWidth={1300}>
          <Table striped aria-label="KPiR">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>1 Lp.</Table.Th>
                <Table.Th>2 Data</Table.Th>
                <Table.Th>3–4 Nr KSeF / dowód</Table.Th>
                <Table.Th>5–6 Kontrahent</Table.Th>
                <Table.Th>8 Opis</Table.Th>
                {COLUMNS.map((c) => (
                  <Table.Th key={c} ta="right">
                    {COLUMN_NUMBER(c)}
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {books.kpir.map((e) => (
                <Table.Tr key={e.lp}>
                  <Table.Td>{e.lp}</Table.Td>
                  <Table.Td>{formatDate(e.date)}</Table.Td>
                  <Table.Td>
                    {e.docNumber}
                    {e.ksefNumber && (
                      <Text size="xs" c="dimmed">
                        {e.ksefNumber}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>{kpirContractor(e) || '—'}</Table.Td>
                  <Table.Td>{e.description}</Table.Td>
                  {COLUMNS.map((c) => {
                    const value = c === 'col11' ? e.col9 + e.col10 : c === 'col16' ? e.col14 + e.col15 : e[c];
                    return (
                      <Table.Td key={c} ta="right">
                        {value === 0 ? '' : formatPln(value)}
                      </Table.Td>
                    );
                  })}
                </Table.Tr>
              ))}
            </Table.Tbody>
            <Table.Tfoot>
              <TotalsRow label="Razem miesiąc" totals={books.kpirTotals} />
              <TotalsRow label="Razem od początku roku" totals={books.kpirYearToDate} />
            </Table.Tfoot>
          </Table>
        </Table.ScrollContainer>
      )}
    </Stack>
  );
}

interface RegisterRow {
  date: string;
  docNumber: string;
  contractor: { name: string; nip?: string };
  ksefNumber?: string;
  marker?: string;
  fields: Partial<Record<string, number>>;
}

function RegisterTab({
  title,
  fileName,
  rows,
  fields,
  totals,
  emptyText,
  children,
}: {
  title: string;
  fileName: string;
  rows: RegisterRow[];
  fields: string[];
  totals: Partial<Record<string, number>>;
  emptyText: string;
  children?: React.ReactNode;
}) {
  return (
    <Stack>
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          Поля ewidencji JPK_V7M(3); показано лише заповнені.
        </Text>
        {rows.length > 0 && (
          <Button
            variant="default"
            size="xs"
            onClick={() => {
              const csv = vatRegisterCsv(rows, fields, totals);
              downloadCsv(fileName, toCsv(csv.header, csv.rows));
            }}
          >
            Експорт CSV
          </Button>
        )}
      </Group>
      {rows.length === 0 ? (
        <Text c="dimmed">{emptyText}</Text>
      ) : (
        <Table.ScrollContainer minWidth={760}>
          <Table striped aria-label={title}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Data</Table.Th>
                <Table.Th>Numer</Table.Th>
                <Table.Th>Kontrahent</Table.Th>
                <Table.Th>KSeF / oznaczenie</Table.Th>
                {fields.map((f) => (
                  <Table.Th key={f} ta="right">
                    {f.replace('_', ' ')}
                    <Text size="xs" c="dimmed" fw={400}>
                      {FIELD_LABEL[f]}
                    </Text>
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((r, i) => (
                <Table.Tr key={`${r.docNumber}-${i}`}>
                  <Table.Td>{formatDate(r.date)}</Table.Td>
                  <Table.Td>{r.docNumber}</Table.Td>
                  <Table.Td>
                    {r.contractor.name}
                    {r.contractor.nip && (
                      <Text size="xs" c="dimmed">
                        {r.contractor.nip}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>{r.ksefNumber ?? r.marker ?? '—'}</Table.Td>
                  {fields.map((f) => (
                    <Table.Td key={f} ta="right">
                      {r.fields[f] === undefined ? '' : formatPln(r.fields[f])}
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
            <Table.Tfoot>
              <Table.Tr fw={700}>
                <Table.Td colSpan={4}>Razem</Table.Td>
                {fields.map((f) => (
                  <Table.Td key={f} ta="right">
                    {formatPln(totals[f] ?? 0)}
                  </Table.Td>
                ))}
              </Table.Tr>
            </Table.Tfoot>
          </Table>
        </Table.ScrollContainer>
      )}
      {children}
    </Stack>
  );
}

export function BooksPage() {
  const params = useParams();
  const year = Number(params.year);
  const month = Number(params.month);
  const valid = TAX_CONFIG[year] !== undefined && Number.isInteger(month) && month >= 1 && month <= 12;
  // для неправильної адреси підписуємось на останній рік, щоб не відкривати слухач на неіснуючий; далі Navigate
  const ledger = useLedgerYear(valid ? year : LATEST_YEAR);
  // книга й реєстри будуються за весь рік: без мемоізації це робилося б при кожному рендері
  const books = useMemo(
    () => (valid && ledger.status === 'ready' ? monthBooks(ledger.docs, ledger.results, year, month, ledger.fx) : null),
    [ledger, valid, year, month],
  );

  if (!valid) return <Navigate to="/" replace />;
  if (ledger.status === 'error') {
    return <Alert color="red">Не вдалося прочитати дані: {ledger.error.message}</Alert>;
  }
  if (ledger.status === 'loading' || !books) return <Loader aria-label="Завантаження" />;

  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const salesFields = usedFields(SALES_FIELD_ORDER, books.salesTotals);
  const purchaseFields = usedFields(PURCHASE_FIELD_ORDER, books.purchaseTotals);

  return (
    <Stack maw={1300}>
      <MonthHeader year={year} month={month} section="books" />

      {!ledger.hasSettings && (
        <Alert color="yellow" title="Налаштування року не заповнені">
          Записи «Składki ZUS» у KPiR рахуються без доходу й składek за грудень попереднього року.{' '}
          <Anchor component={Link} to="/settings">
            Заповнити
          </Anchor>
        </Alert>
      )}
      {ledger.error && (
        <Alert color="red" title="Не вдалося порахувати рік">
          {ledger.error} Записів «Składki ZUS» у KPiR немає: книга неповна.
        </Alert>
      )}

      <Tabs defaultValue="kpir" variant="pills" keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="kpir">KPiR ({books.kpir.length})</Tabs.Tab>
          <Tabs.Tab value="sales">Rejestr sprzedaży ({books.sales.length})</Tabs.Tab>
          <Tabs.Tab value="purchases">Rejestr zakupu ({books.purchases.length})</Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="kpir" pt="md">
          <KpirTab books={books} year={year} month={month} />
        </Tabs.Panel>
        <Tabs.Panel value="sales" pt="md">
          <RegisterTab
            title="Rejestr sprzedaży"
            fileName={`vat-sprzedaz-${prefix}.csv`}
            rows={books.sales}
            fields={salesFields}
            totals={books.salesTotals}
            emptyText="За цей місяць у реєстрі продажу записів немає."
          >
            <Text size="sm">
              VAT należny до декларації: <strong>{formatPln(books.declaration.output)}</strong> zł (кожна позиція
              округлена до злотих).
            </Text>
          </RegisterTab>
        </Tabs.Panel>
        <Tabs.Panel value="purchases" pt="md">
          <RegisterTab
            title="Rejestr zakupu"
            fileName={`vat-zakup-${prefix}.csv`}
            rows={books.purchases}
            fields={purchaseFields}
            totals={books.purchaseTotals}
            emptyText="За цей місяць у реєстрі закупівлі записів немає."
          >
            <Text size="sm">
              VAT naliczony до декларації: <strong>{formatPln(books.declaration.input)}</strong> zł.
            </Text>
          </RegisterTab>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
