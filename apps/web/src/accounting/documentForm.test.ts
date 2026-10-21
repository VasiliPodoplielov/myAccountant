import { valueDocument } from '@jdg/core';
import { describe, expect, it } from 'vitest';
import {
  applyPreset,
  emptyForm,
  fromDocumentForm,
  fxRange,
  isReverseCharge,
  PRESETS,
  switchKind,
  type DocumentForm,
} from './documentForm';

const preset = (id: string) => PRESETS.find((p) => p.id === id)!;

const filled = (patch: Partial<DocumentForm>): DocumentForm => ({
  ...emptyForm('2026-10-20'),
  number: 'FV 1/10/2026',
  contractorName: 'Test Sp. z o.o.',
  net: 100,
  ...patch,
});

describe('швидкі кнопки', () => {
  it('«Паливо»: авто мішане, PLN, 23%', () => {
    const f = applyPreset(emptyForm('2026-10-20'), preset('fuel'));
    expect(f).toMatchObject({ kind: 'cost', category: 'carMixed', currency: 'PLN', vatRate: '23' });
  });
  it('«Claude (EUR)»: Anthropic, PBC, EUR, «Інше» зі ставкою np (gross без відліку VAT)', () => {
    const f = applyPreset(emptyForm('2026-10-20'), preset('claude'));
    expect(f).toMatchObject({
      kind: 'cost',
      category: 'other',
      currency: 'EUR',
      country: 'US',
      vatRate: 'np',
      contractorName: 'Anthropic, PBC',
    });
    expect(isReverseCharge(f)).toBe(false);
  });
  it('«Claude (EUR)» не залишає номер і суму: їх вводять вручну', () => {
    const f = applyPreset(emptyForm('2026-10-20'), preset('claude'));
    expect(f).toMatchObject({ number: '', net: '' });
  });
  it('«Офіс»: office, PLN', () => {
    expect(applyPreset(emptyForm('2026-10-20'), preset('office'))).toMatchObject({
      category: 'office',
      currency: 'PLN',
    });
  });
  it('Claude (EUR): gross як netto зі ставкою np — koszt за курсом без VAT у реєстрах', () => {
    const f = applyPreset(filled({ issueDate: '2026-05-05', net: 22.14 }), preset('claude'));
    const r = fromDocumentForm(f);
    if (!r.ok) throw new Error(r.error);
    const value = valueDocument(r.doc as never, { EUR: { '2026-05-04': 4.2544 } });
    // 22,14 EUR × 4,2544 = 94,19 zł; VAT немає
    expect(value).toMatchObject({ netPit: 9_419, vat: 0, vatDeductible: 0, pitAmount: 9_419 });
  });
  it('пресет не стирає введені номер, дату й суму', () => {
    const f = applyPreset(filled({ issueDate: '2026-09-03', net: 55.5 }), preset('fuel'));
    expect(f).toMatchObject({ number: 'FV 1/10/2026', issueDate: '2026-09-03', net: 55.5 });
  });
  it('перехід від Claude до «Офіс» повертає польського контрагента', () => {
    const f = applyPreset(applyPreset(emptyForm('2026-10-20'), preset('claude')), preset('office'));
    expect(f).toMatchObject({ currency: 'PLN', country: 'PL' });
  });
});

describe('вид документа', () => {
  it('перемикання на дохід скидає категорію витрати', () => {
    const f = switchKind(applyPreset(emptyForm('2026-10-20'), preset('fuel')), 'income');
    expect(f).toMatchObject({ kind: 'income', category: 'other' });
  });
  it('той самий вид нічого не змінює', () => {
    const f = emptyForm('2026-10-20');
    expect(switchKind(f, 'cost')).toBe(f);
  });
});

describe('форма → документ', () => {
  it('витрата в PLN з VAT з фактури', () => {
    const r = fromDocumentForm(filled({ net: 100, vat: 23, category: 'office' }));
    expect(r).toEqual({
      ok: true,
      doc: {
        kind: 'cost',
        category: 'office',
        number: 'FV 1/10/2026',
        issueDate: '2026-10-20',
        source: 'manual',
        contractor: { name: 'Test Sp. z o.o.', country: 'PL' },
        lines: [{ net: 10_000, vatRate: '23', vat: 2_300 }],
        currency: 'PLN',
      },
    });
  });
  it('без VAT у формі позиція не має поля vat: рахується від ставки', () => {
    const r = fromDocumentForm(filled({ vat: '' }));
    expect(r).toMatchObject({ ok: true, doc: { lines: [{ net: 10_000, vatRate: '23' }] } });
    expect(r.ok && 'vat' in (r.doc as { lines: object[] }).lines[0]!).toBe(false);
  });
  it('необов’язкові поля потрапляють в документ лише заповнені, NIP очищений', () => {
    const r = fromDocumentForm(
      filled({ contractorNip: '123-456 32-18', description: ' Paliwo ', ksefNumber: ' ', saleDate: '2026-10-18' }),
    );
    if (!r.ok) throw new Error(r.error);
    expect(r.doc).toMatchObject({ contractor: { nip: '1234563218' }, description: 'Paliwo', saleDate: '2026-10-18' });
    expect(r.doc).not.toHaveProperty('ksefNumber');
    expect(r.doc).not.toHaveProperty('paidAt');
    expect(r.doc).not.toHaveProperty('periodicSettlement');
  });
  it('код країни приводиться до верхнього регістру', () => {
    expect(fromDocumentForm(filled({ country: ' ie ' }))).toMatchObject({
      ok: true,
      doc: { contractor: { country: 'IE' } },
    });
  });
  it('import usług: VAT з форми ігнорується, його рахує платник', () => {
    const f: DocumentForm = {
      ...filled({ net: 20, vat: 4.6 }),
      category: 'importServices',
      currency: 'EUR',
      country: 'IE',
      vatRate: '23',
    };
    const r = fromDocumentForm({ ...f, vat: 4.6 });
    if (!r.ok) throw new Error(r.error);
    expect(r.doc).toMatchObject({ currency: 'EUR', lines: [{ net: 2_000, vatRate: '23' }] });
    const value = valueDocument(r.doc as never, { EUR: { '2026-10-19': 4.25 } });
    // netto 20 EUR × 4,25 = 85,00 zł; VAT 23% = 19,55 zł, одночасно należny і naliczony
    expect(value).toMatchObject({ netPit: 8_500, vat: 1_955, vatDeductible: 1_955, pitAmount: 8_500 });
  });
  it('дохід з розрахунковим періодом вимагає дати продажу', () => {
    const base = { kind: 'income' as const, periodicSettlement: true };
    expect(fromDocumentForm(filled(base))).toMatchObject({ ok: false, error: expect.stringMatching(/період/) });
    expect(fromDocumentForm(filled({ ...base, saleDate: '2026-10-31' }))).toMatchObject({
      ok: true,
      doc: { kind: 'income', periodicSettlement: true, saleDate: '2026-10-31' },
    });
  });
  it('сума з копійками береться точно, без float', () => {
    expect(fromDocumentForm(filled({ net: 1.005 }))).toMatchObject({ ok: true, doc: { lines: [{ net: 101 }] } });
  });

  describe('помилки', () => {
    const error = (patch: Partial<DocumentForm>) => {
      const r = fromDocumentForm(filled(patch));
      return r.ok ? null : r.error;
    };
    it('порожня, нульова й від’ємна сума', () => {
      expect(error({ net: '' })).toMatch(/netto/);
      expect(error({ net: 0 })).toMatch(/нульовою/);
      expect(error({ net: -5 })).toMatch(/від'ємною/);
    });
    it('від’ємний VAT', () => {
      expect(error({ vat: -1 })).toMatch(/VAT/);
    });
    it('порожній номер і контрагент', () => {
      expect(error({ number: '  ' })).toMatch(/номер/);
      expect(error({ contractorName: '' })).toMatch(/контрагента/);
    });
    it('код країни не з двох літер', () => {
      expect(error({ country: 'POL' })).toMatch(/країни/);
    });
    it('неіснуючі дати', () => {
      expect(error({ issueDate: '2026-02-31' })).toMatch(/дата виставлення/);
      expect(error({ issueDate: '' })).toMatch(/дата виставлення/);
      expect(error({ saleDate: '31.10.2026' })).toMatch(/дата продажу/);
      expect(error({ paidAt: '2026-13-01' })).toMatch(/дата оплати/);
    });
    it('VAT на ставці без VAT', () => {
      expect(error({ vatRate: 'zw', vat: 5 })).toMatch(/нуль/);
    });
    it('import usług від польського контрагента', () => {
      expect(error({ category: 'importServices', country: 'PL' })).toMatch(/Import/);
    });
  });
});

describe('період курсів NBP', () => {
  const range = (patch: Partial<DocumentForm>) => {
    const r = fromDocumentForm(filled(patch));
    if (!r.ok) throw new Error(r.error);
    return fxRange(r.doc);
  };

  it('PLN курсів не потребує', () => {
    expect(range({})).toBeNull();
  });
  it('EUR: від запасу перед датою події до дати виставлення', () => {
    const f = applyPreset(filled({ issueDate: '2026-10-20' }), preset('claude'));
    expect(range(f)).toEqual({ from: '2026-10-06', to: '2026-10-20' });
  });
  it('запас перетинає межу року', () => {
    const f = applyPreset(filled({ issueDate: '2026-01-02' }), preset('claude'));
    expect(range(f)).toEqual({ from: '2025-12-19', to: '2026-01-02' });
  });
  it('оплата пізніше дати виставлення розширює період', () => {
    const f = applyPreset(filled({ issueDate: '2026-10-01', paidAt: '2026-10-20' }), preset('claude'));
    expect(range(f)).toEqual({ from: '2026-09-17', to: '2026-10-20' });
  });
  it('дата продажу раніше фактури зсуває початок', () => {
    const f = applyPreset(filled({ issueDate: '2026-10-20', saleDate: '2026-10-02' }), preset('claude'));
    expect(range(f)).toEqual({ from: '2026-09-18', to: '2026-10-20' });
  });
});
