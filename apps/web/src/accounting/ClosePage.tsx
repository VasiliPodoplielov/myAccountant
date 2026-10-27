import {
  canClose,
  closedRecord,
  closingChecklist,
  documentPeriods,
  isClosed,
  needsStamp,
  reopenedRecord,
  snapshotDrift,
  TAX_CONFIG,
  yearReport,
  type CheckItem,
  type ManualCheck,
  type PeriodRecord,
} from '@jdg/core';
import { Alert, Anchor, Badge, Button, Checkbox, Group, Loader, Modal, Stack, Table, Text, Title } from '@mantine/core';
import { useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import {
  closePeriod,
  reopenPeriod,
  savePeriod,
  syncPeriodLock,
  useLockedPeriods,
  useReferences,
  useYearSettings,
} from '../data/hooks';
import { writeErrorMessage } from '../data/writeError';
import { formatPln } from '../format';
import { EMPTY_SETTINGS } from '../settings/settingsForm';
import { formatDate, localIsoDate, monthDocuments } from './accountingView';
import { driftLabel, isCountKey, laterClosedPeriods, periodKey, SNAPSHOT_ROWS } from './closeView';
import { MonthHeader } from './MonthHeader';
import { useLedgerYear } from './useLedgerYear';

const LATEST_YEAR = Number(Object.keys(TAX_CONFIG).at(-1));

const OPEN_RECORD: PeriodRecord = { status: 'open', confirmations: {} };

function CheckRow({
  item,
  disabled,
  onToggle,
}: {
  item: CheckItem;
  disabled: boolean;
  onToggle: (checked: boolean) => void;
}) {
  if (item.kind === 'manual') {
    return (
      <Checkbox
        label={item.label}
        checked={item.done}
        disabled={disabled}
        onChange={(e) => onToggle(e.currentTarget.checked)}
      />
    );
  }
  return (
    <Group gap="xs" wrap="nowrap" align="flex-start">
      <Badge color={item.done ? 'green' : 'red'} variant="light" w={64} style={{ flexShrink: 0 }}>
        {item.done ? 'Так' : 'Ні'}
      </Badge>
      <Text size="sm">
        {item.label}
        {item.detail && (
          <Text span c="dimmed">
            {' '}
            — {item.detail}
          </Text>
        )}
      </Text>
    </Group>
  );
}

export function ClosePage() {
  const params = useParams();
  const year = Number(params.year);
  const month = Number(params.month);
  const valid = TAX_CONFIG[year] !== undefined && Number.isInteger(month) && month >= 1 && month <= 12;
  const ledgerYear = valid ? year : LATEST_YEAR;
  const ledger = useLedgerYear(ledgerYear);
  const settings = useYearSettings(ledgerYear);
  const references = useReferences();
  const locked = useLockedPeriods();
  const { state: auth } = useAuth();
  const uid = auth.status === 'signedIn' ? auth.user.uid : null;
  const [dialog, setDialog] = useState<'close' | 'reopen' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const period = periodKey(ledgerYear, valid ? month : 1);
  const reports = useMemo(() => {
    if (ledger.status !== 'ready' || settings.status !== 'ready' || references.status !== 'ready') return null;
    try {
      return yearReport(ledger.docs, settings.data ?? EMPTY_SETTINGS, TAX_CONFIG[ledgerYear]!, references.data, {
        fx: ledger.fx,
      });
    } catch {
      return null;
    }
  }, [ledger, settings, references, ledgerYear]);

  if (!valid) return <Navigate to="/" replace />;
  const failed = [ledger, settings, references].find((s) => s.status === 'error');
  if (failed && failed.status === 'error') {
    return <Alert color="red">Не вдалося прочитати дані: {failed.error.message}</Alert>;
  }
  if (ledger.status !== 'ready' || settings.status !== 'ready' || references.status !== 'ready') {
    return <Loader aria-label="Завантаження" />;
  }

  const record = ledger.periods[period] ?? OPEN_RECORD;
  const closed = isClosed(ledger.periods, period);
  const result = ledger.results?.[month - 1] ?? null;
  const previousClosed = month === 1 || isClosed(ledger.periods, periodKey(year, month - 1));
  const items = closingChecklist({
    month,
    result,
    report: reports?.[month - 1],
    confirmations: record.confirmations,
    previousClosed,
    hasSettings: ledger.hasSettings,
  });
  const ready = canClose(items);
  const drift = closed && record.snapshot && result ? snapshotDrift(record.snapshot, result) : [];
  const laterClosed = laterClosedPeriods(ledger.periods, period);
  // документи місяця, яким firestore.rules ще не можуть перевірити місяць (записані до правила)
  const unstamped = ledger.docs.filter((d) => documentPeriods(d).includes(period) && needsStamp(d));
  // захист у базі (locks/periods) розійшовся зі станом місяця: закрито до появи захисту чи змінено в обхід
  const lockMismatch = locked.status === 'ready' && closed !== (locked.data ?? []).includes(period);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setDialog(null);
    } catch (e) {
      setError(writeErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: ManualCheck, checked: boolean) => {
    if (!uid) return;
    void run(() => savePeriod(uid, period, { ...record, confirmations: { ...record.confirmations, [id]: checked } }));
  };

  const close = () => {
    if (!uid || !result) return Promise.resolve();
    const count = monthDocuments(ledger.docs, year, month, ledger.fx).length;
    return run(() =>
      closePeriod(uid, period, closedRecord(result, record.confirmations, count, new Date()), unstamped),
    );
  };

  const reopen = () => {
    if (!uid) return Promise.resolve();
    return run(() => reopenPeriod(uid, period, reopenedRecord(record, new Date())));
  };

  const syncLock = () => {
    if (!uid) return;
    void run(() => syncPeriodLock(uid, period, closed, closed ? unstamped : []));
  };

  return (
    <Stack maw={900}>
      <MonthHeader year={year} month={month} section="close" />

      <Group gap="sm">
        <Title order={3} size="h4">
          Закриття місяця
        </Title>
        <Badge color={closed ? 'green' : 'gray'}>{closed ? 'Закрито' : 'Відкрито'}</Badge>
      </Group>

      {ledger.error && (
        <Alert color="red" title="Не вдалося порахувати рік">
          {ledger.error}
        </Alert>
      )}
      {error && (
        <Alert color="red" role="alert">
          Не вдалося зберегти: {error}
        </Alert>
      )}
      {lockMismatch && (
        <Alert color="orange" title="Захист місяця в базі не збігається зі станом" role="alert">
          <Stack gap="xs" align="flex-start">
            <Text size="sm">
              {closed
                ? 'Місяць закрито, але база ще не забороняє змінювати його документи (закрито до появи захисту).'
                : 'Місяць відкрито, але база досі забороняє змінювати його документи.'}
            </Text>
            <Button size="xs" variant="default" disabled={!uid || busy} onClick={syncLock}>
              {closed ? 'Увімкнути захист' : 'Зняти захист'}
            </Button>
          </Stack>
        </Alert>
      )}

      {closed && record.snapshot ? (
        <>
          <Text size="sm">
            Закрито {record.closedAt ? formatDate(localIsoDate(new Date(record.closedAt))) : ''}
            {record.documentCount !== undefined && `, документів місяця: ${record.documentCount}`}. Документи, що
            потрапляють у цей місяць, не додаються й не видаляються, доки його не відкрито знову.
          </Text>
          <Table aria-label="Знімок сум місяця">
            <Table.Tbody>
              {SNAPSHOT_ROWS.map((row) => (
                <Table.Tr key={row.key}>
                  <Table.Td>{row.label}</Table.Td>
                  <Table.Td ta="right">{formatPln(record.snapshot![row.key] as number)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {drift.length > 0 && (
            <Alert color="orange" title="Суми змінилися після закриття" role="alert">
              <Stack gap={2}>
                {drift.map((d) => (
                  <Text size="sm" key={d.key}>
                    {driftLabel(d.key)}: було {d.was === null ? '—' : isCountKey(d.key) ? d.was : formatPln(d.was)},
                    зараз {d.now === null ? '—' : isCountKey(d.key) ? d.now : formatPln(d.now)}
                  </Text>
                ))}
                <Text size="sm">
                  Імовірно, документи місяця змінили повторним імпортом чи в попередньому місяці. Відкрийте місяць знову
                  й закрийте після перевірки.
                </Text>
              </Stack>
            </Alert>
          )}
          <Group>
            <Button variant="default" color="orange" disabled={!uid} onClick={() => setDialog('reopen')}>
              Відкрити знову (корекція)
            </Button>
          </Group>
        </>
      ) : (
        <>
          <Stack gap="xs" aria-label="Чекліст закриття">
            {items.map((item) => (
              <CheckRow
                key={item.id}
                item={item}
                disabled={!uid || busy}
                onToggle={(checked) => toggle(item.id as ManualCheck, checked)}
              />
            ))}
          </Stack>
          <Group>
            <Button disabled={!ready || !uid} onClick={() => setDialog('close')}>
              Закрити місяць
            </Button>
            {!ready && (
              <Text size="sm" c="dimmed">
                Закрити можна, коли виконано всі пункти.{' '}
                <Anchor component={Link} to="/reconciliation" size="sm">
                  Звірка
                </Anchor>
              </Text>
            )}
          </Group>
        </>
      )}

      <Modal
        opened={dialog === 'close'}
        onClose={() => !busy && setDialog(null)}
        title="Закрити місяць?"
        centered
        transitionProps={{ duration: 0 }}
      >
        <Stack>
          <Text size="sm">
            Суми місяця буде зафіксовано знімком. Далі документи, що потрапляють у цей місяць, не додаються й не
            видаляються без повторного відкриття.
          </Text>
          {result && (
            <Table aria-label="Суми для закриття">
              <Table.Tbody>
                {SNAPSHOT_ROWS.map((row) => (
                  <Table.Tr key={row.key}>
                    <Table.Td>{row.label}</Table.Td>
                    <Table.Td ta="right">{formatPln(result[row.key] as number)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDialog(null)} data-autofocus disabled={busy}>
              Скасувати
            </Button>
            <Button onClick={() => void close()} loading={busy}>
              Закрити
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal
        opened={dialog === 'reopen'}
        onClose={() => !busy && setDialog(null)}
        title="Відкрити місяць знову?"
        centered
        transitionProps={{ duration: 0 }}
      >
        <Stack>
          <Text size="sm">
            Знімок сум буде прибрано, а документи місяця знову можна змінювати. Закрийте місяць повторно, коли
            виправлення закінчено.
          </Text>
          {laterClosed.length > 0 && (
            <Alert color="orange">
              Пізніші місяці вже закриті ({laterClosed.join(', ')}): суми наростаючим підсумком у них можуть змінитися.
              Після виправлення перевірте їх.
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDialog(null)} data-autofocus disabled={busy}>
              Скасувати
            </Button>
            <Button color="orange" onClick={() => void reopen()} loading={busy}>
              Відкрити
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
