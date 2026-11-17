/**
 * Лише для середовища TEST: надсилання тестової фактури, щоб перевірити синхронізацію наскрізно (критерій
 * етапу 9). Продавець — випадковий NIP із самопідписаним сертифікатом, покупець — NIP власника на TEST.
 * Сесія інтерактивна (sesja-interaktywna.md): ключ AES-256 і IV на сесію, ключ шифрується RSA-OAEP SHA-256
 * публічним ключем MF (SymmetricKeyEncryption), фактура — AES-256-CBC з PKCS#7.
 *
 * На DEMO і PROD надсилання заборонене (ROADMAP: жодних відправок на продукційні шлюзи до етапу 16).
 */

import {
  constants,
  createCipheriv,
  createHash,
  publicEncrypt,
  randomBytes,
  randomInt,
  X509Certificate,
} from 'node:crypto';
import { KsefClient, type StatusInfo } from './api';
import type { Clock, KsefHttp } from './http';
import { escapeText } from './xades';

export class TestInvoiceError extends Error {
  override name = 'TestInvoiceError';
}

/** Випадковий NIP з правильною контрольною цифрою (ваги 6 5 7 2 3 4 5 6 7) */
export function randomNip(rand: (max: number) => number = randomInt): string {
  const weights = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  for (;;) {
    const d = [1 + rand(9), ...Array.from({ length: 8 }, () => rand(10))];
    // друга-третя цифри не можуть бути обидві нулями (шаблон TNrNIP)
    if (d[1] === 0 && d[2] === 0) continue;
    const check = d.reduce((s, x, i) => s + x * weights[i]!, 0) % 11;
    if (check === 10) continue;
    return [...d, check].join('');
  }
}

export interface TestInvoiceData {
  sellerNip: string;
  buyerNip: string;
  number: string;
  /** 'YYYY-MM-DD' */
  issueDate: string;
  /** Netto 23%, гроші */
  net: number;
  createdAt: Date;
}

const zl = (grosze: number) => `${Math.trunc(grosze / 100)}.${String(Math.abs(grosze) % 100).padStart(2, '0')}`;

/** Мінімальна FA(3) за офіційним шаблоном (invoice-template-fa-3.xml): одна позиція 23% */
export function testInvoiceXml(d: TestInvoiceData): string {
  if (!Number.isSafeInteger(d.net) || d.net <= 0) throw new TestInvoiceError('Netto має бути додатним, у грошах');
  const vat = Math.round((d.net * 23) / 100);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns:etd="http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2022/01/05/eD/DefinicjeTypy/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/">
  <Naglowek>
    <KodFormularza kodSystemowy="FA (3)" wersjaSchemy="1-0E">FA</KodFormularza>
    <WariantFormularza>3</WariantFormularza>
    <DataWytworzeniaFa>${d.createdAt.toISOString().replace(/\.\d{3}Z$/, 'Z')}</DataWytworzeniaFa>
    <SystemInfo>jdg-ledger test</SystemInfo>
  </Naglowek>
  <Podmiot1>
    <DaneIdentyfikacyjne><NIP>${d.sellerNip}</NIP><Nazwa>Testowy Sprzedawca</Nazwa></DaneIdentyfikacyjne>
    <Adres><KodKraju>PL</KodKraju><AdresL1>ul. Testowa 1</AdresL1><AdresL2>00-001 Warszawa</AdresL2></Adres>
  </Podmiot1>
  <Podmiot2>
    <DaneIdentyfikacyjne><NIP>${d.buyerNip}</NIP><Nazwa>Testowy Nabywca</Nazwa></DaneIdentyfikacyjne>
    <Adres><KodKraju>PL</KodKraju><AdresL1>ul. Polna 1</AdresL1><AdresL2>00-001 Warszawa</AdresL2></Adres>
    <JST>2</JST>
    <GV>2</GV>
  </Podmiot2>
  <Fa>
    <KodWaluty>PLN</KodWaluty>
    <P_1>${d.issueDate}</P_1>
    <P_2>${escapeText(d.number)}</P_2>
    <P_13_1>${zl(d.net)}</P_13_1>
    <P_14_1>${zl(vat)}</P_14_1>
    <P_15>${zl(d.net + vat)}</P_15>
    <Adnotacje>
      <P_16>2</P_16>
      <P_17>2</P_17>
      <P_18>2</P_18>
      <P_18A>2</P_18A>
      <Zwolnienie><P_19N>1</P_19N></Zwolnienie>
      <NoweSrodkiTransportu><P_22N>1</P_22N></NoweSrodkiTransportu>
      <P_23>2</P_23>
      <PMarzy><P_PMarzyN>1</P_PMarzyN></PMarzy>
    </Adnotacje>
    <RodzajFaktury>VAT</RodzajFaktury>
    <FaWiersz>
      <NrWierszaFa>1</NrWierszaFa>
      <P_7>Usługa testowa</P_7>
      <P_8A>szt.</P_8A>
      <P_8B>1</P_8B>
      <P_9A>${zl(d.net)}</P_9A>
      <P_11>${zl(d.net)}</P_11>
      <P_12>23</P_12>
    </FaWiersz>
  </Fa>
</Faktura>`;
}

interface PublicKeyCertificate {
  certificate: string;
  validFrom: string;
  validTo: string;
  usage: string[];
}

export interface SessionInvoiceStatus {
  ksefNumber?: string;
  status: StatusInfo;
}

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('base64');

/** AES-256-CBC з PKCS#7 (у Node — типове доповнення) */
export function encryptAes(data: Buffer, key: Buffer, iv: Buffer): Buffer {
  const c = createCipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([c.update(data), c.final()]);
}

/**
 * Надсилає фактуру в інтерактивній сесії й чекає номера KSeF. Клієнт уже увійшов як продавець.
 */
export async function sendInvoice(
  http: KsefHttp,
  client: KsefClient,
  xml: string,
  clock: Clock,
  opts: { pollMs?: number; timeoutMs?: number } = {},
): Promise<string> {
  const keys = await http.json<PublicKeyCertificate[]>('/security/public-key-certificates');
  const now = clock.now();
  const mf = keys.find(
    (k) => k.usage.includes('SymmetricKeyEncryption') && Date.parse(k.validFrom) <= now && now < Date.parse(k.validTo),
  );
  if (!mf) throw new TestInvoiceError('Немає чинного ключа MF для SymmetricKeyEncryption');
  const mfKey = new X509Certificate(Buffer.from(mf.certificate, 'base64')).publicKey;

  const key = randomBytes(32);
  const iv = randomBytes(16);
  const encryptedKey = publicEncrypt(
    { key: mfKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    key,
  );

  const session = await http.json<{ referenceNumber: string }>('/sessions/online', {
    token: () => client.accessToken(),
    json: {
      formCode: { systemCode: 'FA (3)', schemaVersion: '1-0E', value: 'FA' },
      encryption: {
        encryptedSymmetricKey: encryptedKey.toString('base64'),
        initializationVector: iv.toString('base64'),
      },
    },
  });

  const plain = Buffer.from(xml, 'utf8');
  const encrypted = encryptAes(plain, key, iv);
  const sent = await http.json<{ referenceNumber: string }>(`/sessions/online/${session.referenceNumber}/invoices`, {
    token: () => client.accessToken(),
    json: {
      invoiceHash: sha256(plain),
      invoiceSize: plain.length,
      encryptedInvoiceHash: sha256(encrypted),
      encryptedInvoiceSize: encrypted.length,
      encryptedInvoiceContent: encrypted.toString('base64'),
    },
  });

  const deadline = clock.now() + (opts.timeoutMs ?? 120_000);
  let status: SessionInvoiceStatus;
  for (;;) {
    status = await http.json<SessionInvoiceStatus>(
      `/sessions/${session.referenceNumber}/invoices/${sent.referenceNumber}`,
      { token: () => client.accessToken() },
    );
    if (status.status.code === 200 && status.ksefNumber) break;
    if (status.status.code >= 400) {
      throw new TestInvoiceError(
        `Фактуру відхилено: ${status.status.code} ${status.status.description}${status.status.details?.length ? ` (${status.status.details.join('; ')})` : ''}`,
      );
    }
    if (clock.now() >= deadline) throw new TestInvoiceError('Номер KSeF не надано вчасно');
    await clock.sleep(opts.pollMs ?? 2000);
  }
  await http.request(`/sessions/online/${session.referenceNumber}/close`, {
    method: 'POST',
    token: () => client.accessToken(),
  });
  return status.ksefNumber!;
}
