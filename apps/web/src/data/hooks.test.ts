import type { LedgerDocument, PeriodRecord, RestoreOp } from '@jdg/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Записи, як їх побачив би Firestore: кожен пакет — окремий масив */
const mocks = vi.hoisted(() => ({
  batches: [] as { path: string; data: unknown; merge?: boolean }[][],
  single: [] as { path: string; data: unknown; merge?: boolean }[],
}));

vi.mock('../firebase/app', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, path: string) => ({ path }),
  writeBatch: () => {
    const ops: { path: string; data: unknown; merge?: boolean }[] = [];
    return {
      set: (ref: { path: string }, data: unknown, options?: { merge?: boolean }) =>
        ops.push({ path: ref.path, data, merge: options?.merge }),
      delete: (ref: { path: string }) => ops.push({ path: ref.path, data: null }),
      commit: async () => {
        mocks.batches.push(ops);
      },
    };
  },
  setDoc: async (ref: { path: string }, data: unknown, options?: { merge?: boolean }) => {
    mocks.single.push({ path: ref.path, data, merge: options?.merge });
  },
  deleteDoc: vi.fn(),
  deleteField: () => '<delete>',
  arrayUnion: (...v: string[]) => ({ union: v }),
  arrayRemove: (...v: string[]) => ({ remove: v }),
}));

import { closePeriod, reopenPeriod, restoreBackupOps, saveDocument, saveJpkImport, syncPeriodLock } from './hooks';

const cost: LedgerDocument = {
  kind: 'cost',
  category: 'office',
  number: 'F 1',
  issueDate: '2026-03-31',
  receivedDate: '2026-04-02',
  contractor: { name: 'Firma', nip: '1111111111', country: 'PL' },
  currency: 'PLN',
  lines: [{ net: 10_000, vatRate: '23', vat: 2_300 }],
  source: 'manual',
};
const record: PeriodRecord = { status: 'closed', confirmations: {} };

beforeEach(() => {
  mocks.batches = [];
  mocks.single = [];
});

describe('документи пишуться з touchedPeriods', () => {
  it('saveDocument', async () => {
    await saveDocument('u1', 'd1', { ...cost, touchedPeriods: ['2020-01'] } as LedgerDocument);
    expect(mocks.single).toEqual([
      { path: 'users/u1/documents/d1', data: { ...cost, touchedPeriods: ['2026-03', '2026-04'] }, merge: undefined },
    ]);
  });

  it('імпорт JPK: без id у даних, з полем', async () => {
    await saveJpkImport('u1', {
      rules: {},
      overrides: {},
      documents: [{ ...cost, id: 'jpk-1' }],
      remove: [],
      references: {},
    });
    expect(mocks.batches[0]![0]).toMatchObject({
      path: 'users/u1/documents/jpk-1',
      data: { number: 'F 1', touchedPeriods: ['2026-03', '2026-04'] },
    });
    expect('id' in (mocks.batches[0]![0]!.data as object)).toBe(false);
  });
});

describe('закриття і відкриття місяця', () => {
  it('закриття: спершу поле старим документам, потім місяць і список закритих одним пакетом', async () => {
    await closePeriod('u1', '2026-03', record, [{ ...cost, id: 'old' }]);
    expect(mocks.batches).toHaveLength(2);
    expect(mocks.batches[0]).toEqual([
      expect.objectContaining({
        path: 'users/u1/documents/old',
        data: expect.objectContaining({ touchedPeriods: ['2026-03', '2026-04'] }),
      }),
    ]);
    expect(mocks.batches[1]).toEqual([
      { path: 'users/u1/periods/2026-03', data: record, merge: undefined },
      { path: 'users/u1/locks/periods', data: { closed: { union: ['2026-03'] } }, merge: true },
    ]);
  });

  it('закриття без старих документів — один пакет', async () => {
    await closePeriod('u1', '2026-03', record, []);
    expect(mocks.batches).toHaveLength(1);
  });

  it('відкриття: місяць і прибрати зі списку одним пакетом', async () => {
    await reopenPeriod('u1', '2026-03', { status: 'open', confirmations: {} });
    expect(mocks.batches).toEqual([
      [
        { path: 'users/u1/periods/2026-03', data: { status: 'open', confirmations: {} }, merge: undefined },
        { path: 'users/u1/locks/periods', data: { closed: { remove: ['2026-03'] } }, merge: true },
      ],
    ]);
  });

  it('узгодження захисту пише лише список закритих', async () => {
    await syncPeriodLock('u1', '2026-03', false, []);
    expect(mocks.batches).toEqual([]);
    expect(mocks.single).toEqual([
      { path: 'users/u1/locks/periods', data: { closed: { remove: ['2026-03'] } }, merge: true },
    ]);
  });
});

describe('відновлення з бекапу', () => {
  it('стан місяців і список закритих — окремим останнім пакетом, навіть після 500 записів', async () => {
    const fx: RestoreOp[] = Array.from({ length: 600 }, (_, i) => ({
      collection: 'fxRates',
      id: `d${i}`,
      data: { EUR: 4 },
      merge: true,
    }));
    const ops: RestoreOp[] = [
      { collection: 'documents', id: 'd', data: cost },
      ...fx,
      { collection: 'periods', id: '2026-03', data: record },
      { collection: 'locks', id: 'periods', data: { closed: ['2026-03'] } },
    ];
    await restoreBackupOps('u1', ops);
    expect(mocks.batches.map((b) => b.length)).toEqual([500, 101, 2]);
    expect(mocks.batches.at(-1)!.map((o) => o.path)).toEqual(['users/u1/periods/2026-03', 'users/u1/locks/periods']);
  });
});
