import { describe, expect, it } from 'vitest';
import { documentDates, documentFx, documentIssues, fxDifference, isOtherEuCountry, valueDocument } from './document';
import { cost, importEu, income, internal } from './fixtures/builders';

describe('дати події', () => {
  it('дохід: без дати продажу PIT і VAT — у день фактури', () => {
    expect(documentDates(income({ issueDate: '2026-03-31' }))).toEqual({ pit: '2026-03-31', vat: '2026-03-31' });
  });
  it('дохід: фактура після виконання послуги — PIT і VAT у день виконання', () => {
    const doc = income({ saleDate: '2026-02-28', issueDate: '2026-03-05' });
    expect(documentDates(doc)).toEqual({ pit: '2026-02-28', vat: '2026-02-28' });
  });
  it('дохід: фактура до виконання — PIT у день фактури, VAT у день виконання', () => {
    const doc = income({ issueDate: '2026-02-20', saleDate: '2026-03-02' });
    expect(documentDates(doc)).toEqual({ pit: '2026-02-20', vat: '2026-03-02' });
  });
  it('дохід за розрахунковий період: PIT у кінці періоду, навіть якщо фактура раніше (art. 14 ust. 1e)', () => {
    const doc = income({ issueDate: '2026-03-28', saleDate: '2026-03-31', periodicSettlement: true });
    expect(documentDates(doc)).toEqual({ pit: '2026-03-31', vat: '2026-03-31' });
    expect(documentDates({ ...doc, periodicSettlement: false }).pit).toBe('2026-03-28');
  });
  it('дохід: передоплата пересуває і PIT, і VAT на день оплати', () => {
    const doc = income({ paidAt: '2026-02-10', saleDate: '2026-03-02', issueDate: '2026-03-02' });
    expect(documentDates(doc)).toEqual({ pit: '2026-02-10', vat: '2026-02-10' });
  });
  it('дохід: оплата після фактури нічого не змінює', () => {
    const doc = income({ issueDate: '2026-03-31', paidAt: '2026-04-14' });
    expect(documentDates(doc)).toEqual({ pit: '2026-03-31', vat: '2026-03-31' });
  });
  it('витрата: PIT у день фактури, VAT не раніше отримання', () => {
    const doc = cost({ issueDate: '2026-02-27', receivedDate: '2026-03-02' });
    expect(documentDates(doc)).toEqual({ pit: '2026-02-27', vat: '2026-03-02' });
  });
  it('витрата: фактура до поставки — VAT у день поставки', () => {
    const doc = cost({ issueDate: '2026-03-30', saleDate: '2026-04-03' });
    expect(documentDates(doc)).toEqual({ pit: '2026-03-30', vat: '2026-04-03' });
  });
  it('витрата: дата продажу раніша за фактуру (media) — VAT за фактурою', () => {
    const doc = cost({ saleDate: '2026-02-28', issueDate: '2026-03-05' });
    expect(documentDates(doc)).toEqual({ pit: '2026-03-05', vat: '2026-03-05' });
  });
  it('import usług: PIT у день фактури, VAT у день виконання послуги', () => {
    const doc = importEu({ saleDate: '2026-02-28', issueDate: '2026-03-03', receivedDate: '2026-03-04' });
    expect(documentDates(doc)).toEqual({ pit: '2026-03-03', vat: '2026-02-28' });
  });
  it('import usług: оплата до виконання — VAT у день оплати', () => {
    const doc = importEu({ paidAt: '2026-03-10', issueDate: '2026-03-12' });
    expect(documentDates(doc)).toEqual({ pit: '2026-03-12', vat: '2026-03-10' });
  });
  it('дати з документа перевизначають правило', () => {
    const doc = cost({ issueDate: '2026-01-15', pitDate: '2026-01-31', vatDate: '2026-03-01' });
    expect(documentDates(doc)).toEqual({ pit: '2026-01-31', vat: '2026-03-01' });
  });
  it('внутрішній документ поза VAT', () => {
    expect(documentDates(internal({ issueDate: '2026-03-31' }))).toEqual({ pit: '2026-03-31', vat: null });
    expect(documentDates(internal({ pitDate: '2026-02-28' })).pit).toBe('2026-02-28');
  });
});

describe('курси документа', () => {
  const EUR = { '2026-02-19': 4.1, '2026-02-27': 4.2, '2026-03-02': 4.3 };

  it('PLN не потребує курсу', () => {
    expect(documentFx(cost())).toEqual({ pit: 1, vat: 1 });
  });
  it('import usług: курс PIT перед днем фактури, курс VAT перед днем виконання', () => {
    const doc = importEu({ saleDate: '2026-02-28', issueDate: '2026-03-03' });
    expect(documentFx(doc, { EUR })).toEqual({ pit: 4.3, vat: 4.2 });
  });
  it('власна фактура до виконання послуги: курс VAT перед днем фактури (art. 31a ust. 2)', () => {
    const doc = income({ currency: 'EUR', issueDate: '2026-02-20', saleDate: '2026-02-28' });
    expect(documentFx(doc, { EUR })).toEqual({ pit: 4.1, vat: 4.1 });
  });
  it('власна фактура після виконання: обидва курси перед днем виконання', () => {
    const doc = income({ currency: 'EUR', saleDate: '2026-02-28', issueDate: '2026-03-03' });
    expect(documentFx(doc, { EUR })).toEqual({ pit: 4.2, vat: 4.2 });
  });
  it('ручний курс має перевагу над таблицею', () => {
    const doc = importEu({ issueDate: '2026-03-03', fxRatePit: 4.5 });
    expect(documentFx(doc, { EUR })).toEqual({ pit: 4.5, vat: 4.3 });
  });
  it('без курсу — null, і документ не оцінюється', () => {
    const doc = importEu({ issueDate: '2026-06-01' });
    expect(documentFx(doc, { EUR })).toEqual({ pit: null, vat: null });
    expect(documentFx(doc)).toEqual({ pit: null, vat: null });
    expect(valueDocument(doc, { EUR })).toBeNull();
    expect(valueDocument(importEu({ issueDate: '2026-06-01', fxRatePit: 4.3 }), { EUR })).toBeNull(); // немає курсу VAT
  });
});

describe('суми документа', () => {
  it('дохід: przychód — netto, VAT рахується від суми', () => {
    const v = valueDocument(income({ lines: [{ net: 1_000_050, vatRate: '23' }] }))!;
    expect(v.pitAmount).toBe(1_000_050);
    expect(v.vat).toBe(230_012); // 2 300,115 → 2 300,12
    expect(v.vatDeductible).toBe(0);
  });
  it('VAT з фактури має перевагу над порахованим', () => {
    const v = valueDocument(cost({ lines: [{ net: 1_000, vatRate: '23', vat: 231 }] }))!;
    expect(v.vat).toBe(231);
  });
  it('VAT без суми рахується від суми netto за ставкою, а не по позиціях', () => {
    const lines = [333, 333, 334].map((net) => ({ net, vatRate: '23' as const }));
    // по позиціях було б 77 + 77 + 77 = 231
    expect(valueDocument(cost({ lines }))!.vat).toBe(230);
  });
  it('позиції з VAT і без нього в одній ставці', () => {
    const v = valueDocument(
      cost({
        lines: [
          { net: 1_000, vatRate: '23', vat: 231 },
          { net: 500, vatRate: '23' },
        ],
      }),
    )!;
    expect(v.groups).toEqual([{ rate: '23', base: 1_500, vat: 346 }]);
  });
  it('кілька ставок дають окремі групи', () => {
    const v = valueDocument(
      cost({
        lines: [
          { net: 10_000, vatRate: '23' },
          { net: 5_000, vatRate: '8' },
          { net: 2_000, vatRate: 'zw' },
        ],
      }),
    )!;
    expect(v.groups).toEqual([
      { rate: '23', base: 10_000, vat: 2_300 },
      { rate: '8', base: 5_000, vat: 400 },
      { rate: 'zw', base: 2_000, vat: 0 },
    ]);
    expect(v.pitAmount).toBe(17_000);
  });
  it('авто: 50% VAT до відліку, 75% від netto з невідліченим VAT', () => {
    const v = valueDocument(cost({ category: 'carMixed', lines: [{ net: 24_382, vatRate: '23', vat: 5_608 }] }))!;
    expect(v.vatDeductible).toBe(2_804);
    expect(v.vatNonDeductible).toBe(2_804);
    expect(v.pitAmount).toBe(20_390); // 271,86 × 75% = 203,895
  });
  it('авто: половина гроша VAT іде у відлік, решта — у koszty', () => {
    const v = valueDocument(cost({ category: 'carMixed', lines: [{ net: 18_701, vatRate: '23', vat: 4_301 }] }))!;
    expect(v.vatDeductible).toBe(2_151); // 21,505
    expect(v.vatNonDeductible).toBe(2_150);
    expect(v.vatDeductible + v.vatNonDeductible).toBe(v.vat);
    expect(v.pitAmount).toBe(15_638); // 208,51 × 75% = 156,3825
  });
  it("коригувальний документ: від'ємні суми округлюються дзеркально", () => {
    const v = valueDocument(cost({ category: 'carMixed', lines: [{ net: -18_701, vatRate: '23', vat: -4_301 }] }))!;
    expect(v.vatDeductible).toBe(-2_151);
    expect(v.vatNonDeductible).toBe(-2_150);
    expect(v.pitAmount).toBe(-15_638);
  });
  it('import usług: koszt за курсом PIT, основа й VAT за курсом VAT', () => {
    const v = valueDocument(importEu({ lines: [{ net: 10_000, vatRate: '23' }], fxRatePit: 4.3, fxRateVat: 4.2 }))!;
    expect(v.netPit).toBe(43_000);
    expect(v.groups).toEqual([{ rate: '23', base: 42_000, vat: 9_660 }]);
    expect(v.vatDeductible).toBe(9_660);
    expect(v.pitAmount).toBe(43_000);
  });
  it('валюта: перерахунок раз на документ, а не по позиціях', () => {
    const lines = [333, 333, 334].map((net) => ({ net, vatRate: '23' as const }));
    // 1000 центів × 4,2555 = 4255,5 → 4256; по позиціях було б 1417 + 1417 + 1421 = 4255
    expect(valueDocument(importEu({ lines, fxRatePit: 4.2555, fxRateVat: 4.2555 }))!.netPit).toBe(4_256);
  });
  it('порожні суми', () => {
    const v = valueDocument(cost({ lines: [{ net: 0, vatRate: '23' }] }))!;
    expect([v.netPit, v.vat, v.pitAmount]).toEqual([0, 0, 0]);
  });
});

describe('курсові різниці', () => {
  const EUR = { '2026-03-09': 4.2512, '2026-03-19': 4.3 };
  const claude = importEu({ issueDate: '2026-03-10', lines: [{ net: 10_000, vatRate: '23' }] });

  it("витрата: банк списав більше, ніж внесено в книгу, — від'ємна різниця", () => {
    const diff = fxDifference({ ...claude, paidAt: '2026-03-10', paidPln: 43_105 }, { EUR });
    expect(diff).toEqual({ date: '2026-03-10', amount: -593 }); // 425,12 − 431,05
  });
  it('витрата: банк списав менше — додатна різниця', () => {
    expect(fxDifference({ ...claude, paidAt: '2026-03-10', paidPln: 42_000 }, { EUR })!.amount).toBe(512);
  });
  it('без суми банку береться курс NBP перед днем оплати', () => {
    const diff = fxDifference({ ...claude, paidAt: '2026-03-20' }, { EUR });
    expect(diff).toEqual({ date: '2026-03-20', amount: 42_512 - 43_000 });
  });
  it('дохід: отримано більше, ніж внесено в книгу, — додатна різниця', () => {
    const doc = income({
      currency: 'EUR',
      contractor: { name: 'Client GmbH', nip: '123456789', country: 'DE' },
      issueDate: '2026-03-10',
      lines: [{ net: 100_000, vatRate: 'np' }],
      paidAt: '2026-03-20',
      paidPln: 431_000,
    });
    expect(fxDifference(doc, { EUR })).toEqual({ date: '2026-03-20', amount: 431_000 - 425_120 });
  });
  it('не рахується: PLN, без оплати, без курсу оплати, з VAT на фактурі', () => {
    expect(fxDifference(cost({ paidAt: '2026-03-12' }))).toBeNull();
    expect(fxDifference(claude, { EUR })).toBeNull();
    expect(fxDifference({ ...claude, paidAt: '2026-05-05' }, { EUR })).toBeNull();
    const withVat = income({ currency: 'EUR', issueDate: '2026-03-10', paidAt: '2026-03-20', paidPln: 500_000 });
    expect(fxDifference(withVat, { EUR })).toBeNull();
  });
});

describe('перевірка документа', () => {
  it('коректні документи без зауважень', () => {
    expect(documentIssues(income())).toEqual([]);
    expect(documentIssues(cost({ ksefNumber: '1130000000-20260310-0123456789AB-CD' }))).toEqual([]);
    expect(documentIssues(importEu({ fxRatePit: 4.3, paidAt: '2026-03-10', paidPln: 43_105 }))).toEqual([]);
    expect(documentIssues(internal())).toEqual([]);
  });
  it('номер і дати', () => {
    expect(documentIssues(income({ number: ' ' }))).toEqual(['number']);
    expect(documentIssues(income({ issueDate: '2026-02-31' }))).toEqual(['date']);
    expect(documentIssues(cost({ receivedDate: '10.03.2026' }))).toEqual(['date']);
    expect(documentIssues(internal({ pitDate: '2026-13-01' }))).toEqual(['date']);
  });
  it('розрахунковий період без дати продажу', () => {
    expect(documentIssues(income({ periodicSettlement: true }))).toEqual(['saleDate']);
    expect(documentIssues(income({ periodicSettlement: true, saleDate: '2026-03-31' }))).toEqual([]);
  });
  it('контрагент і позиції', () => {
    expect(documentIssues(income({ contractor: { name: '', country: 'PL' } }))).toEqual(['contractor']);
    expect(documentIssues(income({ contractor: { name: 'X', country: 'Polska' } }))).toEqual(['contractor']);
    expect(documentIssues(cost({ lines: [] }))).toEqual(['lines']);
  });
  it('суми мають бути цілими', () => {
    expect(documentIssues(cost({ lines: [{ net: 100.5, vatRate: '23' }] }))).toEqual(['amount']);
    expect(documentIssues(cost({ lines: [{ net: 100, vatRate: '23', vat: 23.5 }] }))).toEqual(['amount']);
    expect(documentIssues(internal({ amount: Number.NaN }))).toEqual(['amount']);
  });
  it('VAT на позиції без ставки', () => {
    expect(documentIssues(income({ lines: [{ net: 100, vatRate: 'np', vat: 23 }] }))).toEqual(['vat']);
    expect(documentIssues(income({ lines: [{ net: 100, vatRate: 'zw', vat: 0 }] }))).toEqual([]);
  });
  it('курс, KSeF, оплата', () => {
    expect(documentIssues(importEu({ fxRateVat: 0 }))).toEqual(['fxRate']);
    expect(documentIssues(cost({ ksefNumber: 'X', marker: 'BFK' }))).toEqual(['ksef']);
    expect(documentIssues(importEu({ paidPln: 43_105 }))).toEqual(['payment']);
  });
  it('import usług від польського контрагента', () => {
    expect(documentIssues(cost({ category: 'importServices' }))).toEqual(['reverseCharge']);
  });
  it('кілька проблем разом', () => {
    expect(documentIssues(cost({ number: '', lines: [] }))).toEqual(['number', 'lines']);
  });
});

describe('країни ЄС', () => {
  it('інша держава ЄС — не Польща і не третя країна', () => {
    expect(isOtherEuCountry('IE')).toBe(true);
    expect(isOtherEuCountry('EL')).toBe(true);
    expect(isOtherEuCountry('PL')).toBe(false);
    expect(isOtherEuCountry('US')).toBe(false);
    expect(isOtherEuCountry('GB')).toBe(false);
  });
});
