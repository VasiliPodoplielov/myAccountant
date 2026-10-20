import {
  CATEGORY_RULES,
  documentFxDetails,
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
import { saveDocument, useFxRates } from '../data/hooks';
import { syncFxRates } from '../data/fxSync';
import { formatPln } from '../format';
import { formatDate } from './accountingView';
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

/** Сьогодні за місцевим часом: toISOString дав би UTC і до 02:00 влітку показав би вчорашню дату */
function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

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

  const change = (patch: Partial<DocumentForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    setState({ kind: 'idle' });
  };

  // чернетка документа для попереднього перегляду; помилки валідації показуємо лише при збереженні
  const draft = useMemo(() => fromDocumentForm(form), [form]);
  const range = draft.ok ? fxRange(draft.doc) : null;
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
      setState({ kind: 'error', message: (e as Error).message });
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
        <TextInput
          label="Дата виставлення"
          type="date"
          size="md"
          value={form.issueDate}
          onChange={(e) => change({ issueDate: e.currentTarget.value })}
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
            <TextInput
              label="Дата продажу чи виконання послуги"
              type="date"
              value={form.saleDate}
              onChange={(e) => change({ saleDate: e.currentTarget.value })}
            />
            <TextInput
              label="Дата оплати"
              type="date"
              value={form.paidAt}
              onChange={(e) => change({ paidAt: e.currentTarget.value })}
            />
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

      <Group>
        <Button size="md" onClick={() => void onSave()} loading={state.kind === 'saving'}>
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
