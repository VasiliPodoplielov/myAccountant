import { createHash } from 'node:crypto';
import type { ContractorRules, KsefInboxItem, KsefRole } from '@jdg/core';
import { describe, expect, it } from 'vitest';
import type { InvoiceMetadata, InvoiceQueryFilters, QueryInvoicesMetadataResponse } from './api';
import {
  decodeXml,
  invoiceRef,
  syncKsef,
  SyncError,
  type SyncPoint,
  type SyncSource,
  type SyncState,
  type SyncStore,
} from './sync';

const xmlFor = (number: string, sellerNip = '7770000000') => `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/">
  <Naglowek><KodFormularza kodSystemowy="FA (3)" wersjaSchemy="1-0E">FA</KodFormularza><WariantFormularza>3</WariantFormularza></Naglowek>
  <Podmiot1><DaneIdentyfikacyjne><NIP>${sellerNip}</NIP><Nazwa>Sprzedawca</Nazwa></DaneIdentyfikacyjne><Adres><KodKraju>PL</KodKraju><AdresL1>ul. A 1</AdresL1></Adres></Podmiot1>
  <Podmiot2><DaneIdentyfikacyjne><NIP>5260000000</NIP><Nazwa>Nabywca</Nazwa></DaneIdentyfikacyjne><JST>2</JST><GV>2</GV></Podmiot2>
  <Fa><KodWaluty>PLN</KodWaluty><P_1>2026-03-02</P_1><P_2>${number}</P_2><P_13_1>10.00</P_13_1><P_14_1>2.30</P_14_1><P_15>12.30</P_15>
  <Adnotacje><P_16>2</P_16><P_17>2</P_17><P_18>2</P_18><P_18A>2</P_18A></Adnotacje><RodzajFaktury>VAT</RodzajFaktury></Fa>
</Faktura>`;

const hash = (s: string) => createHash('sha256').update(Buffer.from(s, 'utf8')).digest('base64');

interface FakeInvoice {
  meta: InvoiceMetadata;
  subject: 'Subject1' | 'Subject2';
  xml: string;
}

function invoice(n: number, stored: string, subject: 'Subject1' | 'Subject2' = 'Subject2'): FakeInvoice {
  const number = `F/${n}`;
  const xml = xmlFor(number);
  return {
    subject,
    xml,
    meta: {
      ksefNumber: `7770000000-20260302-${String(n).padStart(12, '0')}-AB`,
      invoiceNumber: number,
      issueDate: '2026-03-02',
      invoicingDate: stored,
      acquisitionDate: stored,
      permanentStorageDate: stored,
      seller: { nip: '7770000000', name: 'Sprzedawca' },
      buyer: { identifier: { type: 'Nip', value: '5260000000' }, name: 'Nabywca' },
      netAmount: 10,
      grossAmount: 12.3,
      vatAmount: 2.3,
      currency: 'PLN',
      invoicingMode: 'Online',
      invoiceType: 'Vat',
      formCode: { systemCode: 'FA (3)', schemaVersion: '1-0E', value: 'FA' },
      isSelfInvoicing: false,
      hasAttachment: false,
      invoiceHash: hash(xml),
    },
  };
}

/** KSeF у пам'яті: фільтр за PermanentStorage, обмеження HWM, сторінки, обрізання після maxRecords */
class FakeKsef implements SyncSource {
  queries: { filters: InvoiceQueryFilters; pageOffset: number }[] = [];
  fetched: string[] = [];
  constructor(
    public invoices: FakeInvoice[],
    public hwm: string | undefined,
    private readonly maxRecords = 10_000,
  ) {}

  async queryMetadata(filters: InvoiceQueryFilters, page: { pageOffset: number; pageSize: number }) {
    this.queries.push({ filters, pageOffset: page.pageOffset });
    const { from, to } = filters.dateRange;
    const ends = [to, filters.dateRange.restrictToPermanentStorageHwmDate ? this.hwm : undefined].filter(
      (x): x is string => x !== undefined,
    );
    const end = ends.length ? Math.min(...ends.map(Date.parse)) : Infinity;
    const all = this.invoices
      .filter((i) => i.subject === filters.subjectType)
      .filter((i) => {
        const t = Date.parse(i.meta.permanentStorageDate);
        return t >= Date.parse(from) && t <= end;
      })
      .sort((a, b) => Date.parse(a.meta.permanentStorageDate) - Date.parse(b.meta.permanentStorageDate));
    const limited = all.slice(0, this.maxRecords);
    const pageEnd = (page.pageOffset + 1) * page.pageSize;
    const pageItems = limited.slice(page.pageOffset * page.pageSize, pageEnd);
    const truncated = all.length > limited.length && pageEnd >= limited.length;
    const res: QueryInvoicesMetadataResponse = {
      hasMore: pageEnd < limited.length || truncated,
      isTruncated: truncated,
      permanentStorageHwmDate: to && this.hwm && Date.parse(to) < Date.parse(this.hwm) ? to : this.hwm,
      invoices: pageItems.map((i) => i.meta),
    };
    return res;
  }

  async invoiceXml(ksefNumber: string) {
    this.fetched.push(ksefNumber);
    const inv = this.invoices.find((i) => i.meta.ksefNumber === ksefNumber);
    if (!inv) throw new Error('404');
    return Buffer.from(inv.xml, 'utf8');
  }
}

class MemoryStore implements SyncStore {
  items = new Map<string, KsefInboxItem>();
  state: SyncState = {};
  saved: [KsefRole, SyncPoint][] = [];
  constructor(public rules: ContractorRules = {}) {}
  async loadState() {
    return { ...this.state };
  }
  async saveState(role: KsefRole, point: SyncPoint) {
    this.state[role] = point;
    this.saved.push([role, point]);
  }
  async existing(numbers: string[]) {
    return new Set(numbers.filter((n) => this.items.has(n)));
  }
  async add(item: KsefInboxItem) {
    if (this.items.has(item.ksefNumber)) return false;
    this.items.set(item.ksefNumber, item);
    return true;
  }
  async vendorRules() {
    return this.rules;
  }
}

const NOW = new Date('2026-10-29T10:00:00Z');
const now = () => NOW;

describe('syncKsef', () => {
  it('writes new cost and income invoices and continues from the HWM', async () => {
    const ksef = new FakeKsef(
      [
        invoice(1, '2026-10-01T08:00:00Z'),
        invoice(2, '2026-10-02T08:00:00Z', 'Subject1'),
        invoice(3, '2026-10-29T09:59:00Z'), // після HWM: з'явиться в наступному запуску
      ],
      '2026-10-29T09:55:00Z',
    );
    const store = new MemoryStore({ '7770000000': { category: 'office' } });
    const reports = await syncKsef(ksef, store, { startFrom: '2026-09-30T22:00:00Z', now });

    expect(reports).toEqual([
      {
        role: 'cost',
        from: '2026-09-30T22:00:00Z',
        to: '2026-10-29T09:55:00Z',
        found: 1,
        added: 1,
        hashMismatch: [],
        unparsed: [],
      },
      {
        role: 'income',
        from: '2026-09-30T22:00:00Z',
        to: '2026-10-29T09:55:00Z',
        found: 1,
        added: 1,
        hashMismatch: [],
        unparsed: [],
      },
    ]);
    const cost = store.items.get(ksef.invoices[0]!.meta.ksefNumber)!;
    expect(cost).toMatchObject({
      role: 'cost',
      status: 'new',
      suggestedCategory: 'office',
      receivedDate: '2026-10-01',
    });
    expect(cost.lines).toEqual([{ net: 1000, vatRate: '23', vat: 230 }]);
    expect(store.items.get(ksef.invoices[1]!.meta.ksefNumber)?.role).toBe('income');
    expect(store.state.cost?.from).toBe('2026-10-29T09:55:00Z');

    // запит: PermanentStorage, обмеження HWM, без кінця для свіжого вікна
    expect(ksef.queries[0]!.filters).toEqual({
      subjectType: 'Subject2',
      dateRange: {
        dateType: 'PermanentStorage',
        from: '2026-09-30T22:00:00Z',
        to: undefined,
        restrictToPermanentStorageHwmDate: true,
      },
    });

    // наступний запуск: HWM пішов далі — лише нова фактура
    ksef.hwm = '2026-10-30T10:00:00Z';
    ksef.fetched = [];
    const next = await syncKsef(ksef, store, {
      startFrom: '2026-01-01T00:00:00Z',
      now: () => new Date('2026-10-30T11:00:00Z'),
    });
    expect(next[0]).toMatchObject({ from: '2026-10-29T09:55:00Z', found: 1, added: 1 });
    expect(ksef.fetched).toEqual([ksef.invoices[2]!.meta.ksefNumber]);
  });

  it('does not refetch or overwrite invoices already in the inbox', async () => {
    const ksef = new FakeKsef([invoice(1, '2026-10-01T08:00:00Z')], '2026-10-29T09:00:00Z');
    const store = new MemoryStore();
    await syncKsef(ksef, store, { startFrom: '2026-09-30T00:00:00Z', now, roles: ['cost'] });
    const number = ksef.invoices[0]!.meta.ksefNumber;
    store.items.set(number, { ...store.items.get(number)!, status: 'accepted' });
    store.state = {}; // точку втрачено: вікно повторюється
    ksef.fetched = [];

    const [r] = await syncKsef(ksef, store, { startFrom: '2026-09-30T00:00:00Z', now, roles: ['cost'] });
    expect(r).toMatchObject({ found: 1, added: 0 });
    expect(ksef.fetched).toEqual([]);
    expect(store.items.get(number)?.status).toBe('accepted');
  });

  it('walks old periods in adjacent windows of at most 90 days', async () => {
    const ksef = new FakeKsef(
      [invoice(1, '2026-02-10T08:00:00Z'), invoice(2, '2026-06-15T08:00:00Z'), invoice(3, '2026-10-20T08:00:00Z')],
      '2026-10-29T09:00:00Z',
    );
    const store = new MemoryStore();
    const [r] = await syncKsef(ksef, store, { startFrom: '2026-01-31T23:00:00Z', now, roles: ['cost'] });
    expect(r).toMatchObject({ found: 3, added: 3, to: '2026-10-29T09:00:00Z' });
    const ranges = ksef.queries.map((q) => [q.filters.dateRange.from, q.filters.dateRange.to]);
    expect(ranges).toEqual([
      ['2026-01-31T23:00:00Z', '2026-05-01T23:00:00Z'],
      ['2026-05-01T23:00:00Z', '2026-07-30T23:00:00Z'],
      ['2026-07-30T23:00:00Z', '2026-10-28T23:00:00Z'],
      ['2026-10-28T23:00:00Z', undefined],
    ]);
    // точка після кожного вікна: збій у пізнішому вікні не повторює попередні
    expect(store.saved.map(([, p]) => p.from)).toEqual([
      '2026-05-01T23:00:00Z',
      '2026-07-30T23:00:00Z',
      '2026-10-28T23:00:00Z',
      '2026-10-29T09:00:00Z',
    ]);
  });

  it('pages through results and restarts after a truncated answer without losing invoices', async () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      invoice(i + 1, new Date(Date.parse('2026-10-01T00:00:00Z') + i * 60_000).toISOString()),
    );
    const ksef = new FakeKsef(many, '2026-10-29T09:00:00Z', 12);
    const store = new MemoryStore();
    const [r] = await syncKsef(ksef, store, { startFrom: '2026-09-30T00:00:00Z', now, roles: ['cost'], pageSize: 5 });
    expect(r).toMatchObject({ found: 25, added: 25 });
    expect(store.items.size).toBe(25);
    // після обрізання — новий запит від дати останнього запису, сторінка 0
    const restarts = ksef.queries.filter((q) => q.pageOffset === 0).map((q) => q.filters.dateRange.from);
    expect(restarts[0]).toBe('2026-09-30T00:00:00Z');
    expect(restarts.length).toBeGreaterThan(1);
  });

  it('keeps an invoice whose hash differs, flagged, and an unparsable one with the error', async () => {
    const bad = invoice(1, '2026-10-01T08:00:00Z');
    bad.meta.invoiceHash = 'AAAA';
    const fa2 = invoice(2, '2026-10-02T08:00:00Z');
    fa2.xml = fa2.xml.replace('FA (3)', 'FA (2)');
    fa2.meta.invoiceHash = hash(fa2.xml);
    const ksef = new FakeKsef([bad, fa2], '2026-10-29T09:00:00Z');
    const store = new MemoryStore();
    const logs: string[] = [];
    const [r] = await syncKsef(ksef, store, {
      startFrom: '2026-09-30T00:00:00Z',
      now,
      roles: ['cost'],
      log: (m) => logs.push(m),
    });
    expect(r!.hashMismatch).toEqual([bad.meta.ksefNumber]);
    expect(r!.unparsed).toEqual([fa2.meta.ksefNumber]);
    expect(store.items.get(bad.meta.ksefNumber)?.hashMismatch).toBe(true);
    expect(store.items.get(fa2.meta.ksefNumber)?.parseError).toMatch(/FA \(2\)/);
    expect(logs.join('\n')).toContain(bad.meta.ksefNumber);
  });

  it('does not move the continuation point when a fetch fails', async () => {
    const ksef = new FakeKsef([invoice(1, '2026-10-01T08:00:00Z')], '2026-10-29T09:00:00Z');
    ksef.invoiceXml = async () => {
      throw new Error('KSeF 500');
    };
    const store = new MemoryStore();
    await expect(syncKsef(ksef, store, { startFrom: '2026-09-30T00:00:00Z', now })).rejects.toThrow('KSeF 500');
    expect(store.state).toEqual({});
  });

  it('fails loudly when KSeF returns no HWM or bad options are given', async () => {
    const store = new MemoryStore();
    await expect(
      syncKsef(new FakeKsef([], undefined), store, { startFrom: '2026-10-01T00:00:00Z', now }),
    ).rejects.toThrow(/permanentStorageHwmDate/);
    await expect(syncKsef(new FakeKsef([], 'x'), store, { startFrom: 'вчора', now })).rejects.toThrow(SyncError);
    await expect(
      syncKsef(new FakeKsef([], '2026-10-29T09:00:00Z'), store, {
        startFrom: '2026-10-01T00:00:00Z',
        now,
        windowDays: 101,
      }),
    ).rejects.toThrow(/100/);
  });

  it('does nothing and keeps the point when there is nothing new', async () => {
    const ksef = new FakeKsef([], '2026-10-01T00:00:00Z');
    const store = new MemoryStore();
    store.state.cost = { from: '2026-10-01T00:00:00Z', updatedAt: 'x' };
    const [r] = await syncKsef(ksef, store, { startFrom: '2026-01-01T00:00:00Z', now, roles: ['cost'] });
    expect(r).toMatchObject({ found: 0, added: 0, from: '2026-10-01T00:00:00Z', to: '2026-10-01T00:00:00Z' });
    expect(store.saved).toEqual([]);
  });
});

describe('helpers', () => {
  it('maps metadata to an inbox reference', () => {
    const m = invoice(7, '2026-10-01T08:00:00Z').meta;
    expect(invoiceRef(m)).toEqual({
      ksefNumber: m.ksefNumber,
      invoiceNumber: 'F/7',
      issueDate: '2026-03-02',
      acquisitionDate: '2026-10-01T08:00:00Z',
      permanentStorageDate: '2026-10-01T08:00:00Z',
      invoiceHash: m.invoiceHash,
      sellerNip: '7770000000',
      sellerName: 'Sprzedawca',
      buyerName: 'Nabywca',
      currency: 'PLN',
      gross: 1230,
      formCode: 'FA',
      invoiceType: 'Vat',
    });
    expect(invoiceRef({ ...m, seller: { nip: '1' }, buyer: { identifier: { type: 'None' } } })).not.toHaveProperty(
      'sellerName',
    );
  });

  it('strips a UTF-8 BOM', () => {
    expect(decodeXml(Buffer.from('﻿<a/>', 'utf8'))).toBe('<a/>');
    expect(decodeXml(Buffer.from('<ą/>', 'utf8'))).toBe('<ą/>');
  });
});
