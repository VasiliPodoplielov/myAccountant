import { TAX_CONFIG, type YearSettings } from '@jdg/core';
import {
  Alert,
  Button,
  Group,
  Loader,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  Title,
} from '@mantine/core';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { saveYearSettings, useYearSettings } from '../data/hooks';
import { MONTH_NAMES } from '../reconciliation/referenceForm';
import { fromSettingsForm, toSettingsForm, type SettingsForm } from './settingsForm';

const YEARS = Object.keys(TAX_CONFIG);

const amountProps = {
  decimalSeparator: ',',
  thousandSeparator: ' ',
  decimalScale: 2,
  allowNegative: false,
  suffix: ' zł',
  hideControls: true,
} as const;

function SettingsEditor({ uid, year, saved }: { uid: string; year: number; saved: YearSettings | null }) {
  const [form, setForm] = useState<SettingsForm>(() => toSettingsForm(saved));
  const [state, setState] = useState<{ kind: 'idle' | 'saving' | 'saved' } | { kind: 'error'; message: string }>({
    kind: 'idle',
  });

  const set = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setState({ kind: 'idle' });
  };
  const amount = (
    key: 'prevDecemberIncome' | 'prevDecemberSocial' | 'prevDecemberFp' | 'prevDecemberHealth' | 'openingVatCarry',
  ) => ({
    value: form[key],
    onChange: (v: number | string) => set(key, v === '' ? '' : Number(v)),
  });

  const onSave = async () => {
    const result = fromSettingsForm(form);
    if (!result.ok) {
      setState({ kind: 'error', message: result.error });
      return;
    }
    setState({ kind: 'saving' });
    try {
      await saveYearSettings(uid, year, result.settings);
      setState({ kind: 'saved' });
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message });
    }
  };

  return (
    <Stack>
      {saved === null && <Alert color="yellow">Налаштування {year} року ще не збережені: нижче типові значення.</Alert>}

      <Title order={3} size="h4">
        ZUS
      </Title>
      <Switch
        label="Добровільна chorobowa"
        checked={form.chorobowe}
        onChange={(e) => set('chorobowe', e.currentTarget.checked)}
      />
      <Select
        label="Wakacje składkowe"
        description="Місяць, за який społeczne і FP оплачує бюджет"
        data={[{ value: '', label: 'немає' }, ...MONTH_NAMES.map((name, i) => ({ value: String(i + 1), label: name }))]}
        value={form.contributionHolidayMonth}
        onChange={(v) => set('contributionHolidayMonth', v ?? '')}
        allowDeselect={false}
        maw={320}
      />
      <Switch
        label="Zdrowotna в kosztach (як веде бухгалтер)"
        checked={form.healthAsCost}
        onChange={(e) => set('healthAsCost', e.currentTarget.checked)}
      />

      <Title order={3} size="h4">
        Грудень {year - 1}
      </Title>
      <NumberInput
        label="Дохід за грудень"
        description="Від нього рахується zdrowotna за січень (рядок «Kwota dochodu» у DRA за січень)"
        {...amountProps}
        {...amount('prevDecemberIncome')}
        maw={320}
      />
      <Text size="sm" c="dimmed">
        Składki за грудень, сплачені в січні {year}: відлічуються в січні. Якщо їх сплачено ще в грудні — лишіть
        порожніми.
      </Text>
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <NumberInput label="Społeczne" {...amountProps} {...amount('prevDecemberSocial')} />
        <NumberInput label="Fundusz Pracy" {...amountProps} {...amount('prevDecemberFp')} />
        <NumberInput label="Zdrowotna" {...amountProps} {...amount('prevDecemberHealth')} />
      </SimpleGrid>

      <Title order={3} size="h4">
        Початкові залишки на 1 січня {year}
      </Title>
      <NumberInput
        label="Надвишка VAT з грудня"
        description="P_39 січневої декларації; порожньо — нуль"
        {...amountProps}
        {...amount('openingVatCarry')}
        maw={320}
      />
      <Text size="sm" c="dimmed">
        Основних засобів в ewidencji немає: авто не внесене, його витрати йдуть у koszty як «авто мішане».
      </Text>

      <Group>
        <Button onClick={() => void onSave()} loading={state.kind === 'saving'}>
          Зберегти
        </Button>
        {state.kind === 'saved' && (
          <Text size="sm" c="green">
            Збережено
          </Text>
        )}
        {state.kind === 'error' && (
          <Text size="sm" c="red" role="alert">
            {state.message}
          </Text>
        )}
      </Group>
    </Stack>
  );
}

export function SettingsPage() {
  const { state } = useAuth();
  const uid = state.status === 'signedIn' ? state.user.uid : null;
  const [year, setYear] = useState(YEARS.at(-1)!);
  const settings = useYearSettings(Number(year));

  return (
    <Stack maw={720}>
      <Group justify="space-between" align="end">
        <Title order={2}>Налаштування року</Title>
        <Select label="Рік" data={YEARS} value={year} onChange={(v) => v && setYear(v)} allowDeselect={false} w={120} />
      </Group>
      {settings.status === 'error' && <Alert color="red">Не вдалося прочитати: {settings.error.message}</Alert>}
      {settings.status === 'loading' || !uid ? (
        <Loader aria-label="Завантаження" />
      ) : (
        settings.status === 'ready' && (
          // key: нові дані з Firestore (інший рік, інший пристрій) перезаповнюють форму
          <SettingsEditor
            key={`${year}:${JSON.stringify(settings.data)}`}
            uid={uid}
            year={Number(year)}
            saved={settings.data}
          />
        )
      )}
    </Stack>
  );
}
