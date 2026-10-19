import { describe, expect, it } from 'vitest';
import { january2026Jpk, jpkXml } from './fixtures/jpk';
import { JpkParseError, jpkCtrlIssues, jpkPeriod, parseJpkAmount, parseJpkV7M } from './jpk';

const sale = (over: Record<string, string> = {}) => ({
  NrKontrahenta: '1111111111',
  NazwaKontrahenta: 'Klient',
  DowodSprzedazy: 'FV 1',
  DataWystawienia: '2026-03-31',
  K_19: '100.00',
  K_20: '23.00',
  ...over,
});
const purchase = (over: Record<string, string> = {}) => ({
  NrDostawcy: '2222222222',
  NazwaDostawcy: 'Dostawca',
  DowodZakupu: 'F 1',
  DataZakupu: '2026-03-10',
  K_42: '100.00',
  K_43: '23.00',
  ...over,
});

describe('суми JPK', () => {
  it('рядок у гроші без float', () => {
    expect(parseJpkAmount('18560.00')).toBe(1_856_000);
    expect(parseJpkAmount('4268.8')).toBe(426_880);
    expect(parseJpkAmount('0.05')).toBe(5);
    expect(parseJpkAmount('1.15')).toBe(115);
    expect(parseJpkAmount('12')).toBe(1_200);
    expect(parseJpkAmount(' -12.30 ')).toBe(-1_230);
    expect(Object.is(parseJpkAmount('-0.00'), 0)).toBe(true);
  });
  it('не сума — помилка', () => {
    for (const bad of ['1,50', '1.234', '', 'abc', '1e5', '--1']) {
      expect(() => parseJpkAmount(bad)).toThrow(JpkParseError);
    }
  });
});

describe('розбір JPK_V7M', () => {
  it('варіант (2): заголовок, декларація й ewidencja січня', () => {
    const jpk = parseJpkV7M(january2026Jpk);
    expect(jpk).toMatchObject({ variant: 2, year: 2026, month: 1, correction: false });
    expect(jpkPeriod(jpk)).toBe('2026-01');
    expect(jpk.declaration).toEqual({
      P_19: 1_856_000,
      P_20: 426_900,
      P_37: 1_856_000,
      P_38: 426_900,
      P_42: 210_100,
      P_43: 48_300,
      P_48: 48_300,
      P_51: 378_600,
    });
    expect(jpk.sales).toEqual([
      {
        lp: 1,
        contractorTaxId: '1111111111',
        contractorName: 'Klient IT sp. z o.o.',
        number: 'FV 1/01/2026',
        issueDate: '2026-02-02',
        saleDate: '2026-01-31',
        fields: { K_19: 1_856_000, K_20: 426_880 },
      },
    ]);
    expect(jpk.purchases).toHaveLength(5);
    expect(jpk.purchases[1]).toEqual({
      lp: 2,
      contractorTaxId: '3333333333',
      contractorName: 'Opony sp. z o.o.',
      number: 'FAS/1/01/2026',
      issueDate: '2026-01-08',
      fields: { K_42: 62_927, K_43: 14_473 },
    });
    expect(jpk.ctrl).toEqual({ salesRows: 1, outputVat: 426_880, purchaseRows: 5, inputVat: 48_325 });
    expect(jpkCtrlIssues(jpk)).toEqual([]);
  });

  it('варіант (3): номер KSeF, позначки, дата отримання, країна й контрагент без номера', () => {
    const jpk = parseJpkV7M(
      jpkXml({
        month: 3,
        purpose: 2,
        sales: [
          sale({ NrKSeF: '0000000000-20260331-ABCDEF000000-01' }),
          sale({ NrKontrahenta: 'brak', DowodSprzedazy: 'FV 2', BFK: '1' }),
          { ...sale({ DowodSprzedazy: 'FV 3' }), KodKrajuNadaniaTIN: 'DE', NrKontrahenta: 'DE 123456789' },
        ],
        purchases: [purchase({ DataWplywu: '2026-04-02', DI: '1', DokumentZakupu: 'MK' })],
      }),
    );
    expect(jpk.variant).toBe(3);
    expect(jpk.correction).toBe(true);
    expect(jpk.sales[0].ksefNumber).toBe('0000000000-20260331-ABCDEF000000-01');
    expect(jpk.sales[0].marker).toBeUndefined();
    expect(jpk.sales[1]).not.toHaveProperty('contractorTaxId');
    expect(jpk.sales[1].marker).toBe('BFK');
    expect(jpk.sales[2]).toMatchObject({ contractorCountry: 'DE', contractorTaxId: 'DE123456789' });
    expect(jpk.purchases[0]).toMatchObject({ receivedDate: '2026-04-02', marker: 'DI', documentType: 'MK' });
  });

  it('файл без рядків', () => {
    const jpk = parseJpkV7M(jpkXml({ month: 4 }));
    expect(jpk.sales).toEqual([]);
    expect(jpk.purchases).toEqual([]);
    expect(jpk.declaration).toEqual({});
    expect(jpkCtrlIssues(jpk)).toEqual([]);
  });

  it('позначки й текст у декларації не стають сумами', () => {
    const jpk = parseJpkV7M(jpkXml({ declaration: { P_38: '100', P_39: '50', P_62: '7', P_540: '1', P_ORDZU: 'x' } }));
    expect(jpk.declaration).toEqual({ P_38: 10_000, P_39: 5_000, P_62: 700 });
  });

  it('інший формуляр або варіант — помилка', () => {
    expect(() => parseJpkV7M(jpkXml({ systemCode: 'JPK_V7K (3)' }))).toThrow(/JPK_V7K \(3\)/);
    expect(() => parseJpkV7M(jpkXml({ systemCode: 'JPK_V7M (1)' }))).toThrow(JpkParseError);
    expect(() => parseJpkV7M('<a>')).toThrow(JpkParseError);
    expect(() => parseJpkV7M('<Faktura/>')).toThrow(/немає JPK/);
  });

  it('пошкоджений рядок — помилка з місцем', () => {
    expect(() => parseJpkV7M(jpkXml({ purchases: [purchase({ DataZakupu: '2026-02-31' })] }))).toThrow(
      /ZakupWiersz 1: DataZakupu не дата/,
    );
    expect(() => parseJpkV7M(jpkXml({ sales: [sale({ K_19: '1,00' })] }))).toThrow(/Не сума/);
    expect(() => parseJpkV7M(jpkXml({ sales: [sale({ OFF: '1', BFK: '1' })] }))).toThrow(/кілька позначок/);
    const noNumber: Record<string, string> = sale();
    delete noNumber.DowodSprzedazy;
    expect(() => parseJpkV7M(jpkXml({ sales: [noNumber] }))).toThrow(/немає DowodSprzedazy/);
  });

  it('контрольні суми, що не сходяться з рядками', () => {
    const jpk = parseJpkV7M(
      jpkXml({
        sales: [sale()],
        purchases: [purchase()],
        salesCtrl: { LiczbaWierszySprzedazy: '2', PodatekNalezny: '23.01' },
        purchaseCtrl: { LiczbaWierszyZakupow: '0', PodatekNaliczony: '0.00' },
      }),
    );
    expect(jpkCtrlIssues(jpk)).toEqual(['salesRows', 'outputVat', 'purchaseRows', 'inputVat']);
  });

  it('faktura do paragonu (FP) не входить у PodatekNalezny', () => {
    const jpk = parseJpkV7M(
      jpkXml({
        sales: [sale(), sale({ DowodSprzedazy: 'FP 1', TypDokumentu: 'FP' })],
        salesCtrl: { LiczbaWierszySprzedazy: '2', PodatekNalezny: '23.00' },
      }),
    );
    expect(jpkCtrlIssues(jpk)).toEqual([]);
  });
});
