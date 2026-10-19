import type { LedgerDocument } from '@jdg/core';
import { describe, expect, it } from 'vitest';
import { buildImportPlan, parseFile, staleImported } from './importPlan';

/** Мінімальний JPK_V7M(3): дані вигадані */
function jpk(month: number, purchases: string[], sales: string[] = [], purpose = 1) {
  const row = (tag: string, body: string) => `<tns:${tag}>${body}</tns:${tag}>`;
  return (
    `<?xml version="1.0" encoding="utf-8"?><tns:JPK xmlns:tns="http://crd.gov.pl/wzor/2025/12/19/14090/">` +
    `<tns:Naglowek><tns:KodFormularza kodSystemowy="JPK_V7M (3)" wersjaSchemy="1-0E">JPK_VAT</tns:KodFormularza>` +
    `<tns:CelZlozenia poz="P_7">${purpose}</tns:CelZlozenia><tns:Rok>2026</tns:Rok><tns:Miesiac>${month}</tns:Miesiac></tns:Naglowek>` +
    `<Deklaracja xmlns="http://crd.gov.pl/wzor/2025/12/19/14090/"><PozycjeSzczegolowe><P_38>23</P_38><P_48>23</P_48></PozycjeSzczegolowe></Deklaracja>` +
    `<tns:Ewidencja>` +
    sales.map((s) => row('SprzedazWiersz', s)).join('') +
    `<tns:SprzedazCtrl><tns:LiczbaWierszySprzedazy>${sales.length}</tns:LiczbaWierszySprzedazy><tns:PodatekNalezny>0</tns:PodatekNalezny></tns:SprzedazCtrl>` +
    purchases.map((p) => row('ZakupWiersz', p)).join('') +
    `<tns:ZakupCtrl><tns:LiczbaWierszyZakupow>${purchases.length}</tns:LiczbaWierszyZakupow><tns:PodatekNaliczony>${(purchases.length * 23).toFixed(2)}</tns:PodatekNaliczony></tns:ZakupCtrl>` +
    `</tns:Ewidencja></tns:JPK>`
  );
}
const purchase = (nip: string, number: string, date: string) =>
  `<tns:LpZakupu>1</tns:LpZakupu><tns:NrDostawcy>${nip}</tns:NrDostawcy><tns:NazwaDostawcy>Firma ${nip}</tns:NazwaDostawcy>` +
  `<tns:DowodZakupu>${number}</tns:DowodZakupu><tns:DataZakupu>${date}</tns:DataZakupu><tns:K_42>100.00</tns:K_42><tns:K_43>23.00</tns:K_43>`;
const sale =
  `<tns:LpSprzedazy>1</tns:LpSprzedazy><tns:NrKontrahenta>1111111111</tns:NrKontrahenta><tns:NazwaKontrahenta>Klient</tns:NazwaKontrahenta>` +
  `<tns:DowodSprzedazy>FV 1</tns:DowodSprzedazy><tns:DataWystawienia>2026-03-31</tns:DataWystawienia><tns:K_19>0.00</tns:K_19><tns:K_20>0.00</tns:K_20>`;

const march = parseFile('JPK_03.xml', jpk(3, [purchase('2222222222', 'F 1', '2026-03-10')], [sale]));

describe('розбір вибраних файлів', () => {
  it('JPK розібрано, контрольні суми перевірено', () => {
    expect(march).toMatchObject({ name: 'JPK_03.xml', ok: true, ctrlIssues: [] });
  });
  it('не JPK — помилка, а не виняток', () => {
    expect(parseFile('faktura.xml', '<Faktura/>')).toMatchObject({ ok: false, error: expect.stringMatching(/JPK/) });
  });
});

describe('план імпорту', () => {
  it('без категорії контрагента імпорт не готовий', () => {
    const plan = buildImportPlan([march], {}, {}, []);
    expect(plan.ready).toBe(false);
    expect(plan.missingRules).toEqual([{ key: '2222222222', name: 'Firma 2222222222' }]);
    expect(plan.salesContractors).toEqual([{ key: '1111111111', name: 'Klient' }]);
    expect(plan.purchaseContractors).toEqual([{ key: '2222222222', name: 'Firma 2222222222' }]);
    expect(plan.documents).toHaveLength(1);
  });
  it('з категорією: документи й еталон за період', () => {
    const plan = buildImportPlan([march], { '2222222222': { category: 'office' } }, {}, []);
    expect(plan.ready).toBe(true);
    expect(plan.documents.map((d) => d.kind)).toEqual(['income', 'cost']);
    expect(Object.keys(plan.references)).toEqual(['2026-03']);
    expect(plan.references['2026-03'].vat).toMatchObject({ output: 2_300, input: 2_300 });
  });
  it('два файли за той самий період — не готовий', () => {
    const correction = parseFile('JPK_03_kor.xml', jpk(3, [], [], 2));
    const plan = buildImportPlan([march, correction], { '2222222222': { category: 'office' } }, {}, []);
    expect(plan.duplicatePeriods).toEqual(['2026-03']);
    expect(plan.ready).toBe(false);
  });
  it('файли з помилкою пропускаються; без жодного файла — не готовий', () => {
    const bad = parseFile('x.xml', 'не xml');
    expect(buildImportPlan([bad], {}, {}, []).ready).toBe(false);
    expect(buildImportPlan([bad, march], { '2222222222': { category: 'office' } }, {}, []).files).toHaveLength(1);
  });
  it('корекція без рядка: документ попереднього імпорту за цей період видаляється', () => {
    const first = buildImportPlan([march], { '2222222222': { category: 'office' } }, {}, []);
    const correction = parseFile('JPK_03_kor.xml', jpk(3, [], [sale], 2));
    const plan = buildImportPlan([correction], {}, {}, first.documents);
    expect(plan.files[0].correction).toBe(true);
    expect(plan.stale).toEqual([first.documents[1].id]);
  });
});

describe('застарілі документи імпорту', () => {
  const doc = (id: string, issueDate: string): LedgerDocument & { id: string } => ({
    id,
    kind: 'cost',
    category: 'other',
    number: id,
    issueDate,
    contractor: { name: 'X', country: 'PL' },
    currency: 'PLN',
    lines: [{ net: 100, vatRate: '23', vat: 23 }],
    source: 'import',
  });
  it('лише з JPK, лише цього періоду, лише відсутні в новому файлі', () => {
    const existing = [
      doc('jpk-cost-a', '2026-03-05'),
      doc('jpk-cost-b', '2026-03-06'),
      doc('jpk-cost-c', '2026-04-01'),
      doc('manual-d', '2026-03-07'),
    ];
    expect(staleImported(existing, '2026-03', new Set(['jpk-cost-b']))).toEqual(['jpk-cost-a']);
  });
});
