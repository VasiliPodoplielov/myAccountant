import { describe, expect, it } from 'vitest';
import { FaParseError, faDocumentLines, parseFa3, type FaInvoice } from './fa';

// Вигадані дані за структурою офіційного шаблону FA(3) (ksef-client-csharp, invoice-template-fa-3.xml)
interface Opts {
  header?: string;
  buyer?: string;
  fa?: string;
}

const HEADER = `<Naglowek>
    <KodFormularza kodSystemowy="FA (3)" wersjaSchemy="1-0E">FA</KodFormularza>
    <WariantFormularza>3</WariantFormularza>
    <DataWytworzeniaFa>2026-03-02T10:00:00Z</DataWytworzeniaFa>
  </Naglowek>`;

const BUYER = `<Podmiot2>
    <DaneIdentyfikacyjne><NIP>5260000000</NIP><Nazwa>Jan Testowy</Nazwa></DaneIdentyfikacyjne>
    <Adres><KodKraju>PL</KodKraju><AdresL1>ul. Polna 1</AdresL1></Adres>
    <JST>2</JST><GV>2</GV>
  </Podmiot2>`;

const FA_PLN = `<KodWaluty>PLN</KodWaluty>
    <P_1>2026-03-02</P_1>
    <P_2>FV/12/03/2026</P_2>
    <P_6>2026-02-28</P_6>
    <P_13_1>100.00</P_13_1>
    <P_14_1>23.00</P_14_1>
    <P_13_2>50.50</P_13_2>
    <P_14_2>4.04</P_14_2>
    <P_15>177.54</P_15>
    <Adnotacje><P_16>2</P_16><P_17>2</P_17><P_18>2</P_18><P_18A>2</P_18A></Adnotacje>
    <RodzajFaktury>VAT</RodzajFaktury>
    <FaWiersz>
      <NrWierszaFa>1</NrWierszaFa><P_7>Usługa serwisowa</P_7><P_8A>szt.</P_8A><P_8B>1</P_8B>
      <P_9A>100.00</P_9A><P_11>100.00</P_11><P_12>23</P_12>
    </FaWiersz>
    <FaWiersz>
      <NrWierszaFa>2</NrWierszaFa><P_7>Dojazd</P_7><P_11>50.50</P_11><P_12>8</P_12>
    </FaWiersz>
    <Platnosc>
      <Zaplacono>1</Zaplacono><DataZaplaty>2026-03-05</DataZaplaty>
      <TerminPlatnosci><Termin>2026-03-16</Termin></TerminPlatnosci>
      <FormaPlatnosci>6</FormaPlatnosci>
    </Platnosc>`;

function invoiceXml({ header = HEADER, buyer = BUYER, fa = FA_PLN }: Opts = {}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns:etd="http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2022/01/05/eD/DefinicjeTypy/"
  xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/">
  ${header}
  <Podmiot1>
    <DaneIdentyfikacyjne><NIP>7770000000</NIP><Nazwa>Serwis &amp; Części Sp. z o.o.</Nazwa></DaneIdentyfikacyjne>
    <Adres><KodKraju>PL</KodKraju><AdresL1>ul. Kwiatowa 1</AdresL1><AdresL2>00-001 Warszawa</AdresL2></Adres>
  </Podmiot1>
  ${buyer}
  <Fa>
    ${fa}
  </Fa>
</Faktura>`;
}

describe('parseFa3', () => {
  it('reads parties, dates, sums by rate, lines and payment of a PLN invoice', () => {
    const inv = parseFa3(invoiceXml());
    expect(inv).toEqual<FaInvoice>({
      invoiceType: 'VAT',
      number: 'FV/12/03/2026',
      issueDate: '2026-03-02',
      saleDate: '2026-02-28',
      currency: 'PLN',
      seller: {
        nip: '7770000000',
        name: 'Serwis & Części Sp. z o.o.',
        country: 'PL',
        address: 'ul. Kwiatowa 1, 00-001 Warszawa',
      },
      buyer: { nip: '5260000000', name: 'Jan Testowy', country: 'PL', address: 'ul. Polna 1' },
      sums: [
        { group: '23', net: 10000, vat: 2300 },
        { group: '8', net: 5050, vat: 404 },
      ],
      total: 17754,
      lines: [
        { no: 1, name: 'Usługa serwisowa', unit: 'szt.', quantity: '1', net: 10000, rate: '23' },
        { no: 2, name: 'Dojazd', net: 5050, rate: '8' },
      ],
      paidAt: '2026-03-05',
      dueDate: '2026-03-16',
    });
  });

  it('takes the PLN VAT of a foreign-currency invoice from P_14_xW', () => {
    const fa = FA_PLN.replace('<KodWaluty>PLN</KodWaluty>', '<KodWaluty>EUR</KodWaluty>')
      .replace('<P_14_1>23.00</P_14_1>', '<P_14_1>23.00</P_14_1><P_14_1W>97.75</P_14_1W>')
      .replace('<P_14_2>4.04</P_14_2>', '<P_14_2>4.04</P_14_2><P_14_2W>17.17</P_14_2W>');
    const inv = parseFa3(invoiceXml({ fa }));
    expect(inv.currency).toBe('EUR');
    expect(inv.sums).toEqual([
      { group: '23', net: 10000, vat: 2300, vatPln: 9775 },
      { group: '8', net: 5050, vat: 404, vatPln: 1717 },
    ]);
    expect(faDocumentLines(inv)).toEqual({
      lines: [
        { net: 10000, vatRate: '23', vat: 9775 },
        { net: 5050, vatRate: '8', vat: 1717 },
      ],
      issues: [],
    });
  });

  it('reads a correction with negative differences and the corrected invoice', () => {
    const fa = `<KodWaluty>PLN</KodWaluty><P_1>2026-04-10</P_1><P_2>KOR/1/04/2026</P_2>
      <P_13_1>-20.00</P_13_1><P_14_1>-4.60</P_14_1><P_15>-24.60</P_15>
      <Adnotacje><P_16>2</P_16><P_17>2</P_17><P_18>2</P_18><P_18A>2</P_18A></Adnotacje>
      <RodzajFaktury>KOR</RodzajFaktury>
      <PrzyczynaKorekty>Rabat</PrzyczynaKorekty>
      <DaneFaKorygowanej>
        <DataWystFaKorygowanej>2026-03-02</DataWystFaKorygowanej>
        <NrFaKorygowanej>FV/12/03/2026</NrFaKorygowanej>
        <NrKSeF>1</NrKSeF>
        <NrKSeFFaKorygowanej>7770000000-20260302-0A1B2C3D4E5F-AB</NrKSeFFaKorygowanej>
      </DaneFaKorygowanej>`;
    const inv = parseFa3(invoiceXml({ fa }));
    expect(inv.invoiceType).toBe('KOR');
    expect(inv.sums).toEqual([{ group: '23', net: -2000, vat: -460 }]);
    expect(inv.total).toBe(-2460);
    expect(inv.correctionReason).toBe('Rabat');
    expect(inv.corrected).toEqual([
      { number: 'FV/12/03/2026', issueDate: '2026-03-02', ksefNumber: '7770000000-20260302-0A1B2C3D4E5F-AB' },
    ]);
    expect(inv.saleDate).toBeUndefined();
    expect(inv.lines).toEqual([]);
  });

  it('takes the sale date from the end of OkresFa', () => {
    const fa = FA_PLN.replace(
      '<P_6>2026-02-28</P_6>',
      '<OkresFa><P_6_Od>2026-02-01</P_6_Od><P_6_Do>2026-02-28</P_6_Do></OkresFa>',
    );
    const inv = parseFa3(invoiceXml({ fa }));
    expect(inv.period).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(inv.saleDate).toBe('2026-02-28');
  });

  it('takes the sale date from P_6A only when all lines share it', () => {
    const noP6 = FA_PLN.replace('<P_6>2026-02-28</P_6>', '');
    const same = noP6.replace(
      /<NrWierszaFa>(\d)<\/NrWierszaFa>/g,
      '<NrWierszaFa>$1</NrWierszaFa><P_6A>2026-02-20</P_6A>',
    );
    expect(parseFa3(invoiceXml({ fa: same })).saleDate).toBe('2026-02-20');
    const mixed = noP6.replace('<NrWierszaFa>1</NrWierszaFa>', '<NrWierszaFa>1</NrWierszaFa><P_6A>2026-02-20</P_6A>');
    expect(parseFa3(invoiceXml({ fa: mixed })).saleDate).toBeUndefined();
    expect(parseFa3(invoiceXml({ fa: noP6 })).saleDate).toBeUndefined();
  });

  it('reads a buyer identified by an EU VAT number or without an identifier', () => {
    const ue = parseFa3(
      invoiceXml({
        buyer: `<Podmiot2><DaneIdentyfikacyjne><KodUE>DE</KodUE><NrVatUE>123456789</NrVatUE><Nazwa>Kunde GmbH</Nazwa></DaneIdentyfikacyjne><JST>2</JST><GV>2</GV></Podmiot2>`,
      }),
    );
    expect(ue.buyer).toEqual({ vatUe: { country: 'DE', number: '123456789' }, name: 'Kunde GmbH', country: 'DE' });

    const none = parseFa3(
      invoiceXml({
        buyer: `<Podmiot2><DaneIdentyfikacyjne><BrakID>1</BrakID><Nazwa>Osoba prywatna</Nazwa></DaneIdentyfikacyjne><JST>2</JST><GV>2</GV></Podmiot2>`,
      }),
    );
    expect(none.buyer).toEqual({ name: 'Osoba prywatna' });

    const other = parseFa3(
      invoiceXml({
        buyer: `<Podmiot2><DaneIdentyfikacyjne><KodKraju>US</KodKraju><NrID>98-7654321</NrID><Nazwa>Acme Inc.</Nazwa></DaneIdentyfikacyjne><JST>2</JST><GV>2</GV></Podmiot2>`,
      }),
    );
    expect(other.buyer).toEqual({ otherId: { country: 'US', id: '98-7654321' }, name: 'Acme Inc.', country: 'US' });
  });

  it('leaves paidAt empty for a partial payment', () => {
    const fa = FA_PLN.replace(
      '<Zaplacono>1</Zaplacono><DataZaplaty>2026-03-05</DataZaplaty>',
      '<ZnacznikZaplatyCzesciowej>1</ZnacznikZaplatyCzesciowej><ZaplataCzesciowa><KwotaZaplatyCzesciowej>50.00</KwotaZaplatyCzesciowej><DataZaplatyCzesciowej>2026-03-05</DataZaplatyCzesciowej></ZaplataCzesciowa>',
    );
    const inv = parseFa3(invoiceXml({ fa }));
    expect(inv.paidAt).toBeUndefined();
    expect(inv.dueDate).toBe('2026-03-16');
  });

  it('rejects other structures and broken fields', () => {
    expect(() => parseFa3('не xml <')).toThrow(FaParseError);
    expect(() => parseFa3('<JPK/>')).toThrow(/Faktura/);
    const fa2 = HEADER.replace('FA (3)', 'FA (2)').replace('<WariantFormularza>3', '<WariantFormularza>2');
    expect(() => parseFa3(invoiceXml({ header: fa2 }))).toThrow(/FA \(2\)/);
    expect(() => parseFa3(invoiceXml({ fa: FA_PLN.replace('<P_2>FV/12/03/2026</P_2>', '') }))).toThrow(/P_2/);
    expect(() => parseFa3(invoiceXml({ fa: FA_PLN.replace('100.00</P_13_1>', '100.001</P_13_1>') }))).toThrow(/P_13_1/);
    expect(() => parseFa3(invoiceXml({ fa: FA_PLN.replace('<P_1>2026-03-02', '<P_1>2026-02-30') }))).toThrow(/P_1/);
    expect(() => parseFa3(invoiceXml({ fa: FA_PLN.replace('>VAT</RodzajFaktury>', '>XYZ</RodzajFaktury>') }))).toThrow(
      /RodzajFaktury/,
    );
  });
});

describe('faDocumentLines', () => {
  const base = parseFa3(invoiceXml());

  it('maps PLN sums to document lines with the VAT from the invoice', () => {
    expect(faDocumentLines(base)).toEqual({
      lines: [
        { net: 10000, vatRate: '23', vat: 2300 },
        { net: 5050, vatRate: '8', vat: 404 },
      ],
      issues: [],
    });
  });

  it('maps 0%, zw and np groups and keeps VAT only where the rate has it', () => {
    const inv: FaInvoice = {
      ...base,
      sums: [
        { group: '0kr', net: 100 },
        { group: '0ex', net: 200 },
        { group: 'zw', net: 300 },
        { group: 'np', net: 400 },
        { group: 'np100', net: 500 },
      ],
    };
    expect(faDocumentLines(inv).lines).toEqual([
      { net: 100, vatRate: '0' },
      { net: 200, vatRate: '0' },
      { net: 300, vatRate: 'zw' },
      { net: 400, vatRate: 'np' },
      { net: 500, vatRate: 'np' },
    ]);
  });

  it('reports groups and currencies the ledger does not model', () => {
    const inv: FaInvoice = {
      ...base,
      currency: 'GBP',
      sums: [
        { group: '23', net: 1000, vat: 230, vatPln: 1200 },
        { group: 'oo', net: 500 },
        { group: 'marza', net: 50 },
      ],
    };
    expect(faDocumentLines(inv)).toEqual({
      lines: [{ net: 1000, vatRate: '23', vat: 1200 }],
      issues: [
        { code: 'currency', detail: 'GBP' },
        { code: 'rate', detail: 'oo' },
        { code: 'rate', detail: 'marza' },
      ],
    });
  });

  it('leaves VAT to the ledger when a foreign invoice has no P_14_xW, and flags an invoice without sums', () => {
    const eur: FaInvoice = { ...base, currency: 'EUR', sums: [{ group: '23', net: 1000, vat: 230 }] };
    expect(faDocumentLines(eur).lines).toEqual([{ net: 1000, vatRate: '23' }]);
    expect(faDocumentLines({ ...base, sums: [] }).issues).toEqual([{ code: 'noSums' }]);
  });
});
