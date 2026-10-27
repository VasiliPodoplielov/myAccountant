import {
  CATEGORY_RULES,
  closedPeriodsTouched,
  documentFxDetails,
  documentMonth,
  findSameDocuments,
  valueDocument,
  type CostCategory,
  type FxQuote,
  type VatRateCode,
} from '@jdg/core';
import {
  Alert,
  Anchor,
  Button,
  Collapse,
  Group,
  Loader,
  NumberInput,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { saveDocument, useDocuments, useFxRates, usePeriods } from '../data/hooks';
import { writeErrorMessage } from '../data/writeError';
import { syncFxRates } from '../data/fxSync';
import { formatPln } from '../format';
import { formatDate, localToday } from './accountingView';
import { DateField } from './DateField';
import {
  applyPreset,
  emptyForm,
  fromDocumentForm,
  fxRange,
  isReverseCharge,
  newDocumentId,
  PRESETS,
  switchKind,
  type DocumentForm,
} from './documentForm';

const CATEGORIES: { value: CostCategory; label: string }[] = [
  { value: 'carMixed', label: 'Авто мішане (VAT 50%, koszty 75%)' },
  { value: 'importServices', label: 'Import usług (VAT 23% нараховує платник)' },
  { value: 'office', label: 'Офіс' },
  { value: 'other', label: 'Інше' },
];

const VAT_RATES: { value: VatRateCode; label: string }[] = [
  { value: '23', label: '23%' },
  { value: '8', label: '8%' },
  { value: '5', label: '5%' },
  { value: '0', label: '0%' },
  { value: 'zw', label: 'zw' },
  { value: 'np', label: 'np' },
];

const CURRENCIES = ['PLN', 'EUR', 'USD'];

/** 4,2500: курси NBP мають чотири знаки */
const formatRate = ({ rate, date }: FxQuote) =>
  rate.toLocaleString('pl-PL', { minimumFractionDigits: 4, maximumFractionDigits: 4 }) +
  (date ? ` (з ${formatDate(date)})` : ' (вручну)');

const sameQuote = (a: FxQuote, b: FxQuote) => a.rate === b.rate && a.date === b.date;

const moneyProps = { decimalSeparator: ',', thousandSeparator: ' ', decimalScale: 2, allowNegative: false } as const;

type SaveState =
  | { kind: 'idle' | 'saving' }
  | { kind: 'saved'; month: string; warning: string | null }
  | { kind: 'error'; message: string };

function AddDocumentForm({ uid }: { uid: string }) {
  const [form, setForm] = useState<DocumentForm>(() => emptyForm(localToday()));
  const [more, setMore] = useState(false);
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const [fxError, setFxError] = useState<string | null>(null);
  /** Період, для якого запит до NBP уже завершився (з курсами чи без): відрізняє «завантажується» від «немає» */
  const [fxSyncedKey, setFxSyncedKey] = useState<string | null>(null);
  const eur = useFxRates('EUR');
  const usd = useFxRates('USD');
  const periods = usePeriods();
  const documents = useDocuments();

  // той самий номер від того самого контрагента вже є: попереджаємо, але не забороняємо (бувають корекції)
  const sameDocuments = useMemo(
    () =>
      documents.status === 'ready'
        ? findSameDocuments(
            {
              kind: form.kind,
              number: form.number,
              contractorName: form.contractorName,
              contractorNip: form.contractorNip,
            },
            documents.data,
          )
        : [],
    [documents, form.kind, form.number, form.contractorName, form.contractorNip],
  );

  const change = (patch: Partial<DocumentForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setState({ kind: 'idle' });
  };

  // чернетка документа для попереднього перегляду; помилки валідації показуємо лише при збереженні
  const draft = useMemo(() => fromDocumentForm(form), [form]);
  const range = draft.ok ? fxRange(draft.doc) : null;
  // документ у закритому місяці (за датою PIT, VAT чи оплати) не зберігається, доки місяць не відкрито знову
  const closedMonths = draft.ok && periods.status === 'ready' ? closedPeriodsTouched(draft.doc, periods.data) : [];
  const rangeKey = range && `${form.currency}:${range.from}:${range.to}`;
  const tables = useMemo(
    () => ({
      EUR: eur.status === 'ready' ? eur.data : {},
      USD: usd.status === 'ready' ? usd.data : {},
    }),
    [eur, usd],
  );

  // курси підтягуються самі, щойно відомі валюта й дати; кеш Firestore не дублюється
  const cached = form.currency === 'USD' ? usd : eur;
  const cacheReady = cached.status === 'ready';
  useEffect(() => {
    if (!range || form.currency === 'PLN' || !cacheReady) return;
    let cancelled = false;
    syncFxRates(uid, form.currency, range.from, range.to, tables[form.currency])
      .then(() => {
        if (cancelled) return;
        setFxError(null);
        setFxSyncedKey(rangeKey);
      })
      .catch((e: Error) => !cancelled && setFxError(e.message));
    return () => {
      cancelled = true;
    };
    // tables навмисно не в залежностях: після запису кешу він оновиться і викликав би зайвий запит
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, rangeKey, cacheReady]);

  const value = draft.ok && draft.doc.kind !== 'internal' ? valueDocument(draft.doc, tables) : null;
  const fx =
    value && draft.ok && draft.doc.kind !== 'internal' && form.currency !== 'PLN'
      ? documentFxDetails(draft.doc, tables)
      : null;
  const missingRate = draft.ok && draft.doc.kind !== 'internal' && draft.doc.currency !== 'PLN' && !value;

  const reverse = isReverseCharge(form);
  const foreign = form.currency !== 'PLN';

  const onSave = async () => {
    if (!draft.ok) {
      setState({ kind: 'error', message: draft.error });
      return;
    }
    if (closedMonths.length > 0 || periods.status !== 'ready') return;
    setState({ kind: 'saving' });
    try {
      // без курсу валютний документ не потрапить у розрахунок; докачуємо, якщо ефект не встиг
      let warning: string | null = null;
      if (range && form.currency !== 'PLN') {
        try {
          await syncFxRates(uid, form.currency, range.from, range.to, tables[form.currency]);
        } catch (e) {
          warning = `Курси NBP не завантажено (${(e as Error).message}): документ збережено, але без курсу він не враховується.`;
        }
      }
      await saveDocument(uid, newDocumentId(), draft.doc);
      const pit = value?.dates.pit ?? draft.doc.issueDate;
      setState({ kind: 'saved', month: pit.slice(0, 7), warning });
      // поля контрагента й категорії лишаються: наступний документ часто від того самого постачальника
      setForm((f) => ({ ...f, number: '', net: '', vat: '', ksefNumber: '', paidAt: '', saleDate: '' }));
    } catch (e) {
      setState({ kind: 'error', message: writeErrorMessage(e) });
    }
  };

  return (
    <Stack maw={640}>
      <Title order={2}>Додати документ</Title>

      <SegmentedControl
        fullWidth
        value={form.kind}
        onChange={(v) => {
          setForm((f) => switchKind(f, v as DocumentForm['kind']));
          setState({ kind: 'idle' });
        }}
        data={[
          { value: 'cost', label: 'Витрата' },
          { value: 'income', label: 'Дохід' },
        ]}
      />

      {form.kind === 'cost' && (
        <Group gap="xs" aria-label="Швидкі кнопки">
          {PRESETS.map((p) => (
            <Button
              key={p.id}
              variant="light"
              size="md"
              onClick={() => {
                setForm((f) => applyPreset(f, p));
                setState({ kind: 'idle' });
              }}
            >
              {p.label}
            </Button>
          ))}
        </Group>
      )}

      <SimpleGrid cols={{ base: 1, xs: 2 }}>
        <TextInput
          label="Номер документа"
          size="md"
          value={form.number}
          onChange={(e) => change({ number: e.currentTarget.value })}
        />
        <DateField
          label="Дата виставлення"
          size="md"
          value={form.issueDate}
          onChange={(v) => change({ issueDate: v })}
        />
      </SimpleGrid>

      <TextInput
        label={form.kind === 'cost' ? 'Постачальник' : 'Покупець'}
        size="md"
        value={form.contractorName}
        onChange={(e) => change({ contractorName: e.currentTarget.value })}
      />

      <SimpleGrid cols={{ base: 2, xs: 3 }}>
        <NumberInput
          label="Netto"
          description={
            form.vatRate === 'np' ? 'Для np — сума netto з рахунку; VAT не відлічується і в koszty не йде' : undefined
          }
          size="md"
          inputMode="decimal"
          hideControls
          {...moneyProps}
          value={form.net}
          onChange={(v) => change({ net: v === '' ? '' : Number(v) })}
        />
        <Select
          label="Валюта"
          size="md"
          data={CURRENCIES}
          value={form.currency}
          onChange={(v) => v && change({ currency: v as DocumentForm['currency'] })}
          allowDeselect={false}
        />
        <Select
          label="Ставка VAT"
          size="md"
          data={VAT_RATES}
          value={form.vatRate}
          onChange={(v) => v && change({ vatRate: v as VatRateCode })}
          allowDeselect={false}
        />
      </SimpleGrid>

      {!reverse && (
        <NumberInput
          label="VAT з фактури, zł"
          description="Порожньо — рахується від netto за ставкою"
          size="md"
          inputMode="decimal"
          hideControls
          {...moneyProps}
          value={form.vat}
          onChange={(v) => change({ vat: v === '' ? '' : Number(v) })}
          maw={240}
        />
      )}

      {form.kind === 'cost' && (
        <Select
          label="Категорія"
          size="md"
          data={CATEGORIES}
          value={form.category}
          onChange={(v) => v && change({ category: v as CostCategory })}
          allowDeselect={false}
        />
      )}

      <Switch label="Додатково" checked={more} onChange={(e) => setMore(e.currentTarget.checked)} />
      <Collapse expanded={more}>
        <Stack>
          <SimpleGrid cols={{ base: 1, xs: 2 }}>
            <TextInput
              label="Країна контрагента"
              description="Двобуквений код: PL, IE, US…"
              value={form.country}
              onChange={(e) => change({ country: e.currentTarget.value })}
              maxLength={2}
            />
            <TextInput
              label="NIP"
              value={form.contractorNip}
              onChange={(e) => change({ contractorNip: e.currentTarget.value })}
            />
            <DateField
              label="Дата продажу чи виконання послуги"
              value={form.saleDate}
              onChange={(v) => change({ saleDate: v })}
            />
            <DateField label="Дата оплати" value={form.paidAt} onChange={(v) => change({ paidAt: v })} />
          </SimpleGrid>
          <TextInput
            label="Опис для KPiR"
            value={form.description}
            onChange={(e) => change({ description: e.currentTarget.value })}
          />
          <TextInput
            label="Номер KSeF"
            value={form.ksefNumber}
            onChange={(e) => change({ ksefNumber: e.currentTarget.value })}
          />
          {form.kind === 'income' && (
            <Switch
              label="Розрахункові періоди (дохід у останній день періоду; вкажіть його як дату продажу)"
              checked={form.periodicSettlement}
              onChange={(e) => change({ periodicSettlement: e.currentTarget.checked })}
            />
          )}
        </Stack>
      </Collapse>

      {value && draft.ok && draft.doc.kind !== 'internal' && (
        <Table aria-label="Попередній розрахунок">
          <Table.Tbody>
            {fx && fx.pit !== null && fx.vat !== null && (
              <Table.Tr>
                <Table.Td>{sameQuote(fx.pit, fx.vat) ? 'Курс NBP' : 'Курс NBP (PIT)'}</Table.Td>
                <Table.Td ta="right">{formatRate(fx.pit)}</Table.Td>
              </Table.Tr>
            )}
            {fx && fx.pit !== null && fx.vat !== null && !sameQuote(fx.pit, fx.vat) && (
              <Table.Tr>
                <Table.Td>Курс NBP (VAT)</Table.Td>
                <Table.Td ta="right">{formatRate(fx.vat)}</Table.Td>
              </Table.Tr>
            )}
            {foreign && (
              <Table.Tr>
                <Table.Td>Netto за курсом NBP</Table.Td>
                <Table.Td ta="right">{formatPln(value.netPit)}</Table.Td>
              </Table.Tr>
            )}
            <Table.Tr>
              <Table.Td>VAT{reverse ? ' (нараховує платник)' : ''}</Table.Td>
              <Table.Td ta="right">{formatPln(value.vat)}</Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td>
                {form.kind === 'income'
                  ? 'Przychód'
                  : `Koszt PIT (${Math.round(CATEGORY_RULES[form.category].pitShare * 100)}%)`}
              </Table.Td>
              <Table.Td ta="right">{formatPln(value.pitAmount)}</Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Td>Дата в KPiR</Table.Td>
              <Table.Td ta="right">{formatDate(value.dates.pit)}</Table.Td>
            </Table.Tr>
            {value.dates.vat && (
              <Table.Tr>
                <Table.Td>Місяць реєстру VAT</Table.Td>
                <Table.Td ta="right">{value.dates.vat.slice(0, 7)}</Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      )}
      {missingRate && !fxError && fxSyncedKey !== rangeKey && (
        <Text size="sm" c="dimmed">
          Курс NBP завантажується…
        </Text>
      )}
      {missingRate && !fxError && fxSyncedKey === rangeKey && (
        <Alert color="orange" title="Курсу NBP на цю дату немає">
          NBP ще не опублікував курс (дата в майбутньому чи довга перерва). Документ можна зберегти, але без курсу він
          не враховується в сумах, доки курс не з'явиться.
        </Alert>
      )}
      {fxError && (
        <Alert color="yellow" title="Курси NBP не завантажено">
          {fxError}
        </Alert>
      )}

      {sameDocuments.length > 0 && (
        <Alert color="yellow" title="Такий документ уже є" role="alert">
          <Stack gap={4}>
            <Text size="sm">
              Документ {form.number.trim()} від цього контрагента вже внесено. Якщо це той самий рахунок, не зберігайте
              його вдруге.
            </Text>
            {sameDocuments.map((d) => {
              const month = documentMonth(d);
              const net = d.lines.reduce((sum, l) => sum + l.net, 0);
              return (
                <Anchor
                  key={d.id}
                  component={Link}
                  to={`/month/${month.slice(0, 4)}/${Number(month.slice(5))}`}
                  size="sm"
                >
                  {formatDate(d.issueDate)}, netto{' '}
                  {(net / 100).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                  {d.currency}: відкрити місяць {month}
                </Anchor>
              );
            })}
          </Stack>
        </Alert>
      )}

      {periods.status === 'error' && (
        <Alert color="red" role="alert">
          Не вдалося прочитати стан місяців ({periods.error.message}): збереження вимкнено, щоб не записати документ у
          закритий місяць.
        </Alert>
      )}
      {closedMonths.length > 0 && (
        <Alert color="orange" title="Місяць закрито" role="alert">
          Документ потрапляє в закритий місяць ({closedMonths.join(', ')}) і не буде збережений. Відкрийте місяць знову
          на екрані «Закриття», якщо потрібна корекція.
        </Alert>
      )}

      <Group>
        <Button
          size="md"
          onClick={() => void onSave()}
          loading={state.kind === 'saving'}
          disabled={closedMonths.length > 0 || periods.status !== 'ready'}
        >
          Зберегти
        </Button>
        {state.kind === 'saved' && (
          <Text size="sm" c="green" role="status">
            Збережено.{' '}
            <Anchor component={Link} to={`/month/${state.month.slice(0, 4)}/${Number(state.month.slice(5))}`}>
              Відкрити місяць
            </Anchor>
          </Text>
        )}
        {state.kind === 'error' && (
          <Text size="sm" c="red" role="alert">
            {state.message}
          </Text>
        )}
      </Group>
      {state.kind === 'saved' && state.warning && <Alert color="yellow">{state.warning}</Alert>}
    </Stack>
  );
}

export function AddDocumentPage() {
  const { state } = useAuth();
  if (state.status !== 'signedIn') return <Loader aria-label="Завантаження" />;
  return <AddDocumentForm uid={state.user.uid} />;
}
