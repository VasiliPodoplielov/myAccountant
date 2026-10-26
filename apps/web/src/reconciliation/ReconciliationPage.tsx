import {
  REFERENCE_PART_LABELS,
  TAX_CONFIG,
  yearReport,
  type MonthReference,
  type MonthReport,
  type ReferenceMetric,
  type YearSettings,
} from '@jdg/core';
import {
  Accordion,
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  Loader,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { downloadCsv, toCsv } from '../csv';
import { RECONCILIATION_CSV_HEADER, reconciliationCsvRows } from '../accounting/exportCsv';
import { saveReferenceParts, useDocuments, useFxRates, useReferences, useYearSettings } from '../data/hooks';
import { formatDiff, formatPln } from '../format';
import { EMPTY_SETTINGS } from '../settings/settingsForm';
import {
  MONTH_NAMES,
  cleanNotes,
  derivedFromLabel,
  diffStatus,
  fromReferenceForm,
  metricLabel,
  toReferenceForm,
  type DiffStatus,
  type ReferenceForm,
} from './referenceForm';

const YEARS = Object.keys(TAX_CONFIG);

const FORM_FIELDS: { key: keyof ReferenceForm; label: string }[] = [
  { key: 'col9', label: 'KPiR, кол. 9' },
  { key: 'col10', label: 'KPiR, кол. 10' },
  { key: 'col15', label: 'KPiR, кол. 15' },
  { key: 'social', label: 'DRA: społeczne' },
  { key: 'fp', label: 'DRA: Fundusz Pracy' },
  { key: 'health', label: 'DRA: zdrowotna' },
  { key: 'pitAdvance', label: 'Zaliczka PIT' },
];

function statusBadges(m: MonthReport) {
  if (!m.hasReference) return <Badge color="gray">немає еталона</Badge>;
  return (
    <>
      {m.unexplained > 0 && <Badge color="red">непояснених різниць: {m.unexplained}</Badge>}
      {m.missing.length > 0 && <Badge color="orange">еталон неповний</Badge>}
      {m.unexplained === 0 && m.missing.length === 0 && <Badge color="green">звірено</Badge>}
    </>
  );
}

const DIFF_COLOR: Record<DiffStatus, string | undefined> = {
  match: undefined,
  derived: 'dimmed',
  explained: 'orange',
  unexplained: 'red',
};

/** Ручна частина еталона за місяць: підсумки KPiR, DRA, zaliczka */
function ReferenceEditor({ uid, period, reference }: { uid: string; period: string; reference?: MonthReference }) {
  const [form, setForm] = useState(() => toReferenceForm(reference));
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | string>('idle');

  const onSave = async () => {
    setState('saving');
    try {
      await saveReferenceParts(uid, period, fromReferenceForm(form), ['kpir', 'zus', 'pitAdvance']);
      setState('saved');
    } catch (e) {
      setState((e as Error).message);
    }
  };

  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>
        Еталон з KPiR, DRA і розрахунку zaliczki (порожнє поле не порівнюється)
      </Text>
      <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }}>
        {FORM_FIELDS.map((f) => (
          <NumberInput
            key={f.key}
            label={f.label}
            value={form[f.key]}
            onChange={(v) => {
              setForm((old) => ({ ...old, [f.key]: v === '' ? '' : Number(v) }));
              setState('idle');
            }}
            decimalSeparator=","
            thousandSeparator=" "
            decimalScale={2}
            suffix=" zł"
            hideControls
          />
        ))}
      </SimpleGrid>
      <Group>
        <Button size="xs" onClick={() => void onSave()} loading={state === 'saving'}>
          Зберегти еталон
        </Button>
        {state === 'saved' && (
          <Text size="sm" c="green">
            Збережено
          </Text>
        )}
        {state !== 'idle' && state !== 'saving' && state !== 'saved' && (
          <Text size="sm" c="red">
            {state}
          </Text>
        )}
      </Group>
    </Stack>
  );
}

/** Таблиця різниць з полем пояснення; пояснення зберігається, коли поле втрачає фокус */
function DiffTable({ uid, month, reference }: { uid: string; month: MonthReport; reference?: MonthReference }) {
  const [notes, setNotes] = useState<Partial<Record<ReferenceMetric, string>>>(() => reference?.notes ?? {});
  const [error, setError] = useState<string | null>(null);

  if (month.rows.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        Порівнювати нема з чим: імпортуйте JPK за місяць або внесіть суми нижче.
      </Text>
    );
  }

  const saveNotes = async () => {
    try {
      const clean = cleanNotes(notes);
      await saveReferenceParts(uid, month.period, { notes: Object.keys(clean).length ? clean : undefined }, ['notes']);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Stack gap={4}>
      <Table.ScrollContainer minWidth={760}>
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Показник</Table.Th>
              <Table.Th ta="right">Облік</Table.Th>
              <Table.Th ta="right">Бухгалтер</Table.Th>
              <Table.Th ta="right">Різниця</Table.Th>
              <Table.Th ta="right">З неї наслідок</Table.Th>
              <Table.Th>Пояснення</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {month.rows.map((r) => {
              const status = diffStatus(r, notes[r.metric]);
              return (
                <Table.Tr key={r.metric}>
                  <Table.Td>{metricLabel(r.metric)}</Table.Td>
                  <Table.Td ta="right">{formatPln(r.app)}</Table.Td>
                  <Table.Td ta="right">{formatPln(r.reference)}</Table.Td>
                  <Table.Td ta="right" c={DIFF_COLOR[status]}>
                    {formatDiff(r.diff)}
                  </Table.Td>
                  <Table.Td ta="right">
                    {r.diff !== 0 && r.derived !== 0 && (
                      <>
                        <Text size="sm" c="dimmed">
                          {formatDiff(r.derived)}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {derivedFromLabel(r.derivedFrom)}
                        </Text>
                      </>
                    )}
                  </Table.Td>
                  <Table.Td>
                    {status === 'derived' && !notes[r.metric] ? (
                      <Text size="xs" c="dimmed">
                        Наслідок різниць KPiR, пояснення не потрібне
                      </Text>
                    ) : (
                      ((r.diff !== 0 && r.root !== 0) || notes[r.metric]) && (
                        <TextInput
                          size="xs"
                          aria-label={`Пояснення: ${metricLabel(r.metric)}`}
                          placeholder={
                            r.derived !== 0 ? `Чому різниця (без наслідку: ${formatDiff(r.root)})` : 'Чому різниця'
                          }
                          value={notes[r.metric] ?? ''}
                          onChange={(e) => {
                            const value = e.currentTarget.value;
                            setNotes((n) => ({ ...n, [r.metric]: value }));
                          }}
                          onBlur={() => void saveNotes()}
                        />
                      )
                    )}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      {error && (
        <Text size="sm" c="red">
          Пояснення не збережено: {error}
        </Text>
      )}
    </Stack>
  );
}

/**
 * Форми тримають введене локально; key від збережених значень перемонтовує їх, коли еталон змінився
 * в Firestore (імпорт, інший пристрій), щоб не показувати застарілі суми.
 */
function MonthPanel({ uid, month, reference }: { uid: string; month: MonthReport; reference?: MonthReference }) {
  const manualKey = JSON.stringify([reference?.kpir, reference?.zus, reference?.pitAdvance]);
  return (
    <Stack>
      {month.hasReference && month.missing.length > 0 && (
        <Alert color="orange" title="Еталон неповний">
          Немає: {month.missing.map((p) => REFERENCE_PART_LABELS[p]).join(', ')}. Без цього місяць не вважається
          звіреним і його не можна закрити.
        </Alert>
      )}
      <DiffTable key={JSON.stringify(reference?.notes ?? {})} uid={uid} month={month} reference={reference} />
      <ReferenceEditor key={manualKey} uid={uid} period={month.period} reference={reference} />
    </Stack>
  );
}

export function ReconciliationPage() {
  const { state } = useAuth();
  const uid = state.status === 'signedIn' ? state.user.uid : null;
  const [year, setYear] = useState(YEARS.at(-1)!);
  const cfg = TAX_CONFIG[Number(year)]!;

  const docs = useDocuments();
  const settings = useYearSettings(cfg.year);
  const references = useReferences();
  const eur = useFxRates('EUR');
  const usd = useFxRates('USD');
  const states = [docs, settings, references, eur, usd];

  const report = useMemo((): { ok: true; months: MonthReport[] } | { ok: false; error: string } | null => {
    if (docs.status !== 'ready' || settings.status !== 'ready' || references.status !== 'ready') return null;
    if (eur.status !== 'ready' || usd.status !== 'ready') return null;
    const yearSettings: YearSettings = settings.data ?? EMPTY_SETTINGS;
    try {
      return {
        ok: true,
        months: yearReport(docs.data, yearSettings, cfg, references.data, { fx: { EUR: eur.data, USD: usd.data } }),
      };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }, [docs, settings, references, eur, usd, cfg]);

  const failed = states.find((s) => s.status === 'error');
  if (failed && failed.status === 'error') {
    return <Alert color="red">Не вдалося прочитати дані: {failed.error.message}</Alert>;
  }
  if (!report || !uid) return <Loader aria-label="Завантаження" />;

  return (
    <Stack maw={1100}>
      <Group justify="space-between" align="end">
        <Title order={2}>Звірка з бухгалтером</Title>
        <Group align="end">
          {report.ok && (
            <Button
              variant="default"
              onClick={() =>
                downloadCsv(
                  `zvirka-${year}.csv`,
                  toCsv(RECONCILIATION_CSV_HEADER, reconciliationCsvRows(report.months)),
                )
              }
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
      <Text size="sm" c="dimmed">
        Облік рахує з документів; еталон — з поданої JPK_V7M (імпорт) і з сум, внесених нижче з KPiR, DRA і розрахунку
        zaliczki. Місяць звірено, коли еталон повний, а кожна різниця нульова, пояснена або є наслідком різниць KPiR:
        різниця витрат у місяці M змінює zdrowotną за M+1, яка повертається в кол. 15 у M+2, і zaliczkę.
      </Text>
      {settings.status === 'ready' && settings.data === null && (
        <Alert color="yellow" title="Налаштування року не заповнені">
          ZUS, zdrowotna і zaliczka PIT рахуються без доходу й składek за грудень попереднього року.{' '}
          <Anchor component={Link} to="/settings">
            Заповнити
          </Anchor>
        </Alert>
      )}
      {!report.ok ? (
        <Alert color="red" title="Не вдалося порахувати рік">
          {report.error}
        </Alert>
      ) : (
        <Accordion multiple variant="separated">
          {report.months.map((m) => (
            <Accordion.Item key={m.period} value={m.period}>
              <Accordion.Control>
                <Group gap="sm">
                  <Text fw={500}>
                    {MONTH_NAMES[m.month - 1]} {year}
                  </Text>
                  {statusBadges(m)}
                </Group>
              </Accordion.Control>
              <Accordion.Panel>
                <MonthPanel
                  uid={uid}
                  month={m}
                  reference={references.status === 'ready' ? references.data[m.period] : undefined}
                />
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      )}
    </Stack>
  );
}
