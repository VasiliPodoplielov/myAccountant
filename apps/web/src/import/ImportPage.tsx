import {
  kpirHintsFromDocuments,
  type ContractorRule,
  type ContractorRules,
  type CostCategory,
  type JpkCtrlIssue,
  type JpkImportIssueCode,
  type JpkImportNote,
} from '@jdg/core';
import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Checkbox,
  FileInput,
  Group,
  List,
  Loader,
  Select,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/AuthContext';
import { saveJpkImport, useDocuments, useVendorRules } from '../data/hooks';
import { formatPln } from '../format';
import { buildImportPlan, parseFile, type FilePlan, type ParsedFile } from './importPlan';

/** Категорії, які можна призначити витраті з JPK: import usług у JPK бухгалтера не подається */
const CATEGORY_OPTIONS: { value: CostCategory; label: string }[] = [
  { value: 'carMixed', label: 'Авто мішане (VAT 50%, koszty 75%)' },
  { value: 'office', label: 'Офіс (100%)' },
  { value: 'other', label: 'Інше (100%)' },
];

const ISSUE_TEXT: Record<JpkImportIssueCode, string> = {
  category: 'немає категорії контрагента',
  unsupportedField: 'поля, яких облік ще не веде',
  documentType: 'особливий тип документа',
  country: 'продаж np без коду країни контрагента',
  amount: 'суми не відтворюються документом',
  duplicate: 'той самий документ двічі',
};

const CTRL_TEXT: Record<JpkCtrlIssue, string> = {
  salesRows: 'кількість рядків продажу',
  outputVat: 'VAT należny',
  purchaseRows: 'кількість рядків закупівлі',
  inputVat: 'VAT naliczony',
};

function NoteRow({ note, value, onChoose }: { note: JpkImportNote; value?: number; onChoose: (v: number) => void }) {
  if (note.code === 'vatPeriod') {
    return (
      <List.Item>
        {note.number}: за правилами дат VAT припадає на {note.ruleDate}, у поданому файлі — інший місяць. Документ
        поставлено в місяць файла.
      </List.Item>
    );
  }
  return (
    <List.Item>
      <Group gap="xs" wrap="wrap">
        <Text size="sm">
          {note.number}: {note.code === 'kpirMismatch' ? 'сума з KPiR не підходить; ' : ''}виберіть koszt як у KPiR
          бухгалтера
        </Text>
        <Select
          size="xs"
          aria-label={`Koszt у KPiR для ${note.number}`}
          data={note.choices!.map((c) => ({
            value: String(c.pitAmount),
            label: `${formatPln(c.pitAmount)} zł (netto ${formatPln(c.net)}, VAT ${formatPln(c.vat)})`,
          }))}
          value={String(value ?? note.selected ?? note.choices![0].pitAmount)}
          onChange={(v) => v && onChoose(Number(v))}
          allowDeselect={false}
          w={320}
        />
      </Group>
    </List.Item>
  );
}

function FileCard({
  file,
  choices,
  onChoose,
}: {
  file: FilePlan;
  choices: Record<string, number>;
  onChoose: (id: string, v: number) => void;
}) {
  const { result } = file;
  return (
    <Card withBorder>
      <Stack gap="xs">
        <Group gap="xs">
          <Text fw={600}>{result.period}</Text>
          <Badge variant="light">JPK_V7M({file.variant})</Badge>
          {file.correction && <Badge color="orange">korekta</Badge>}
          <Text size="sm" c="dimmed">
            {file.name}
          </Text>
        </Group>
        <Text size="sm">
          Документів: {result.documents.length}
          {file.stale.length > 0 && `; з попереднього імпорту буде видалено: ${file.stale.length}`}
        </Text>
        {file.ctrlIssues.length > 0 && (
          <Alert color="yellow" title="Контрольні суми файла не сходяться з рядками">
            {file.ctrlIssues.map((c) => CTRL_TEXT[c]).join(', ')}
          </Alert>
        )}
        {result.issues.filter((i) => i.code !== 'category').length > 0 && (
          <Alert color="red" title="Рядки, які не стануть документами: їх треба внести вручну">
            <List size="sm">
              {result.issues
                .filter((i) => i.code !== 'category')
                .map((i) => (
                  <List.Item key={`${i.register}-${i.lp}`}>
                    {i.number} ({i.contractorName}): {ISSUE_TEXT[i.code]}
                    {i.detail ? ` — ${i.detail}` : ''}
                  </List.Item>
                ))}
            </List>
          </Alert>
        )}
        {result.notes.length > 0 && (
          <List size="sm" spacing={4}>
            {result.notes.map((n) => (
              <NoteRow
                key={`${n.documentId}-${n.code}`}
                note={n}
                value={choices[n.documentId]}
                onChoose={(v) => onChoose(n.documentId, v)}
              />
            ))}
          </List>
        )}
      </Stack>
    </Card>
  );
}

type SaveState =
  { kind: 'idle' } | { kind: 'saving' } | { kind: 'done'; count: number } | { kind: 'error'; message: string };

export function ImportPage() {
  const { state } = useAuth();
  const uid = state.status === 'signedIn' ? state.user.uid : null;
  const docsState = useDocuments();
  const rulesState = useVendorRules();
  const [files, setFiles] = useState<ParsedFile[]>([]);
  const [ruleEdits, setRuleEdits] = useState<ContractorRules>({});
  const [choices, setChoices] = useState<Record<string, number>>({});
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });

  const existing = useMemo(() => (docsState.status === 'ready' ? docsState.data : []), [docsState]);
  const savedRules = useMemo(() => (rulesState.status === 'ready' ? rulesState.data : {}), [rulesState]);
  const rules = useMemo(() => {
    const merged: ContractorRules = { ...savedRules };
    for (const [key, edit] of Object.entries(ruleEdits)) merged[key] = { ...merged[key], ...edit };
    return merged;
  }, [savedRules, ruleEdits]);
  const hints = useMemo(() => ({ ...kpirHintsFromDocuments(existing), ...choices }), [existing, choices]);
  const plan = useMemo(() => buildImportPlan(files, rules, hints, existing), [files, rules, hints, existing]);

  const loadError =
    docsState.status === 'error' ? docsState.error : rulesState.status === 'error' ? rulesState.error : null;
  if (loadError) return <Alert color="red">Не вдалося прочитати дані: {loadError.message}</Alert>;
  if (docsState.status === 'loading' || rulesState.status === 'loading') return <Loader aria-label="Завантаження" />;

  const editRule = (key: string, edit: ContractorRule) => {
    setRuleEdits((r) => ({ ...r, [key]: { ...r[key], ...edit } }));
    setSave({ kind: 'idle' });
  };

  const onFiles = async (list: File[]) => {
    setSave({ kind: 'idle' });
    setFiles(await Promise.all(list.map(async (f) => parseFile(f.name, await f.text()))));
  };

  const onImport = async () => {
    if (!uid) return;
    setSave({ kind: 'saving' });
    try {
      const changed = Object.fromEntries(Object.keys(ruleEdits).map((key) => [key, rules[key]]));
      await saveJpkImport(uid, {
        rules: changed,
        documents: plan.documents,
        remove: plan.stale,
        references: plan.references,
      });
      setRuleEdits({});
      setSave({ kind: 'done', count: plan.documents.length });
    } catch (e) {
      setSave({ kind: 'error', message: (e as Error).message });
    }
  };

  const failed = files.filter((f) => !f.ok);
  const missing = new Set(plan.missingRules.map((m) => m.key));

  return (
    <Stack maw={960}>
      <Title order={2}>Імпорт JPK_V7M</Title>
      <Text size="sm" c="dimmed">
        Файли, подані бухгалтером, стають документами обліку, а їхня декларація — еталоном для звірки. Файл читається в
        браузері; в облік потрапляють лише документи й суми. Повторний імпорт того самого місяця перезаписує його.
      </Text>

      <FileInput
        label="Файли JPK_V7M (XML)"
        placeholder="Виберіть один або кілька файлів"
        accept=".xml,text/xml,application/xml"
        multiple
        clearable
        onChange={(list) => void onFiles(list)}
      />

      {failed.map((f) => (
        <Alert key={f.name} color="red" title={`${f.name}: не вдалося прочитати`}>
          {!f.ok && f.error}
        </Alert>
      ))}
      {plan.duplicatePeriods.length > 0 && (
        <Alert color="red" title="Кілька файлів за той самий місяць">
          {plan.duplicatePeriods.join(', ')}: залиште лише останній поданий файл (корекцію, якщо вона була).
        </Alert>
      )}

      {plan.purchaseContractors.length > 0 && (
        <Stack gap="xs">
          <Title order={3} size="h4">
            Категорії постачальників
          </Title>
          <Text size="sm" c="dimmed">
            У JPK категорії немає. Вибір запам'ятовується для NIP і діє для наступних файлів.
          </Text>
          <Table.ScrollContainer minWidth={520}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Постачальник</Table.Th>
                  <Table.Th>NIP</Table.Th>
                  <Table.Th>Категорія</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {plan.purchaseContractors.map((c) => (
                  <Table.Tr key={c.key}>
                    <Table.Td>{c.name}</Table.Td>
                    <Table.Td>{c.key}</Table.Td>
                    <Table.Td>
                      <Select
                        aria-label={`Категорія для ${c.name}`}
                        placeholder="Виберіть"
                        data={CATEGORY_OPTIONS}
                        value={rules[c.key]?.category ?? null}
                        onChange={(v) => v && editRule(c.key, { category: v as CostCategory })}
                        error={missing.has(c.key) ? 'Потрібна категорія' : undefined}
                        allowDeselect={false}
                      />
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Stack>
      )}

      {plan.salesContractors.length > 0 && (
        <Stack gap="xs">
          <Title order={3} size="h4">
            Клієнти
          </Title>
          {plan.salesContractors.map((c) => (
            <Checkbox
              key={c.key}
              label={`${c.name}: послуга розраховується періодами (дохід — в останній день періоду)`}
              checked={rules[c.key]?.periodicSettlement ?? false}
              onChange={(e) => editRule(c.key, { periodicSettlement: e.currentTarget.checked })}
            />
          ))}
        </Stack>
      )}

      {plan.files.map((f) => (
        <FileCard
          key={f.name}
          file={f}
          choices={choices}
          onChoose={(id, v) => {
            setChoices((c) => ({ ...c, [id]: v }));
            setSave({ kind: 'idle' });
          }}
        />
      ))}

      {plan.files.length > 0 && (
        <Group>
          <Button onClick={() => void onImport()} disabled={!plan.ready || !uid} loading={save.kind === 'saving'}>
            Імпортувати документи: {plan.documents.length}
          </Button>
          {!plan.ready && missing.size > 0 && (
            <Text size="sm" c="red">
              Виберіть категорію для всіх постачальників
            </Text>
          )}
        </Group>
      )}
      {save.kind === 'done' && (
        <Alert color="green" title="Імпортовано">
          Документів: {save.count}. Різниці з еталоном — на екрані{' '}
          <Anchor component={Link} to="/reconciliation">
            «Звірка»
          </Anchor>
          .
        </Alert>
      )}
      {save.kind === 'error' && (
        <Alert color="red" title="Не вдалося зберегти">
          {save.message}
        </Alert>
      )}
    </Stack>
  );
}
