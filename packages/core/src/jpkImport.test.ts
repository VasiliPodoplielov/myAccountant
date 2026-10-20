import { describe, expect, it } from 'vitest';
import { documentIssues } from './document';
import { january2026Jpk, jpkXml } from './fixtures/jpk';
import { january2026 } from './fixtures/month-2026-01';
import { parseJpkV7M } from './jpk';
import {
  documentsFromJpk,
  jpkDocumentId,
  kpirHintsFromDocuments,
  type CategoryOverrides,
  type ContractorRules,
} from './jpkImport';
import { kpirContributions, kpirFromDocuments, kpirTotals } from './kpir';
import { calcYearFromDocuments } from './ledger';
import { TAX_CONFIG } from './tax';
import { vatDeclaration, vatRegisters, vatTotals } from './vat';

const januaryRules: ContractorRules = {
  '1111111111': { periodicSettlement: true },
  '2222222222': { category: 'carMixed' },
  '3333333333': { category: 'carMixed' },
  '4444444444': { category: 'other' },
  '5555555555': { category: 'other' },
};
const fuel2 = jpkDocumentId('cost', '2222222222', 'F 102/01/26');

const purchase = (over: Record<string, string> = {}) => ({
  NrDostawcy: '2222222222',
  NazwaDostawcy: 'Dostawca',
  DowodZakupu: 'F 1',
  DataZakupu: '2026-03-10',
  K_42: '100.00',
  K_43: '23.00',
  ...over,
});
const sale = (over: Record<string, string> = {}) => ({
  NrKontrahenta: '1111111111',
  NazwaKontrahenta: 'Klient',
  DowodSprzedazy: 'FV 1',
  DataWystawienia: '2026-03-31',
  K_19: '100.00',
  K_20: '23.00',
  ...over,
});
const importMarch = (input: Parameters<typeof jpkXml>[0], rules: ContractorRules = {}) =>
  documentsFromJpk(parseJpkV7M(jpkXml({ month: 3, ...input })), rules);

describe('імпорт січня 2026 з JPK бухгалтера', () => {
  // KPiR бухгалтера для пального F 102: вибір між 223,92 і 223,91 робить лише ця сума
  const imported = documentsFromJpk(parseJpkV7M(january2026Jpk), januaryRules, { kpirAmounts: { [fuel2]: 22_391 } });
  const docs = imported.documents;

  it('кожен рядок став коректним документом', () => {
    expect(imported.issues).toEqual([]);
    expect(imported.missingRules).toEqual([]);
    expect(docs).toHaveLength(6);
    expect(docs.flatMap((d) => documentIssues(d))).toEqual([]);
    expect(docs.every((d) => d.source === 'import')).toBe(true);
  });
  it('продаж: дата виконання, розрахунковий період за правилом контрагента', () => {
    expect(docs[0]).toMatchObject({
      kind: 'income',
      number: 'FV 1/01/2026',
      issueDate: '2026-02-02',
      saleDate: '2026-01-31',
      periodicSettlement: true,
      contractor: { name: 'Klient IT sp. z o.o.', nip: '1111111111', country: 'PL' },
      lines: [{ net: 1_856_000, vatRate: '23', vat: 426_880 }],
    });
  });
  it('реєстри VAT і декларація — як у файлі', () => {
    const registers = vatRegisters(docs, 2026, 1);
    expect(vatTotals(registers.sales)).toEqual(january2026.expected.sales);
    expect(vatTotals(registers.purchases)).toEqual(january2026.expected.purchases);
    expect(vatDeclaration(registers)).toMatchObject({
      output: january2026.expected.vatOutput,
      input: january2026.expected.vatInput,
    });
  });
  it('KPiR до гроша з KPiR бухгалтера', () => {
    const year = calcYearFromDocuments(docs, january2026.settings, TAX_CONFIG[2026]!);
    const entries = [...kpirFromDocuments(docs, 2026), ...kpirContributions(2026, year)];
    expect(kpirTotals(entries, 1)).toEqual(january2026.expected.kpir);
  });
  it('неоднозначні суми авто — у примітках з варіантами й вибраним; вирішене підказкою теж, щоб його можна було змінити', () => {
    expect(imported.notes.map((n) => [n.number, n.code, n.choices?.map((c) => c.pitAmount), n.selected])).toEqual([
      ['F 101/01/26', 'ambiguousAmount', [14_705, 14_704, 14_703], 14_705],
      ['FAS/1/01/2026', 'ambiguousAmount', [105_245, 105_244], 105_245],
      ['F 102/01/26', 'ambiguousAmount', [22_392, 22_391], 22_391],
    ]);
  });
  it('без підказки береться перший варіант і про це є примітка', () => {
    const plain = documentsFromJpk(parseJpkV7M(january2026Jpk), januaryRules);
    expect(plain.notes.find((n) => n.documentId === fuel2)?.choices?.map((c) => c.pitAmount)).toEqual([22_392, 22_391]);
    const kpir = kpirTotals(kpirFromDocuments(plain.documents, 2026), 1);
    expect(kpir.col15).toBe(january2026.expected.kpir.col15 + 1);
  });
  it('повторний імпорт зберігає вибір варіанта сум: підказки з уже збережених документів', () => {
    const hints = kpirHintsFromDocuments([...docs, { ...docs[1], id: 'manual-1' }]);
    expect(Object.keys(hints)).toHaveLength(5);
    expect(hints[fuel2]).toBe(22_391);
    const again = documentsFromJpk(parseJpkV7M(january2026Jpk), januaryRules, { kpirAmounts: hints });
    expect(again.notes).toEqual(imported.notes);
    expect(again.documents).toEqual(docs);
  });
  it('повторний імпорт дає ті самі id', () => {
    const again = documentsFromJpk(parseJpkV7M(january2026Jpk), januaryRules);
    expect(again.documents.map((d) => d.id)).toEqual(docs.map((d) => d.id));
    expect(new Set(docs.map((d) => d.id)).size).toBe(6);
    expect(docs.every((d) => !d.id.includes('/'))).toBe(true);
  });
});

describe('витрати з JPK', () => {
  it('без правила контрагента документа немає, контрагент — у missingRules один раз', () => {
    const r = importMarch({ purchases: [purchase(), purchase({ DowodZakupu: 'F 2' })] });
    expect(r.documents).toEqual([]);
    expect(r.issues.map((i) => [i.number, i.code])).toEqual([
      ['F 1', 'category'],
      ['F 2', 'category'],
    ]);
    expect(r.missingRules).toEqual([{ key: '2222222222', name: 'Dostawca' }]);
  });
  it('100% відлік: суми як у файлі, ставка за співвідношенням VAT і netto', () => {
    const r = importMarch(
      {
        purchases: [
          purchase({ DataWplywu: '2026-03-12', NrKSeF: '2222222222-20260310-AAAAAAAAAAAA-01' }),
          purchase({ DowodZakupu: 'F 2', K_42: '50.00', K_43: '4.00', BFK: '1' }),
          purchase({ DowodZakupu: 'F 3', K_42: '10.00', K_43: '0.00' }),
        ],
      },
      { '2222222222': { category: 'office' } },
    );
    expect(r.notes).toEqual([]);
    expect(r.documents.map((d) => d.kind === 'cost' && d.lines)).toEqual([
      [{ net: 10_000, vatRate: '23', vat: 2_300 }],
      [{ net: 5_000, vatRate: '8', vat: 400 }],
      [{ net: 1_000, vatRate: '0', vat: 0 }],
    ]);
    expect(r.documents[0]).toMatchObject({
      receivedDate: '2026-03-12',
      ksefNumber: '2222222222-20260310-AAAAAAAAAAAA-01',
      category: 'office',
    });
    expect(r.documents[1]).toMatchObject({ marker: 'BFK' });
  });
  it('авто: K_42 і K_43 — половина, повні суми відновлюються', () => {
    const r = importMarch(
      { purchases: [purchase({ K_42: '50.00', K_43: '11.50' })] },
      { '2222222222': { category: 'carMixed' } },
    );
    const doc = r.documents[0];
    expect(doc.kind === 'cost' && doc.lines).toEqual([{ net: 10_000, vatRate: '23', vat: 2_300 }]);
    expect(vatTotals(vatRegisters(r.documents, 2026, 3).purchases)).toEqual({ K_42: 5_000, K_43: 1_150 });
    // 99,99 і 100,00 netto (22,99 і 23,00 VAT) дають ту саму половину, але різний koszt
    expect(r.notes).toMatchObject([
      {
        code: 'ambiguousAmount',
        choices: [{ pitAmount: 8_363, net: 10_000, vat: 2_300 }, { pitAmount: 8_362 }, { pitAmount: 8_361 }],
      },
    ]);
  });
  it('підказка, що не відповідає жодному варіанту, — примітка kpirMismatch', () => {
    const jpk = parseJpkV7M(
      jpkXml({ month: 1, purchases: [purchase({ DataZakupu: '2026-01-25', K_42: '133.88', K_43: '30.80' })] }),
    );
    const id = jpkDocumentId('cost', '2222222222', 'F 1');
    const r = documentsFromJpk(jpk, { '2222222222': { category: 'carMixed' } }, { kpirAmounts: { [id]: 1 } });
    expect(r.notes).toMatchObject([{ code: 'kpirMismatch', choices: [{ pitAmount: 22_392 }, { pitAmount: 22_391 }] }]);
  });
  it('коригувальна фактура з від’ємними сумами', () => {
    const r = importMarch(
      { purchases: [purchase({ K_42: '-50.00', K_43: '-11.50' })] },
      { '2222222222': { category: 'carMixed' } },
    );
    const doc = r.documents[0];
    expect(doc.kind === 'cost' && doc.lines).toEqual([{ net: -10_000, vatRate: '23', vat: -2_300 }]);
    expect(vatTotals(vatRegisters(r.documents, 2026, 3).purchases)).toEqual({ K_42: -5_000, K_43: -1_150 });
  });
  it('VAT відлічено в іншому місяці, ніж за правилами: документ у місяці файла з приміткою', () => {
    // фактура від 1 квітня у JPK за березень
    const r = importMarch(
      { purchases: [purchase({ DataZakupu: '2026-04-01' })] },
      { '2222222222': { category: 'other' } },
    );
    expect(r.documents[0]).toMatchObject({ issueDate: '2026-04-01', vatDate: '2026-03-31' });
    expect(r.notes).toEqual([
      { documentId: r.documents[0].id, number: 'F 1', code: 'vatPeriod', ruleDate: '2026-04-01' },
    ]);
    expect(vatRegisters(r.documents, 2026, 3).purchases).toHaveLength(1);
  });
  it('отримана пізніше, ніж виставлена, у місяці отримання — без примітки', () => {
    const r = importMarch(
      { purchases: [purchase({ DataZakupu: '2026-02-27', DataWplywu: '2026-03-02' })] },
      { '2222222222': { category: 'other' } },
    );
    expect(r.notes).toEqual([]);
    expect(r.documents[0]).not.toHaveProperty('vatDate');
  });
  it('поля, яких облік не веде, і особливі документи — у issues', () => {
    const r = importMarch(
      {
        purchases: [
          purchase({ K_40: '1000.00', K_41: '230.00' }),
          purchase({ DowodZakupu: 'F 2', DokumentZakupu: 'VAT_RR' }),
        ],
      },
      { '2222222222': { category: 'other' } },
    );
    expect(r.documents).toEqual([]);
    expect(r.issues.map((i) => [i.code, i.detail])).toEqual([
      ['unsupportedField', 'K_40, K_41'],
      ['documentType', 'VAT_RR'],
    ]);
  });
  it('import usług з JPK не імпортується: його вносять вручну', () => {
    const r = importMarch({ purchases: [purchase()] }, { '2222222222': { category: 'importServices' } });
    expect(r.issues).toMatchObject([{ code: 'unsupportedField', detail: 'import usług' }]);
  });
  it('той самий документ двічі', () => {
    const r = importMarch({ purchases: [purchase(), purchase()] }, { '2222222222': { category: 'other' } });
    expect(r.documents).toHaveLength(1);
    expect(r.issues).toMatchObject([{ lp: 2, code: 'duplicate' }]);
  });
});

describe('категорія окремого документа', () => {
  // Серпень 2026 (дані вигадані, суми — як у справжньому випадку): на АЗС, для якої правило «авто»,
  // одна фактура — дрібні товари. Бухгалтер вніс її як «Інше» з повним відліком, тож у JPK повні суми.
  const fuelRule: ContractorRules = { '2222222222': { category: 'carMixed' } };
  const august = parseJpkV7M(
    jpkXml({
      month: 8,
      purchases: [
        purchase({ DowodZakupu: 'F 1/08/26', DataZakupu: '2026-08-10', K_42: '0.81', K_43: '0.19' }),
        purchase({ DowodZakupu: 'F 2/08/26', DataZakupu: '2026-08-10', K_42: '50.00', K_43: '11.50' }),
      ],
    }),
  );
  const small = jpkDocumentId('cost', '2222222222', 'F 1/08/26');
  const fuel = jpkDocumentId('cost', '2222222222', 'F 2/08/26');
  const overrides: CategoryOverrides = { [small]: 'other' };
  const col15 = (r: ReturnType<typeof documentsFromJpk>) => kpirTotals(kpirFromDocuments(r.documents, 2026), 8).col15;
  const categories = (r: ReturnType<typeof documentsFromJpk>) =>
    Object.fromEntries(r.documents.map((d) => [d.id, d.kind === 'cost' && d.category]));

  it('перевизначення має пріоритет над правилом контрагента, решта документів — за правилом', () => {
    const r = documentsFromJpk(august, fuelRule, {}, overrides);
    expect(categories(r)).toEqual({ [small]: 'other', [fuel]: 'carMixed' });
    const doc = r.documents.find((d) => d.id === small)!;
    expect(doc.kind === 'cost' && doc.lines).toEqual([{ net: 81, vatRate: '23', vat: 19 }]);
    expect(r.notes.map((n) => n.documentId)).toEqual([fuel]);
    expect(r.issues).toEqual([]);
  });
  it('без перевизначення документ іде як авто, і koszt у KPiR більший на 0,55', () => {
    const asCar = documentsFromJpk(august, fuelRule);
    expect(categories(asCar)[small]).toBe('carMixed');
    expect(col15(asCar) - col15(documentsFromJpk(august, fuelRule, {}, overrides))).toBe(55);
  });
  it('реєстр VAT однаковий: категорія впливає лише на koszt', () => {
    const asOther = vatRegisters(documentsFromJpk(august, fuelRule, {}, overrides).documents, 2026, 8);
    expect(vatTotals(asOther.purchases)).toEqual({ K_42: 5_081, K_43: 1_169 });
  });
  it('повторний імпорт з тими самими перевизначеннями дає ті самі документи', () => {
    const first = documentsFromJpk(august, fuelRule, {}, overrides);
    const again = documentsFromJpk(
      august,
      fuelRule,
      { kpirAmounts: kpirHintsFromDocuments(first.documents) },
      overrides,
    );
    expect(again.documents).toEqual(first.documents);
  });
  it('перевизначення без правила контрагента: документ є, але решта рядків контрагента просить категорію', () => {
    const r = documentsFromJpk(august, {}, {}, overrides);
    expect(r.documents.map((d) => d.id)).toEqual([small]);
    expect(r.issues.map((i) => [i.number, i.code])).toEqual([['F 2/08/26', 'category']]);
    expect(r.missingRules).toEqual([{ key: '2222222222', name: 'Dostawca' }]);
  });
  it('перевизначення на import usług не імпортується, як і правило', () => {
    const r = documentsFromJpk(august, fuelRule, {}, { [small]: 'importServices' });
    expect(r.issues).toMatchObject([{ number: 'F 1/08/26', code: 'unsupportedField', detail: 'import usług' }]);
  });
  it('перевизначення для чужого id чи з невідомою категорією нічого не змінює', () => {
    const r = documentsFromJpk(august, fuelRule, {}, { 'jpk-cost-x-y': 'other' });
    expect(categories(r)).toEqual({ [small]: 'carMixed', [fuel]: 'carMixed' });
    const unknown = { [small]: 'car', [fuel]: 'toString' } as unknown as CategoryOverrides;
    expect(categories(documentsFromJpk(august, fuelRule, {}, unknown))).toEqual({
      [small]: 'carMixed',
      [fuel]: 'carMixed',
    });
  });
  it('підказка з документа, чия категорія зміниться, не береться', () => {
    const asCar = documentsFromJpk(august, fuelRule).documents;
    expect(Object.keys(kpirHintsFromDocuments(asCar))).toEqual([small, fuel]);
    expect(Object.keys(kpirHintsFromDocuments(asCar, fuelRule))).toEqual([small, fuel]);
    expect(Object.keys(kpirHintsFromDocuments(asCar, fuelRule, overrides))).toEqual([fuel]);
    // і навпаки: перевизначення прибрали — документ «Інше» знову стає авто
    const asOther = documentsFromJpk(august, fuelRule, {}, overrides).documents;
    expect(Object.keys(kpirHintsFromDocuments(asOther, fuelRule, overrides))).toEqual([small, fuel]);
    expect(Object.keys(kpirHintsFromDocuments(asOther, fuelRule))).toEqual([fuel]);
  });
});

describe('продаж з JPK', () => {
  it('кілька ставок у рядку дають кілька позицій', () => {
    const r = importMarch({ sales: [sale({ K_17: '10.00', K_18: '0.80', K_10: '5.00' })] });
    const doc = r.documents[0];
    expect(doc.kind === 'income' && doc.lines).toEqual([
      { net: 10_000, vatRate: '23', vat: 2_300 },
      { net: 1_000, vatRate: '8', vat: 80 },
      { net: 500, vatRate: 'zw' },
    ]);
    expect(vatTotals(vatRegisters(r.documents, 2026, 3).sales)).toEqual({
      K_10: 500,
      K_17: 1_000,
      K_18: 80,
      K_19: 10_000,
      K_20: 2_300,
    });
  });
  it('np для контрагента з ЄС: K_11 і K_12 відтворюються', () => {
    const r = importMarch({
      sales: [{ ...sale({ K_11: '500.00', K_12: '500.00' }), KodKrajuNadaniaTIN: 'DE', K_19: '0.00', K_20: '0.00' }],
    });
    expect(r.issues).toEqual([]);
    expect(r.documents[0].kind === 'income' && r.documents[0].contractor.country).toBe('DE');
    expect(vatTotals(vatRegisters(r.documents, 2026, 3).sales)).toMatchObject({ K_11: 50_000, K_12: 50_000 });
  });
  it('np без країни контрагента — issue country; K_12 не з тим контрагентом — amount', () => {
    const noCountry = importMarch({ sales: [sale({ K_11: '500.00' })] });
    expect(noCountry.issues).toMatchObject([{ code: 'country' }]);
    const wrongK12 = importMarch({
      sales: [{ ...sale({ K_11: '500.00', K_12: '500.00' }), KodKrajuNadaniaTIN: 'US' }],
    });
    expect(wrongK12.issues).toMatchObject([{ code: 'amount', detail: 'K_12' }]);
  });
  it('розрахунковий період без дати продажу не ставиться', () => {
    const r = importMarch({ sales: [sale()] }, { '1111111111': { periodicSettlement: true } });
    expect(r.documents[0]).not.toHaveProperty('periodicSettlement');
  });
  it('import usług у продажу (K_27–K_30) і paragony (RO) — у issues', () => {
    const r = importMarch({
      sales: [sale({ K_29: '100.00', K_30: '23.00' }), sale({ DowodSprzedazy: 'RO 1', TypDokumentu: 'RO' })],
    });
    expect(r.issues.map((i) => i.code)).toEqual(['unsupportedField', 'documentType']);
  });
});
