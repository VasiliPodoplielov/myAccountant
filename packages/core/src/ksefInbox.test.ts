import { describe, expect, it } from 'vitest';
import {
  KSEF_ITEM_LIMIT_BYTES,
  ksefAmount,
  ksefInboxItem,
  utf8Length,
  warsawDate,
  type KsefInvoiceRef,
} from './ksefInbox';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/">
  <Naglowek><KodFormularza kodSystemowy="FA (3)" wersjaSchemy="1-0E">FA</KodFormularza><WariantFormularza>3</WariantFormularza></Naglowek>
  <Podmiot1><DaneIdentyfikacyjne><NIP>7770000000</NIP><Nazwa>Stacja Paliw</Nazwa></DaneIdentyfikacyjne><Adres><KodKraju>PL</KodKraju><AdresL1>ul. Drogowa 2</AdresL1></Adres></Podmiot1>
  <Podmiot2><DaneIdentyfikacyjne><NIP>5260000000</NIP><Nazwa>Jan Testowy</Nazwa></DaneIdentyfikacyjne><JST>2</JST><GV>2</GV></Podmiot2>
  <Fa><KodWaluty>PLN</KodWaluty><P_1>2026-03-31</P_1><P_2>F/1/26</P_2><P_13_1>100.00</P_13_1><P_14_1>23.00</P_14_1><P_15>123.00</P_15>
    <Adnotacje><P_16>2</P_16><P_17>2</P_17><P_18>2</P_18><P_18A>2</P_18A></Adnotacje><RodzajFaktury>VAT</RodzajFaktury></Fa>
</Faktura>`;

const REF: KsefInvoiceRef = {
  ksefNumber: '7770000000-20260331-0A1B2C3D4E5F-AB',
  invoiceNumber: 'F/1/26',
  issueDate: '2026-03-31',
  acquisitionDate: '2026-03-31T22:30:00+00:00',
  permanentStorageDate: '2026-03-31T22:30:05+00:00',
  invoiceHash: 'aGFzaA==',
  sellerNip: '7770000000',
  sellerName: 'Stacja Paliw',
  buyerName: 'Jan Testowy',
  currency: 'PLN',
  gross: 12300,
  formCode: 'FA',
  invoiceType: 'Vat',
};

const NOW = '2026-04-01T03:00:00.000Z';

describe('ksefInboxItem', () => {
  it('builds a new cost item with parsed invoice, document lines and the vendor category', () => {
    const item = ksefInboxItem(REF, 'cost', XML, { '7770000000': { category: 'carMixed' } }, NOW);
    expect(item).toMatchObject({
      ...REF,
      role: 'cost',
      status: 'new',
      receivedDate: '2026-04-01',
      lines: [{ net: 10000, vatRate: '23', vat: 2300 }],
      suggestedCategory: 'carMixed',
      xml: XML,
      syncedAt: NOW,
    });
    expect(item.invoice?.seller.name).toBe('Stacja Paliw');
    expect(item).not.toHaveProperty('issues');
    expect(item).not.toHaveProperty('parseError');
    expect(item).not.toHaveProperty('suggestedPeriodicSettlement');
  });

  it('suggests periodic settlement for income from the client rule, never a cost category', () => {
    const rules = { '5260000000': { category: 'office' as const, periodicSettlement: true } };
    const item = ksefInboxItem(REF, 'income', XML, rules, NOW);
    expect(item.suggestedPeriodicSettlement).toBe(true);
    expect(item).not.toHaveProperty('suggestedCategory');
  });

  it('keeps an unparsable invoice with the error and the XML', () => {
    const fa2 = XML.replace('FA (3)', 'FA (2)');
    const item = ksefInboxItem(REF, 'cost', fa2, { '7770000000': { category: 'office' } }, NOW);
    expect(item.parseError).toMatch(/FA \(2\)/);
    expect(item.xml).toBe(fa2);
    expect(item).not.toHaveProperty('invoice');
    expect(item).not.toHaveProperty('lines');
    // без розбору ключ правила — NIP продавця з метаданих
    expect(item.suggestedCategory).toBe('office');
  });

  it('records issues the ledger cannot model', () => {
    const gbp = XML.replace('<KodWaluty>PLN', '<KodWaluty>GBP');
    expect(ksefInboxItem({ ...REF, currency: 'GBP' }, 'cost', gbp, {}, NOW).issues).toEqual([
      { code: 'currency', detail: 'GBP' },
    ]);
  });

  it('omits XML that would not fit a Firestore document', () => {
    const big = XML.replace('<Fa>', `<Fa><!--${'x'.repeat(KSEF_ITEM_LIMIT_BYTES)}-->`);
    const item = ksefInboxItem(REF, 'cost', big, {}, NOW);
    expect(item.xmlOmitted).toBe(true);
    expect(item).not.toHaveProperty('xml');
    expect(item).not.toHaveProperty('linesOmitted');
    expect(item.invoice?.number).toBe('F/1/26');
  });

  it('drops invoice lines too when the parsed invoice alone is too large, keeping the sums', () => {
    const line = (n: number) =>
      `<FaWiersz><NrWierszaFa>${n}</NrWierszaFa><P_7>${'Pozycja '.repeat(20)}</P_7><P_11>0.01</P_11><P_12>23</P_12></FaWiersz>`;
    const rows = Array.from({ length: 6000 }, (_, i) => line(i + 1)).join('');
    const huge = XML.replace('</RodzajFaktury>', `</RodzajFaktury>${rows}`);
    const item = ksefInboxItem(REF, 'cost', huge, {}, NOW);
    expect(item).toMatchObject({ xmlOmitted: true, linesOmitted: true });
    expect(item.invoice?.lines).toEqual([]);
    expect(item.lines).toEqual([{ net: 10000, vatRate: '23', vat: 2300 }]);
    expect(utf8Length(JSON.stringify(item))).toBeLessThanOrEqual(KSEF_ITEM_LIMIT_BYTES);
  });

  it('keeps an ordinary invoice whole', () => {
    const item = ksefInboxItem(REF, 'cost', XML, {}, NOW);
    expect(item).not.toHaveProperty('xmlOmitted');
    expect(item).not.toHaveProperty('linesOmitted');
  });
});

describe('helpers', () => {
  it('converts KSeF instants to the Polish calendar date across DST', () => {
    expect(warsawDate('2026-03-31T22:30:00Z')).toBe('2026-04-01'); // CEST, UTC+2
    expect(warsawDate('2026-01-31T22:59:59Z')).toBe('2026-01-31'); // CET, UTC+1
    expect(warsawDate('2026-01-31T23:00:00Z')).toBe('2026-02-01');
    expect(warsawDate('2026-12-31T23:30:00+00:00')).toBe('2027-01-01');
    expect(() => warsawDate('wczoraj')).toThrow(RangeError);
  });

  it('counts UTF-8 bytes', () => {
    expect(utf8Length('')).toBe(0);
    expect(utf8Length('abc')).toBe(3);
    expect(utf8Length('ąę')).toBe(4);
    expect(utf8Length('€')).toBe(3);
    expect(utf8Length('😀')).toBe(4);
  });

  it('rounds metadata amounts to grosze', () => {
    expect(ksefAmount(177.54)).toBe(17754);
    expect(ksefAmount(0.1 + 0.2)).toBe(30);
    expect(ksefAmount(-24.6)).toBe(-2460);
    expect(ksefAmount(0)).toBe(0);
  });
});
