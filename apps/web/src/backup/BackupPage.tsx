import {
  backupToJson,
  buildBackup,
  parseBackup,
  restoreOps,
  restoreTouchesClosed,
  TAX_CONFIG,
  verifyBackup,
  type Backup,
  type BackupData,
} from '@jdg/core';
import {
  Alert,
  Badge,
  Button,
  FileInput,
  Group,
  List,
  Loader,
  Modal,
  Select,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { useMemo, useState } from 'react';
import { DOCUMENTS_CSV_HEADER, documentsCsvRows } from '../accounting/exportCsv';
import { useAuth } from '../auth/AuthContext';
import { downloadCsv, toCsv } from '../csv';
import {
  restoreBackupOps,
  useCategoryOverrides,
  useDocuments,
  useFxRateDocs,
  usePeriods,
  useReferences,
  useVendorRules,
  useYearSettings,
} from '../data/hooks';
import { writeErrorMessage } from '../data/writeError';
import { EMPTY_SETTINGS } from '../settings/settingsForm';
import { downloadText, readFileText } from './files';

const YEARS = Object.keys(TAX_CONFIG);

type Loaded = { status: 'ready'; data: BackupData } | { status: 'loading' } | { status: 'error'; error: Error };

/** Усі дані, що входять у бекап, з однієї точки; поки щось вантажиться, бекап не можна робити */
function useBackupData(year: number): Loaded {
  const docs = useDocuments();
  const settings = useYearSettings(year);
  const references = useReferences();
  const periods = usePeriods();
  const rules = useVendorRules();
  const overrides = useCategoryOverrides();
  const fx = useFxRateDocs();
  return useMemo((): Loaded => {
    const states = [docs, settings, references, periods, rules, overrides, fx];
    const failed = states.find((s) => s.status === 'error');
    if (failed?.status === 'error') return { status: 'error', error: failed.error };
    if (
      docs.status !== 'ready' ||
      settings.status !== 'ready' ||
      references.status !== 'ready' ||
      periods.status !== 'ready' ||
      rules.status !== 'ready' ||
      overrides.status !== 'ready' ||
      fx.status !== 'ready'
    ) {
      return { status: 'loading' };
    }
    return {
      status: 'ready',
      data: {
        settings: settings.data,
        documents: docs.data,
        references: references.data,
        periods: periods.data,
        vendorRules: rules.data,
        categoryOverrides: overrides.data,
        fxRates: fx.data,
      },
    };
  }, [docs, settings, references, periods, rules, overrides, fx]);
}

const counts = (b: Backup): [string, number][] => [
  ['Документи', b.documents.length],
  ['Еталон за місяці', Object.keys(b.references).length],
  ['Стан місяців', Object.keys(b.periods).length],
  ['Правила контрагентів', Object.keys(b.vendorRules).length],
  ['Категорії документів', Object.keys(b.categoryOverrides).length],
  ['Курси NBP', Object.keys(b.fxRates).length],
];

function CountsTable({ backup, label }: { backup: Backup; label: string }) {
  return (
    <Table aria-label={label} maw={420}>
      <Table.Tbody>
        {counts(backup).map(([name, n]) => (
          <Table.Tr key={name}>
            <Table.Td>{name}</Table.Td>
            <Table.Td ta="right">{n}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

export function BackupPage() {
  const { state: auth } = useAuth();
  const uid = auth.status === 'signedIn' ? auth.user.uid : null;
  const [year, setYear] = useState(YEARS.at(-1)!);
  const data = useBackupData(Number(year));

  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<{ ok: true; backup: Backup } | { ok: false; errors: string[] } | null>(null);
  const [restoring, setRestoring] = useState<'confirm' | 'busy' | null>(null);
  const [restored, setRestored] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onFile = async (next: File | null) => {
    setFile(next);
    setRestored(null);
    setError(null);
    setParsed(next ? parseBackup(await readFileText(next)) : null);
  };

  if (data.status === 'error') return <Alert color="red">Не вдалося прочитати дані: {data.error.message}</Alert>;
  if (data.status === 'loading') return <Loader aria-label="Завантаження" />;

  // для лічильників на екрані; файл збирається заново в момент експорту
  const backup = buildBackup(data.data, Number(year), new Date());
  const backupCfg = parsed?.ok ? TAX_CONFIG[parsed.backup.year] : undefined;
  const verification =
    parsed?.ok === true
      ? verifyBackup(
          parsed.backup,
          data.data,
          backupCfg ? { cfg: backupCfg, emptySettings: EMPTY_SETTINGS } : undefined,
        )
      : null;
  const closedTouched = parsed?.ok ? restoreTouchesClosed(parsed.backup, data.data) : [];

  const exportJson = () =>
    downloadText(
      `jdg-backup-${year}.json`,
      backupToJson(buildBackup(data.data, Number(year), new Date())),
      'application/json',
    );
  const exportCsv = () =>
    downloadCsv(`dokumenty-${year}.csv`, toCsv(DOCUMENTS_CSV_HEADER, documentsCsvRows(backup.documents)));

  const restore = async () => {
    if (!uid || !parsed?.ok) return;
    setRestoring('busy');
    setError(null);
    try {
      const ops = restoreOps(parsed.backup, data.data.periods);
      await restoreBackupOps(uid, ops);
      setRestored(ops.length);
      setRestoring(null);
    } catch (e) {
      setError(writeErrorMessage(e));
      setRestoring('confirm');
    }
  };

  return (
    <Stack maw={900}>
      <Group justify="space-between" align="end">
        <Title order={2}>Бекап</Title>
        <Select label="Рік" data={YEARS} value={year} onChange={(v) => v && setYear(v)} allowDeselect={false} w={120} />
      </Group>
      <Text size="sm" c="dimmed">
        Експорт року: документи, налаштування, еталон, стан місяців, правила контрагентів і категорій та потрібні курси
        NBP. JSON — повний знімок, з якого можна відновити дані; CSV документів — для перегляду в Excel. Зберігайте
        файли поза цим пристроєм і не кладіть їх у репозиторій.
      </Text>

      <Title order={3} size="h4">
        Експорт
      </Title>
      <CountsTable backup={backup} label="Склад бекапу" />
      <Group>
        <Button onClick={exportJson}>Експорт JSON</Button>
        <Button variant="default" onClick={exportCsv} disabled={backup.documents.length === 0}>
          Експорт CSV документів
        </Button>
      </Group>

      <Title order={3} size="h4">
        Перевірка і відновлення
      </Title>
      <Text size="sm" c="dimmed">
        Оберіть файл бекапу. Перевірка нічого не змінює: вона порівнює файл з тим, що зараз у базі, і показує, чи
        однакові місячні суми, порахувані з обох наборів.
      </Text>
      <FileInput
        label="Файл бекапу (JSON)"
        placeholder="Обрати файл"
        accept="application/json,.json"
        value={file}
        onChange={(f) => void onFile(f)}
        clearable
      />

      {parsed && !parsed.ok && (
        <Alert color="red" title="Файл не підходить" role="alert">
          <List size="sm">
            {parsed.errors.slice(0, 10).map((e) => (
              <List.Item key={e}>{e}</List.Item>
            ))}
          </List>
          {parsed.errors.length > 10 && <Text size="sm">…і ще {parsed.errors.length - 10}</Text>}
        </Alert>
      )}

      {parsed?.ok && verification && (
        <Stack>
          <Group gap="sm">
            <Text fw={600}>Бекап за {parsed.backup.year} рік</Text>
            <Text size="sm" c="dimmed">
              експортовано {parsed.backup.exportedAt.slice(0, 16).replace('T', ' ')} UTC
            </Text>
          </Group>
          <CountsTable backup={parsed.backup} label="Склад файла" />
          <Group gap="xs">
            <Badge color={verification.identical ? 'green' : 'orange'}>
              {verification.identical ? 'Збігається з базою' : 'Відрізняється від бази'}
            </Badge>
            {verification.figuresMatch !== null && (
              <Badge color={verification.figuresMatch ? 'green' : 'red'}>
                {verification.figuresMatch ? 'Місячні суми збігаються' : 'Місячні суми різні'}
              </Badge>
            )}
          </Group>
          {verification.differences.length > 0 && (
            <List size="sm" aria-label="Розбіжності">
              {verification.differences.map((d) => (
                <List.Item key={d}>{d}</List.Item>
              ))}
            </List>
          )}
          {restored !== null && (
            <Alert color="green" role="status">
              Відновлено записів: {restored}. Результат видно в перевірці вище.
            </Alert>
          )}
          {error && (
            <Alert color="red" role="alert">
              Не вдалося відновити: {error}
            </Alert>
          )}
          <Group>
            <Button color="orange" variant="light" disabled={!uid} onClick={() => setRestoring('confirm')}>
              Відновити з файла
            </Button>
          </Group>
        </Stack>
      )}

      <Modal
        opened={restoring !== null}
        onClose={() => restoring !== 'busy' && setRestoring(null)}
        title="Відновити дані з файла?"
        centered
        transitionProps={{ duration: 0 }}
      >
        {parsed?.ok && (
          <Stack>
            <Text size="sm">
              Записи з файла буде записано в базу: документ із тим самим id перезапишеться, нових буде додано. Те, чого
              немає у файлі, не видаляється.
            </Text>
            <CountsTable backup={parsed.backup} label="Буде записано" />
            {closedTouched.length > 0 && (
              <Alert color="orange" role="alert">
                Файл змінює документи закритих місяців ({closedTouched.join(', ')}): база такий запис відхилить.
                Відкрийте ці місяці знову на екрані «Закриття», відновіть і закрийте їх після перевірки.
              </Alert>
            )}
            {error && (
              <Alert color="red" role="alert">
                Не вдалося відновити: {error}
              </Alert>
            )}
            <Group justify="flex-end">
              <Button
                variant="default"
                onClick={() => setRestoring(null)}
                data-autofocus
                disabled={restoring === 'busy'}
              >
                Скасувати
              </Button>
              <Button
                color="orange"
                onClick={() => void restore()}
                loading={restoring === 'busy'}
                disabled={closedTouched.length > 0}
              >
                Відновити
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
