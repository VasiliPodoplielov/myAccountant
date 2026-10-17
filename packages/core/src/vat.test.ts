import { describe, expect, it } from 'vitest';
import type { Contractor, VatRateCode } from './document';
import { cost, importEu, income, internal } from './fixtures/builders';
import { vatDeclaration, vatRegisters, vatRegistersByMonth, vatTotals } from './vat';

const DE: Contractor = { name: 'Client GmbH', nip: '123456789', country: 'DE' };
const US: Contractor = { name: 'Vendor Inc.', country: 'US' };

const march = (...docs: Parameters<typeof vatRegisters>[0]) => vatRegisters(docs, 2026, 3);

describe('реєстр продажу', () => {
  it('23%: основа в K_19, VAT у K_20, дані документа в рядку', () => {
    const { sales, purchases } = march({ ...income({ marker: 'BFK', saleDate: '2026-03-30' }), id: 'd1' });
    expect(purchases).toEqual([]);
    expect(sales).toEqual([
      {
        date: '2026-03-30',
        docNumber: 'FV 1/2026',
        issueDate: '2026-03-31',
        saleDate: '2026-03-30',
        contractor: { name: 'Klient sp. z o.o.', nip: '5250000000', country: 'PL' },
        marker: 'BFK',
        documentId: 'd1',
        fields: { K_19: 1_000_000, K_20: 230_000 },
      },
    ]);
  });
  it('кожна ставка йде у свої поля', () => {
    const line = (vatRate: VatRateCode) => ({ net: 10_000, vatRate });
    const { sales } = march(income({ lines: [line('23'), line('8'), line('5'), line('0'), line('zw')] }));
    expect(sales[0].fields).toEqual({
      K_19: 10_000,
      K_20: 2_300,
      K_17: 10_000,
      K_18: 800,
      K_15: 10_000,
      K_16: 500,
      K_13: 10_000,
      K_10: 10_000,
    });
  });
  it('np для контрагента з ЄС: K_11 і K_12', () => {
    const { sales } = march(income({ contractor: DE, lines: [{ net: 500_000, vatRate: 'np' }] }));
    expect(sales[0].fields).toEqual({ K_11: 500_000, K_12: 500_000 });
  });
  it('np для контрагента з-поза ЄС: лише K_11', () => {
    const { sales } = march(income({ contractor: US, lines: [{ net: 500_000, vatRate: 'np' }] }));
    expect(sales[0].fields).toEqual({ K_11: 500_000 });
  });
  it('np для польського контрагента в реєстр не йде', () => {
    expect(march(income({ lines: [{ net: 500_000, vatRate: 'np' }] })).sales).toEqual([]);
  });
  it('валютний продаж: основа за курсом VAT', () => {
    const doc = income({
      contractor: DE,
      currency: 'EUR',
      lines: [{ net: 100_000, vatRate: 'np' }],
      fxRatePit: 4.3,
      fxRateVat: 4.2,
    });
    expect(march(doc).sales[0].fields).toEqual({ K_11: 420_000, K_12: 420_000 });
  });
  it("коригувальна фактура дає від'ємні суми", () => {
    const { sales } = march(income({ lines: [{ net: -10_000, vatRate: '23' }] }));
    expect(sales[0].fields).toEqual({ K_19: -10_000, K_20: -2_300 });
  });
});

describe('реєстр закупівлі', () => {
  it('польська фактура: netto в K_42, VAT у K_43', () => {
    const { sales, purchases } = march(cost({ receivedDate: '2026-03-11' }));
    expect(sales).toEqual([]);
    expect(purchases[0]).toMatchObject({
      date: '2026-03-11',
      issueDate: '2026-03-10',
      receivedDate: '2026-03-11',
      fields: { K_42: 10_000, K_43: 2_300 },
    });
  });
  it('авто: половина VAT і половина netto', () => {
    const doc = cost({ category: 'carMixed', lines: [{ net: 18_701, vatRate: '23', vat: 4_301 }] });
    expect(march(doc).purchases[0].fields).toEqual({ K_42: 9_351, K_43: 2_151 });
  });
  it('авто з опцією partialNet: full — netto повністю', () => {
    const doc = cost({ category: 'carMixed', lines: [{ net: 18_701, vatRate: '23', vat: 4_301 }] });
    const { purchases } = vatRegisters([doc], 2026, 3, { partialNet: 'full' });
    expect(purchases[0].fields).toEqual({ K_42: 18_701, K_43: 2_151 });
  });
  it('позиції zw і 0% у реєстр закупівлі не йдуть', () => {
    const doc = cost({
      lines: [
        { net: 10_000, vatRate: '23' },
        { net: 4_000, vatRate: 'zw' },
        { net: 1_000, vatRate: '0' },
      ],
    });
    expect(march(doc).purchases[0].fields).toEqual({ K_42: 10_000, K_43: 2_300 });
    expect(march(cost({ lines: [{ net: 4_000, vatRate: 'zw' }] })).purchases).toEqual([]);
  });
});

describe('import usług', () => {
  it('постачальник з ЄС: K_29/K_30 і той самий VAT у K_42/K_43', () => {
    const { sales, purchases } = march(importEu({ fxRatePit: 4.3, fxRateVat: 4.2 }));
    expect(sales[0].fields).toEqual({ K_29: 42_000, K_30: 9_660 });
    expect(purchases[0].fields).toEqual({ K_42: 42_000, K_43: 9_660 });
  });
  it('постачальник з-поза ЄС: K_27/K_28', () => {
    const doc = importEu({ contractor: US, currency: 'USD', fxRatePit: 3.9127, fxRateVat: 3.9127 });
    const { sales, purchases } = march({ ...doc, lines: [{ net: 2_100, vatRate: '23' }] });
    expect(sales[0].fields).toEqual({ K_27: 8_217, K_28: 1_890 });
    expect(purchases[0].fields).toEqual({ K_42: 8_217, K_43: 1_890 });
  });
  it('звільнена послуга: основа з VAT 0, без рядка закупівлі', () => {
    const { sales, purchases } = march(
      importEu({ fxRatePit: 4, fxRateVat: 4, lines: [{ net: 1_000, vatRate: 'zw' }] }),
    );
    expect(sales[0].fields).toEqual({ K_29: 4_000, K_30: 0 });
    expect(purchases).toEqual([]);
  });
  it('позиція np (місце надання поза Польщею) — не import usług', () => {
    const doc = importEu({ fxRatePit: 4, fxRateVat: 4, lines: [{ net: 1_000, vatRate: 'np' }] });
    expect(march(doc)).toEqual({ sales: [], purchases: [] });
  });
});

describe('місяць реєстру', () => {
  it('документ потрапляє в місяць за датою VAT, а не PIT', () => {
    const late = cost({ issueDate: '2026-02-27', receivedDate: '2026-03-02' });
    expect(vatRegisters([late], 2026, 2).purchases).toEqual([]);
    expect(vatRegisters([late], 2026, 3).purchases).toHaveLength(1);
    const service = importEu({ saleDate: '2026-02-28', issueDate: '2026-03-03', fxRatePit: 4.3, fxRateVat: 4.2 });
    expect(vatRegisters([service], 2026, 2).sales).toHaveLength(1);
    expect(vatRegisters([service], 2026, 3).sales).toEqual([]);
  });
  it('реєстри року за один прохід дорівнюють помісячним', () => {
    const docs = [
      cost({ issueDate: '2026-01-15' }),
      income({ issueDate: '2026-03-31' }),
      cost({ issueDate: '2025-12-30' }),
    ];
    const byMonth = vatRegistersByMonth(docs, 2026);
    expect(byMonth).toHaveLength(12);
    byMonth.forEach((r, i) => expect(r).toEqual(vatRegisters(docs, 2026, i + 1)));
    expect(byMonth[0].purchases).toHaveLength(1);
    expect(byMonth[2].sales).toHaveLength(1);
  });
  it('той самий місяць іншого року не підходить', () => {
    expect(vatRegisters([cost()], 2025, 3).purchases).toEqual([]);
  });
  it('внутрішні документи й валютні без курсу пропускаються', () => {
    expect(march(internal(), importEu())).toEqual({ sales: [], purchases: [] });
  });
  it('рядки впорядковані за датою і номером', () => {
    const { purchases } = march(
      cost({ number: 'B', issueDate: '2026-03-20' }),
      cost({ number: 'C', issueDate: '2026-03-05' }),
      cost({ number: 'A', issueDate: '2026-03-20' }),
    );
    expect(purchases.map((r) => r.docNumber)).toEqual(['C', 'A', 'B']);
  });
});

describe('підсумки й декларація', () => {
  const registers = march(
    income({ lines: [{ net: 1_000_050, vatRate: '23' }] }), // VAT 2 300,12
    importEu({ fxRatePit: 4.2512, fxRateVat: 4.2512 }), // 425,12 → VAT 97,78
    importEu({ contractor: US, fxRatePit: 4, fxRateVat: 4, lines: [{ net: 2_054, vatRate: '23' }] }), // 82,16 → VAT 18,90
    cost({ lines: [{ net: 10_150, vatRate: '23', vat: 2_335 }] }),
  );

  it('підсумок по полях з грошами', () => {
    expect(vatTotals(registers.sales)).toEqual({
      K_19: 1_000_050,
      K_20: 230_012,
      K_29: 42_512,
      K_30: 9_778,
      K_27: 8_216,
      K_28: 1_890,
    });
    expect(vatTotals(registers.purchases)).toEqual({ K_42: 42_512 + 8_216 + 10_150, K_43: 9_778 + 1_890 + 2_335 });
  });
  it('у декларації кожна позиція округлюється до злотих окремо', () => {
    // należny: 2 300 + 98 + 19 zł; naliczony: 140,03 → 140 zł
    expect(vatDeclaration(registers)).toEqual({ output: 241_700, input: 14_000, reverseCharge: 11_668 });
  });
  it('окреме округлення позицій відрізняється від округлення суми', () => {
    const r = march(
      income({ lines: [{ net: 1_500, vatRate: '23' }] }), // VAT 3,45 → 3 zł
      importEu({ fxRatePit: 1, fxRateVat: 1, lines: [{ net: 1_500, vatRate: '23' }] }), // VAT 3,45 → 3 zł
    );
    // сума 6,90 округлилася б до 7 zł
    expect(vatDeclaration(r).output).toBe(600);
  });
  it('порожні реєстри', () => {
    expect(vatTotals([])).toEqual({});
    expect(vatDeclaration({ sales: [], purchases: [] })).toEqual({ output: 0, input: 0, reverseCharge: 0 });
  });
});
