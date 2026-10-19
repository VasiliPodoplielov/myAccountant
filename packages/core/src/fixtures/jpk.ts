/**
 * Файли JPK_V7M для тестів. Структура — як у поданих файлах бухгалтера, дані платника й контрагентів
 * вигадані. january2026Jpk — січень 2026 з month-2026-01.ts у вигляді поданого JPK_V7M(2).
 */

interface XmlRow {
  [tag: string]: string;
}

const NS: Record<2 | 3, { tns: string; etd: string; system: string; decl: string }> = {
  2: {
    tns: 'http://crd.gov.pl/wzor/2021/12/27/11148/',
    etd: 'http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2021/06/08/eD/DefinicjeTypy/',
    system: 'JPK_V7M (2)',
    decl: 'VAT-7 (22)',
  },
  3: {
    tns: 'http://crd.gov.pl/wzor/2025/12/19/14090/',
    etd: 'http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2022/09/13/eD/DefinicjeTypy/',
    system: 'JPK_V7M (3)',
    decl: 'VAT-7 (23)',
  },
};

const tags = (prefix: string, row: XmlRow) =>
  Object.entries(row)
    .map(([k, v]) => `<${prefix}${k}>${v}</${prefix}${k}>`)
    .join('');

export interface JpkXmlInput {
  variant?: 2 | 3;
  /** Замінює kodSystemowy, щоб перевірити непідтримувані формуляри */
  systemCode?: string;
  year?: number;
  month?: number;
  purpose?: 1 | 2;
  declaration?: XmlRow;
  sales?: XmlRow[];
  purchases?: XmlRow[];
  /** Контрольні суми; без них рахуються з рядків K_20 і K_43 */
  salesCtrl?: XmlRow;
  purchaseCtrl?: XmlRow;
}

const sum = (rows: XmlRow[], fields: string[]) =>
  (rows.reduce((a, r) => a + fields.reduce((b, f) => b + Math.round(Number(r[f] ?? 0) * 100), 0), 0) / 100).toFixed(2);

/** XML у форматі поданого JPK_V7M: заголовок, Podmiot1, Deklaracja, Ewidencja */
export function jpkXml(input: JpkXmlInput = {}): string {
  const variant = input.variant ?? 3;
  const ns = NS[variant];
  const sales = (input.sales ?? []).map((r, i) => ({ LpSprzedazy: String(i + 1), ...r }));
  const purchases = (input.purchases ?? []).map((r, i) => ({ LpZakupu: String(i + 1), ...r }));
  const salesCtrl = input.salesCtrl ?? {
    LiczbaWierszySprzedazy: String(sales.length),
    PodatekNalezny: sum(sales, ['K_16', 'K_18', 'K_20']),
  };
  const purchaseCtrl = input.purchaseCtrl ?? {
    LiczbaWierszyZakupow: String(purchases.length),
    PodatekNaliczony: sum(purchases, ['K_43']),
  };

  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<tns:JPK xmlns:etd="${ns.etd}" xmlns:tns="${ns.tns}">` +
    `<tns:Naglowek><tns:KodFormularza kodSystemowy="${input.systemCode ?? ns.system}" wersjaSchemy="1-0E">JPK_VAT</tns:KodFormularza>` +
    `<tns:WariantFormularza>${variant}</tns:WariantFormularza><tns:DataWytworzeniaJPK>2026-02-12T11:03:44+01:00</tns:DataWytworzeniaJPK>` +
    `<tns:NazwaSystemu>Test</tns:NazwaSystemu><tns:CelZlozenia poz="P_7">${input.purpose ?? 1}</tns:CelZlozenia>` +
    `<tns:KodUrzedu>0000</tns:KodUrzedu><tns:Rok>${input.year ?? 2026}</tns:Rok><tns:Miesiac>${input.month ?? 1}</tns:Miesiac></tns:Naglowek>` +
    `<tns:Podmiot1 rola="Podatnik"><tns:OsobaFizyczna><etd:NIP>0000000000</etd:NIP><etd:ImiePierwsze>Jan</etd:ImiePierwsze>` +
    `<etd:Nazwisko>Testowy</etd:Nazwisko><etd:DataUrodzenia>1990-01-01</etd:DataUrodzenia><tns:Email>test@example.com</tns:Email>` +
    `</tns:OsobaFizyczna></tns:Podmiot1>` +
    `<Deklaracja xmlns="${ns.tns}"><Naglowek><KodFormularzaDekl kodPodatku="VAT" kodSystemowy="${ns.decl}" rodzajZobowiazania="Z" wersjaSchemy="1-0E">VAT-7</KodFormularzaDekl>` +
    `<WariantFormularzaDekl>${variant === 2 ? 22 : 23}</WariantFormularzaDekl></Naglowek>` +
    `<PozycjeSzczegolowe>${tags('', input.declaration ?? {})}</PozycjeSzczegolowe><Pouczenia>1</Pouczenia></Deklaracja>` +
    `<tns:Ewidencja>` +
    sales.map((r) => `<tns:SprzedazWiersz>${tags('tns:', r)}</tns:SprzedazWiersz>`).join('') +
    `<tns:SprzedazCtrl>${tags('tns:', salesCtrl)}</tns:SprzedazCtrl>` +
    purchases.map((r) => `<tns:ZakupWiersz>${tags('tns:', r)}</tns:ZakupWiersz>`).join('') +
    `<tns:ZakupCtrl>${tags('tns:', purchaseCtrl)}</tns:ZakupCtrl>` +
    `</tns:Ewidencja></tns:JPK>`
  );
}

const purchase = (nip: string, name: string, number: string, date: string, k42: string, k43: string): XmlRow => ({
  NrDostawcy: nip,
  NazwaDostawcy: name,
  DowodZakupu: number,
  DataZakupu: date,
  K_42: k42,
  K_43: k43,
});

/**
 * Січень 2026 бухгалтера як поданий JPK_V7M(2), анонімізований так само, як month-2026-01.ts.
 * Для авто K_42 і K_43 — половина netto й VAT, як у файлі бухгалтера.
 */
export const january2026Jpk = jpkXml({
  variant: 2,
  year: 2026,
  month: 1,
  declaration: {
    P_19: '18560',
    P_20: '4269',
    P_37: '18560',
    P_38: '4269',
    P_42: '2101',
    P_43: '483',
    P_48: '483',
    P_51: '3786',
  },
  sales: [
    {
      NrKontrahenta: '1111111111',
      NazwaKontrahenta: 'Klient IT sp. z o.o.',
      DowodSprzedazy: 'FV 1/01/2026',
      DataWystawienia: '2026-02-02',
      DataSprzedazy: '2026-01-31',
      K_19: '18560.00',
      K_20: '4268.80',
    },
  ],
  purchases: [
    purchase('2222222222', 'Stacja Paliw S.A.', 'F 101/01/26', '2026-01-04', '87.92', '20.22'),
    purchase('3333333333', 'Opony sp. z o.o.', 'FAS/1/01/2026', '2026-01-08', '629.27', '144.73'),
    purchase('4444444444', 'Doradca Podatkowy', '1/01/2026/DP', '2026-01-14', '1030.00', '236.90'),
    purchase('2222222222', 'Stacja Paliw S.A.', 'F 102/01/26', '2026-01-25', '133.88', '30.80'),
    purchase('5555555555', 'Biuro Rachunkowe', '1/1/2026', '2026-01-30', '220.00', '50.60'),
  ],
});
