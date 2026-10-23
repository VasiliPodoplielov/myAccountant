import { describe, expect, it } from 'vitest';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  backupToJson,
  buildBackup,
  parseBackup,
  restoreOps,
  restoreTouchesClosed,
  stableStringify,
  verifyBackup,
  type Backup,
  type BackupData,
  type StoredDocument,
} from './backup';
import { TAX_CONFIG, type YearSettings } from './tax';

const now = new Date('2026-10-22T09:00:00.000Z');
const cfg = TAX_CONFIG[2026]!;
const emptySettings: YearSettings = { chorobowe: false, prevDecemberIncome: null, prevDecemberContributions: null };
const pl = { name: 'Firma', nip: '1111111111', country: 'PL' };

const docs: StoredDocument[] = [
  {
    id: 'sale-1',
    kind: 'income',
    number: 'FV 1',
    issueDate: '2026-03-10',
    contractor: pl,
    currency: 'PLN',
    lines: [{ net: 1_000_000, vatRate: '23', vat: 230_000 }],
    source: 'manual',
  },
  {
    id: 'fuel',
    kind: 'cost',
    category: 'carMixed',
    number: 'F 1',
    issueDate: '2026-03-04',
    contractor: pl,
    currency: 'PLN',
    lines: [{ net: 10_000, vatRate: '23', vat: 2_300 }],
    source: 'import',
  },
  {
    id: 'claude',
    kind: 'cost',
    category: 'other',
    number: 'C 1',
    issueDate: '2026-03-12',
    contractor: { name: 'Anthropic, PBC', country: 'US' },
    currency: 'EUR',
    lines: [{ net: 10_000, vatRate: 'np' }],
    source: 'manual',
  },
  {
    id: 'old',
    kind: 'cost',
    category: 'office',
    number: 'OLD 1',
    issueDate: '2025-06-04',
    contractor: pl,
    currency: 'PLN',
    lines: [{ net: 5_000, vatRate: '23', vat: 1_150 }],
    source: 'import',
  },
];

const live: BackupData = {
  settings: { ...emptySettings, prevDecemberIncome: 100_000, contributionHolidayMonth: 2 },
  documents: docs,
  references: {
    '2026-03': { kpir: { col9: 1_000_000 }, notes: { 'kpir.col9': 'пояснення' } },
    '2025-12': { kpir: { col9: 1 } },
  },
  periods: {
    '2026-03': { status: 'closed', confirmations: { documents: true }, closedAt: now.toISOString() },
    '2025-12': { status: 'closed', confirmations: {} },
  },
  vendorRules: { '1111111111': { category: 'carMixed' }, 'Назва / з косою': { category: 'office' } },
  categoryOverrides: { 'jpk-1': 'other' },
  fxRates: {
    '2025-11-28': { EUR: 4.2 },
    '2025-12-31': { EUR: 4.25, USD: 3.6 },
    '2026-03-11': { EUR: 4.3 },
    '2027-01-02': { EUR: 4.4 },
  },
};

/** Витрата в EUR з грудня 2025, оплачена в січні 2026 дорожче за курс NBP: від'ємна різниця, koszt у січні 2026 */
const paidNextYear: StoredDocument = {
  id: 'eur-2025',
  kind: 'cost',
  category: 'other',
  number: 'INV 9',
  issueDate: '2025-12-22',
  contractor: { name: 'Foreign Ltd', country: 'IE' },
  currency: 'EUR',
  lines: [{ net: 10_000, vatRate: 'np' }],
  paidAt: '2026-01-12',
  paidPln: 45_000,
  source: 'manual',
};

describe('buildBackup', () => {
  const backup = buildBackup(live, 2026, now);

  it('позначка формату, версія, рік і час експорту', () => {
    expect(backup).toMatchObject({ format: BACKUP_FORMAT, version: BACKUP_VERSION, year: 2026 });
    expect(backup.exportedAt).toBe(now.toISOString());
  });

  it('беруться лише документи року, відсортовані за id', () => {
    expect(backup.documents.map((d) => d.id)).toEqual(['claude', 'fuel', 'sale-1']);
  });

  it('документ з датою VAT у році теж потрапляє', () => {
    const edge = { ...docs[3]!, id: 'edge', issueDate: '2025-12-30', vatDate: '2026-01-02' } as StoredDocument;
    expect(buildBackup({ ...live, documents: [edge] }, 2026, now).documents.map((d) => d.id)).toEqual(['edge']);
  });

  it('валютний документ минулого року, оплачений у році, потрапляє (курсова різниця в KPiR року)', () => {
    expect(buildBackup({ ...live, documents: [paidNextYear] }, 2026, now).documents.map((d) => d.id)).toEqual([
      'eur-2025',
    ]);
    expect(buildBackup({ ...live, documents: [paidNextYear] }, 2025, now).documents.map((d) => d.id)).toEqual([
      'eur-2025',
    ]);
  });

  it('еталон і місяці — лише року; правила й категорії — усі', () => {
    expect(Object.keys(backup.references)).toEqual(['2026-03']);
    expect(Object.keys(backup.periods)).toEqual(['2026-03']);
    expect(Object.keys(backup.vendorRules)).toHaveLength(2);
    expect(backup.categoryOverrides).toEqual({ 'jpk-1': 'other' });
  });

  it('курси: від 15 грудня попереднього року до кінця року', () => {
    expect(Object.keys(backup.fxRates)).toEqual(['2025-12-31', '2026-03-11']);
  });

  it('порожні дані дають чинний порожній бекап', () => {
    const empty = buildBackup(
      {
        settings: null,
        documents: [],
        references: {},
        periods: {},
        vendorRules: {},
        categoryOverrides: {},
        fxRates: {},
      },
      2026,
      now,
    );
    expect(empty.documents).toEqual([]);
    expect(parseBackup(backupToJson(empty)).ok).toBe(true);
  });
});

describe('parseBackup', () => {
  const json = backupToJson(buildBackup(live, 2026, now));

  it('круговий рух JSON зберігає дані', () => {
    const parsed = parseBackup(json);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(stableStringify(parsed.backup)).toBe(stableStringify(buildBackup(live, 2026, now)));
  });

  it('не JSON', () => {
    expect(parseBackup('{{')).toEqual({ ok: false, errors: ['Файл не є JSON'] });
  });

  it('чужий JSON без позначки формату', () => {
    const r = parseBackup('{"a":1}');
    expect(r.ok).toBe(false);
  });

  it('невідома версія', () => {
    const r = parseBackup(JSON.stringify({ ...JSON.parse(json), version: 99 }));
    expect(r).toEqual({ ok: false, errors: ['Непідтримувана версія бекапу: 99 (потрібна 1)'] });
  });

  it('збирає всі помилки документів', () => {
    const raw = JSON.parse(json) as Backup;
    raw.documents = [
      { ...raw.documents[0]!, id: 'a/b' },
      { ...raw.documents[1]!, kind: 'weird' as never },
      { ...raw.documents[1]!, id: raw.documents[2]!.id, issueDate: '2026-13-40' },
      { ...raw.documents[2]! },
    ];
    const r = parseBackup(JSON.stringify(raw));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toEqual(
        expect.arrayContaining([
          'documents[0]: некоректний id',
          'documents[1]: невідомий вид документа',
          'documents[2]: некоректна дата',
          'documents[3]: id sale-1 повторюється',
        ]),
      );
    }
  });

  it('ключі місяців, стан і id категорій перевіряються: вони стають id у Firestore', () => {
    const raw = JSON.parse(json) as Record<string, unknown>;
    raw.references = { '2026-13': {}, 'a/b': {} };
    raw.periods = { '2026-03': { status: 'weird', confirmations: {} } };
    raw.categoryOverrides = { 'x/y': 'other' };
    const r = parseBackup(JSON.stringify(raw));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toEqual([
        'references.2026-13: некоректний запис',
        'references.a/b: некоректний запис',
        'periods.2026-03: невідомий стан',
        'categoryOverrides.x/y: некоректний id',
      ]);
    }
  });

  it('відсутні колекції', () => {
    const raw = JSON.parse(json) as Record<string, unknown>;
    delete raw.periods;
    delete raw.documents;
    const r = parseBackup(JSON.stringify(raw));
    expect(r.ok).toBe(false);
    if (!r.ok)
      expect(r.errors).toEqual(expect.arrayContaining(['periods: очікується об’єкт', 'documents: очікується масив']));
  });
});

describe('restoreOps', () => {
  const backup = buildBackup(live, 2026, now);
  const ops = restoreOps(backup);

  it('документи йдуть без id у даних', () => {
    const op = ops.find((o) => o.collection === 'documents' && o.id === 'fuel')!;
    expect('id' in op.data).toBe(false);
  });

  it('налаштування пишуться під ключем року', () => {
    expect(ops.find((o) => o.collection === 'settings')).toMatchObject({ id: '2026' });
  });

  it('ключ правила контрагента кодується (коса риска заборонена в id)', () => {
    const ids = ops.filter((o) => o.collection === 'vendorRules').map((o) => o.id);
    expect(ids).toContain(encodeURIComponent('Назва / з косою'));
    expect(ids.every((id) => !id.includes('/'))).toBe(true);
  });

  it('категорія документа пишеться як { category }', () => {
    expect(ops.find((o) => o.collection === 'categoryOverrides')).toMatchObject({
      id: 'jpk-1',
      data: { category: 'other' },
    });
  });

  it('курси зливаються з наявними', () => {
    const fx = ops.filter((o) => o.collection === 'fxRates');
    expect(fx).toHaveLength(2);
    expect(fx.every((o) => o.merge === true)).toBe(true);
  });

  it('без налаштувань запису settings немає', () => {
    expect(restoreOps({ ...backup, settings: null }).some((o) => o.collection === 'settings')).toBe(false);
  });
});

/** Імітація сховища: застосовує записи відновлення й читає їх назад у вигляді BackupData */
function applyToStore(ops: ReturnType<typeof restoreOps>): BackupData {
  const store = new Map<string, Record<string, unknown>>();
  for (const op of ops) {
    const key = `${op.collection}/${op.id}`;
    store.set(key, op.merge ? { ...store.get(key), ...(op.data as object) } : { ...(op.data as object) });
  }
  const inCollection = (name: string) =>
    [...store].filter(([k]) => k.startsWith(`${name}/`)).map(([k, v]) => [k.slice(name.length + 1), v] as const);
  const asRecord = (name: string) => Object.fromEntries(inCollection(name));
  return {
    settings: (inCollection('settings')[0]?.[1] as unknown as YearSettings) ?? null,
    documents: inCollection('documents').map(([id, v]) => ({ ...v, id }) as StoredDocument),
    references: asRecord('reference') as BackupData['references'],
    periods: asRecord('periods') as unknown as BackupData['periods'],
    vendorRules: Object.fromEntries(
      inCollection('vendorRules').map(([id, v]) => [decodeURIComponent(id), v]),
    ) as BackupData['vendorRules'],
    categoryOverrides: Object.fromEntries(
      inCollection('categoryOverrides').map(([id, v]) => [id, (v as { category: never }).category]),
    ),
    fxRates: asRecord('fxRates') as BackupData['fxRates'],
  };
}

describe('відновлення з експорту (критерій 6)', () => {
  const json = backupToJson(buildBackup(live, 2026, now));

  it('файл → розбір → відновлення в порожнє сховище дає ті самі дані й ті самі місячні суми', () => {
    const parsed = parseBackup(json);
    if (!parsed.ok) throw new Error(parsed.errors.join('; '));
    const restored = applyToStore(restoreOps(parsed.backup));
    const v = verifyBackup(parsed.backup, restored, { cfg, emptySettings });
    expect(v).toEqual({ identical: true, differences: [], figuresMatch: true });
  });

  it('відновлення в базу з іншим станом перезаписує збіжні записи й не видаляє зайві', () => {
    const parsed = parseBackup(json);
    if (!parsed.ok) throw new Error(parsed.errors.join('; '));
    const damaged = applyToStore([
      ...restoreOps(parsed.backup),
      { collection: 'documents', id: 'stray', data: { ...docs[0]!, id: undefined, number: 'STRAY' } },
    ]);
    expect(damaged.documents.some((d) => d.id === 'stray')).toBe(true);
    const v = verifyBackup(parsed.backup, damaged);
    expect(v.identical).toBe(false);
    expect(v.differences).toContain('Документи: у базі є, у файлі немає — 1');
  });
});

describe('verifyBackup', () => {
  const backup = buildBackup(live, 2026, now);

  it('збіг: дані за межами року різницею не вважаються', () => {
    const v = verifyBackup(backup, live, { cfg, emptySettings });
    expect(v).toEqual({ identical: true, differences: [], figuresMatch: true });
  });

  it('змінений документ, зайвий і відсутній документ', () => {
    const changed = docs.map((d) =>
      d.id === 'fuel' ? { ...d, lines: [{ net: 20_000, vatRate: '23' as const, vat: 4_600 }] } : d,
    );
    const v = verifyBackup(
      backup,
      { ...live, documents: [...changed.filter((d) => d.id !== 'claude')] },
      { cfg, emptySettings },
    );
    expect(v.identical).toBe(false);
    expect(v.differences).toEqual(
      expect.arrayContaining(['Документи: у файлі є, у базі немає — 1', 'Документи: відрізняються — 1']),
    );
    expect(v.figuresMatch).toBe(false);
  });

  it('суми з файла порівнюються з повним обліком: файл без документа з курсовою різницею їх не відтворює', () => {
    const withFx: BackupData = {
      ...live,
      documents: [...docs, paidNextYear],
      fxRates: { ...live.fxRates, '2025-12-19': { EUR: 4.25 } },
    };
    const full = buildBackup(withFx, 2026, now);
    expect(verifyBackup(full, withFx, { cfg, emptySettings }).figuresMatch).toBe(true);
    const truncated = { ...full, documents: full.documents.filter((d) => d.id !== 'eur-2025') };
    expect(verifyBackup(truncated, withFx, { cfg, emptySettings }).figuresMatch).toBe(false);
  });

  it('змінене пояснення в еталоні й налаштування року', () => {
    const v = verifyBackup(backup, {
      ...live,
      references: { ...live.references, '2026-03': { kpir: { col9: 1_000_000 }, notes: { 'kpir.col9': 'інше' } } },
      settings: { ...live.settings!, prevDecemberIncome: 5 },
    });
    expect(v.differences).toEqual(['Еталон: відрізняються — 1', 'Налаштування року відрізняються']);
    expect(v.figuresMatch).toBeNull();
  });

  it('порядок ключів не має значення', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: undefined } })).toBe(stableStringify({ a: { d: 2 }, b: 1 }));
  });
});

describe('restoreTouchesClosed', () => {
  const backup = buildBackup(live, 2026, now);

  it('повертає закриті місяці, у які впишуться документи', () => {
    expect(restoreTouchesClosed(backup, live.periods)).toEqual(['2026-03']);
  });

  it('відкриті місяці не вважаються', () => {
    expect(restoreTouchesClosed(backup, { '2026-03': { status: 'open', confirmations: {} } })).toEqual([]);
  });
});
