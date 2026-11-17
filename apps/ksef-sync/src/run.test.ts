import { describe, expect, it } from 'vitest';
import type { LastRun } from './firestore';
import { runOnce, summarize, type RunDeps } from './run';
import { createTestIdentity } from './selfSigned';
import { loadIdentity } from './xades';

const id = createTestIdentity({ nip: '5265877635' });
const identity = loadIdentity(id.certificatePem, id.privateKeyPem);
const NOW = new Date('2026-10-29T10:00:00Z');

function deps(overrides: Partial<RunDeps['client']> = {}) {
  const runs: LastRun[] = [];
  const calls: string[] = [];
  const d: RunDeps = {
    client: {
      authenticate: async () => {
        calls.push('auth');
      },
      logout: async () => {
        calls.push('logout');
      },
      queryMetadata: async () => ({
        hasMore: false,
        isTruncated: false,
        permanentStorageHwmDate: '2026-10-29T09:00:00Z',
        invoices: [],
      }),
      invoiceXml: async () => Buffer.from(''),
      ...overrides,
    },
    store: {
      loadState: async () => ({}),
      saveState: async () => {},
      existing: async () => new Set(),
      add: async () => true,
      vendorRules: async () => ({}),
      saveLastRun: async (r) => {
        runs.push(r);
      },
    },
    identity,
    nip: '5265877635',
    startFrom: '2026-10-01T00:00:00Z',
    env: 'test',
    now: () => NOW,
  };
  return { d, runs, calls };
}

describe('runOnce', () => {
  it('logs in, syncs both roles, logs out and records the run', async () => {
    const { d, runs, calls } = deps();
    const run = await runOnce(d);
    expect(run).toMatchObject({
      ok: true,
      at: NOW.toISOString(),
      summary: 'витрати: нових 0 з 0; доходи: нових 0 з 0',
    });
    expect(runs).toEqual([run]);
    expect(calls).toEqual(['auth', 'logout']);
  });

  it('records the failure and still logs out', async () => {
    const { d, runs, calls } = deps({
      queryMetadata: async () => {
        throw new Error('KSeF 503 /invoices/query/metadata');
      },
    });
    const run = await runOnce(d);
    expect(run).toEqual({ at: NOW.toISOString(), ok: false, summary: 'Error: KSeF 503 /invoices/query/metadata' });
    expect(runs).toEqual([run]);
    expect(calls).toEqual(['auth', 'logout']);
  });

  it('records a failed login without trying to log out', async () => {
    const { d, calls } = deps({
      authenticate: async () => {
        throw new Error('460 certyfikat');
      },
    });
    const logs: string[] = [];
    d.log = (m) => logs.push(m);
    expect(await runOnce(d)).toMatchObject({ ok: false, summary: 'Error: 460 certyfikat' });
    expect(calls).toEqual([]);
    expect(logs).toEqual(['KSeF test: помилка синхронізації: Error: 460 certyfikat']);
  });

  it('keeps the sync error when logging out fails too', async () => {
    const { d } = deps({
      queryMetadata: async () => {
        throw new Error('KSeF 400 /invoices/query/metadata');
      },
      logout: async () => {
        throw new Error('401');
      },
    });
    const logs: string[] = [];
    d.log = (m) => logs.push(m);
    expect(await runOnce(d)).toMatchObject({ ok: false, summary: 'Error: KSeF 400 /invoices/query/metadata' });
    expect(logs).toContain('Вихід з KSeF: 401');
  });
});

describe('summarize', () => {
  it('mentions unparsed invoices and hash mismatches', () => {
    expect(
      summarize([
        { role: 'cost', from: 'a', to: 'b', found: 3, added: 2, hashMismatch: ['x'], unparsed: ['y', 'z'] },
        { role: 'income', from: 'a', to: 'b', found: 1, added: 1, hashMismatch: [], unparsed: [] },
      ]),
    ).toBe('витрати: нових 2 з 3 (не розібрано 2, хеш не збігся 1); доходи: нових 1 з 1');
  });
});
