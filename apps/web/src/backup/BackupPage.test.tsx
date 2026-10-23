// @vitest-environment jsdom
import { backupToJson, buildBackup, type BackupData, type StoredDocument } from '@jdg/core';
import { MantineProvider } from '@mantine/core';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_SETTINGS } from '../settings/settingsForm';
import { installDomPolyfills } from '../test/domPolyfills';

const pl = { name: 'Firma', nip: '1111111111', country: 'PL' };
const docs: StoredDocument[] = [
  {
    id: 'sale',
    kind: 'income',
    number: 'FV 1',
    issueDate: '2026-03-10',
    contractor: pl,
    currency: 'PLN',
    lines: [{ net: 1_000_000, vatRate: '23', vat: 230_000 }],
    source: 'manual',
  },
  {
    id: 'office',
    kind: 'cost',
    category: 'office',
    number: 'F 7',
    issueDate: '2026-03-12',
    contractor: pl,
    currency: 'PLN',
    lines: [{ net: 10_000, vatRate: '23', vat: 2_300 }],
    source: 'import',
  },
];
const baseData = (): BackupData => ({
  settings: { ...EMPTY_SETTINGS, prevDecemberIncome: 100_000 },
  documents: docs,
  references: { '2026-03': { kpir: { col9: 1_000_000 } } },
  periods: { '2026-03': { status: 'closed', confirmations: {} } },
  vendorRules: { '1111111111': { category: 'office' } },
  categoryOverrides: {},
  fxRates: { '2026-03-11': { EUR: 4.3 } },
});

const mocks = vi.hoisted(() => ({
  auth: { state: { status: 'signedIn', user: { uid: 'u1' } } } as { state: { status: string; user?: { uid: string } } },
  data: null as unknown as BackupData,
  restoreBackupOps: vi.fn(),
  downloadText: vi.fn(),
  downloadCsv: vi.fn(),
}));

const ready = <T,>(data: T) => ({ status: 'ready' as const, data });

vi.mock('../auth/AuthContext', () => ({ useAuth: () => mocks.auth }));
vi.mock('../data/hooks', () => ({
  restoreBackupOps: mocks.restoreBackupOps,
  useDocuments: () => ready(mocks.data.documents),
  useYearSettings: () => ready(mocks.data.settings),
  useReferences: () => ready(mocks.data.references),
  usePeriods: () => ready(mocks.data.periods),
  useVendorRules: () => ready(mocks.data.vendorRules),
  useCategoryOverrides: () => ready(mocks.data.categoryOverrides),
  useFxRateDocs: () => ready(mocks.data.fxRates),
}));
vi.mock('./files', async (original) => ({
  ...(await original<typeof import('./files')>()),
  downloadText: mocks.downloadText,
}));
vi.mock('../csv', async (original) => ({
  ...(await original<typeof import('../csv')>()),
  downloadCsv: mocks.downloadCsv,
}));

import { BackupPage } from './BackupPage';

beforeAll(installDomPolyfills);
beforeEach(() => {
  mocks.auth.state = { status: 'signedIn', user: { uid: 'u1' } };
  mocks.data = baseData();
  mocks.restoreBackupOps.mockReset().mockResolvedValue(undefined);
  mocks.downloadText.mockReset();
  mocks.downloadCsv.mockReset();
});
afterEach(cleanup);

function setup() {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  render(
    <MantineProvider>
      <BackupPage />
    </MantineProvider>,
  );
  return user;
}

const backupFile = (data: BackupData, name = 'backup.json') =>
  new File([backupToJson(buildBackup(data, 2026, new Date('2026-10-22T09:00:00Z')))], name, {
    type: 'application/json',
  });
const upload = async (user: ReturnType<typeof userEvent.setup>, file: File) => {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await user.upload(input, file);
};

describe('експорт', () => {
  it('склад бекапу: лічильники за обраний рік', () => {
    setup();
    const table = screen.getByRole('table', { name: 'Склад бекапу' });
    const cell = (name: string) => within(table).getByText(name).nextElementSibling!.textContent;
    expect(cell('Документи')).toBe('2');
    expect(cell('Еталон за місяці')).toBe('1');
    expect(cell('Стан місяців')).toBe('1');
    expect(cell('Правила контрагентів')).toBe('1');
    expect(cell('Курси NBP')).toBe('1');
  });

  it('JSON: файл jdg-backup-2026.json, який розбирається назад', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Експорт JSON' }));
    expect(mocks.downloadText).toHaveBeenCalledTimes(1);
    const [name, text, type] = mocks.downloadText.mock.calls[0]!;
    expect(name).toBe('jdg-backup-2026.json');
    expect(type).toBe('application/json');
    const parsed = JSON.parse(text);
    expect(parsed).toMatchObject({ format: 'jdg-ledger-backup', version: 1, year: 2026 });
    expect(parsed.documents.map((d: { id: string }) => d.id)).toEqual(['office', 'sale']);
  });

  it('CSV документів: заголовок і рядки з сумами в злотих', async () => {
    const user = setup();
    await user.click(screen.getByRole('button', { name: 'Експорт CSV документів' }));
    expect(mocks.downloadCsv).toHaveBeenCalledTimes(1);
    const [name, text] = mocks.downloadCsv.mock.calls[0]!;
    expect(name).toBe('dokumenty-2026.csv');
    const lines = (text as string).trim().split('\r\n');
    expect(lines[0]).toBe(
      'id;kind;number;issue_date;pit_date;vat_date;contractor;contractor_nip;country;currency;net;vat;category;source',
    );
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('sale;income;FV 1;2026-03-10');
    expect(lines[2]).toContain('office;cost;F 7;2026-03-12');
    expect(lines[2]).toContain(';100.00;23.00;office;import');
  });

  it('без документів CSV вимкнено', () => {
    mocks.data = { ...baseData(), documents: [] };
    setup();
    expect((screen.getByRole('button', { name: 'Експорт CSV документів' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('перевірка файла', () => {
  it('такий самий файл: збігається з базою, місячні суми збігаються', async () => {
    const user = setup();
    await upload(user, backupFile(mocks.data));
    expect(await screen.findByText('Збігається з базою')).toBeTruthy();
    expect(screen.getByText('Місячні суми збігаються')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Розбіжності' })).toBeNull();
  });

  it('файл не підходить: список помилок, відновлення немає', async () => {
    const user = setup();
    await upload(user, new File(['це не json'], 'bad.json', { type: 'application/json' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Файл не підходить');
    expect(alert.textContent).toContain('Файл не є JSON');
    expect(screen.queryByRole('button', { name: 'Відновити з файла' })).toBeNull();
  });

  it('база змінилася після експорту: розбіжності й різні суми', async () => {
    const user = setup();
    const file = backupFile(mocks.data);
    mocks.data = {
      ...baseData(),
      documents: [docs[0]!, { ...docs[1]!, lines: [{ net: 50_000, vatRate: '23', vat: 11_500 }] } as StoredDocument],
    };
    await upload(user, file);
    expect(await screen.findByText('Відрізняється від бази')).toBeTruthy();
    expect(screen.getByText('Місячні суми різні')).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Розбіжності' }).textContent).toContain('Документи: відрізняються — 1');
  });
});

describe('відновлення', () => {
  it('підтвердження записує всі записи файла; скасування нічого не пише', async () => {
    const user = setup();
    await upload(user, backupFile(mocks.data));
    await user.click(await screen.findByRole('button', { name: 'Відновити з файла' }));
    let dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Скасувати' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.restoreBackupOps).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Відновити з файла' }));
    dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Відновити' }));
    await waitFor(() => expect(mocks.restoreBackupOps).toHaveBeenCalledTimes(1));
    const [uid, ops] = mocks.restoreBackupOps.mock.calls[0]!;
    expect(uid).toBe('u1');
    // налаштування, 2 документи, еталон, місяць, правило, курс
    expect(ops).toHaveLength(7);
    expect(await screen.findByText(/Відновлено записів: 7/)).toBeTruthy();
  });

  it('файл зачіпає закритий місяць: попередження в діалозі', async () => {
    const user = setup();
    await upload(user, backupFile(mocks.data));
    await user.click(await screen.findByRole('button', { name: 'Відновити з файла' }));
    expect((await screen.findByRole('dialog')).textContent).toContain('закриті місяці (2026-03)');
  });

  it('помилка запису показується, діалог лишається', async () => {
    mocks.restoreBackupOps.mockRejectedValue(new Error('permission-denied'));
    const user = setup();
    await upload(user, backupFile(mocks.data));
    await user.click(await screen.findByRole('button', { name: 'Відновити з файла' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Відновити' }));
    expect((await screen.findAllByText(/Не вдалося відновити: permission-denied/)).length).toBeGreaterThan(0);
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.queryByText(/Відновлено записів/)).toBeNull();
  });

  it('без входу відновити не можна', async () => {
    mocks.auth.state = { status: 'signedOut' };
    const user = setup();
    await upload(user, backupFile(mocks.data));
    expect(((await screen.findByRole('button', { name: 'Відновити з файла' })) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
