import { describe, expect, it } from 'vitest';
import type { LedgerDocument } from './document';
import { documentMonth, findSameDocuments } from './duplicates';

const cost = (over: Partial<Extract<LedgerDocument, { kind: 'cost' }>> = {}): LedgerDocument & { id: string } => ({
  id: 'a',
  kind: 'cost',
  category: 'other',
  number: '8XKEOGAB-0006',
  issueDate: '2026-10-05',
  contractor: { name: 'Anthropic, PBC', country: 'US' },
  currency: 'EUR',
  lines: [{ net: 8_000, vatRate: 'np' }],
  source: 'manual',
  ...over,
});
const key = { kind: 'cost' as const, number: '8XKEOGAB-0006', contractorName: 'Anthropic, PBC' };

describe('findSameDocuments', () => {
  it('знаходить документ з тим самим номером і контрагентом', () => {
    const docs = [cost({}), { ...cost({ number: 'ІНШИЙ' }), id: 'b' }];
    expect(findSameDocuments(key, docs).map((d) => d.id)).toEqual(['a']);
  });

  it('регістр, пробіли й обрізання не мають значення', () => {
    expect(
      findSameDocuments({ ...key, number: '  8xkeogab-0006 ', contractorName: 'anthropic,  pbc' }, [cost()]),
    ).toHaveLength(1);
  });

  it('інший контрагент з тим самим номером — не збіг', () => {
    expect(findSameDocuments({ ...key, contractorName: 'Cursor' }, [cost()])).toEqual([]);
  });

  it('NIP, якщо він є в обох, важливіший за назву', () => {
    const doc = cost({ contractor: { name: 'Стара назва', nip: '111-111-11-11', country: 'PL' } });
    expect(
      findSameDocuments({ ...key, contractorName: 'Нова назва', contractorNip: 'PL1111111111' }, [doc]),
    ).toHaveLength(1);
    expect(findSameDocuments({ ...key, contractorName: 'Стара назва', contractorNip: '2222222222' }, [doc])).toEqual(
      [],
    );
  });

  it('дохід і витрата з однаковим номером — різні документи', () => {
    expect(findSameDocuments({ ...key, kind: 'income' }, [cost()])).toEqual([]);
  });

  it('порожній номер чи назва нічого не знаходять', () => {
    expect(findSameDocuments({ ...key, number: ' ' }, [cost()])).toEqual([]);
    expect(findSameDocuments({ ...key, contractorName: '' }, [cost()])).toEqual([]);
  });

  it('внутрішні документи пропускаються', () => {
    const internal = { id: 'i', kind: 'internal', amount: 100 } as unknown as LedgerDocument & { id: string };
    expect(findSameDocuments(key, [internal])).toEqual([]);
  });
});

describe('documentMonth', () => {
  it('місяць за датою PIT', () => {
    expect(documentMonth(cost())).toBe('2026-10');
  });
});
