/**
 * Самопідписаний сертифікат X.509 для середовища TEST KSeF: там приймаються сертифікати, згенеровані самим
 * інтегратором, «еквівалентні кваліфікованим» (srodowiska.md, uwierzytelnianie.md). Атрибути — як у
 * SelfSignedCertificateForSignatureBuilder офіційного клієнта: givenName, surname, serialNumber
 * («TINPL-<NIP>» — так KSeF бере NIP із сертифіката), commonName, countryName PL.
 *
 * На DEMO і PROD такий сертифікат не пройде: там потрібен сертифікат KSeF або кваліфікований.
 * Node не вміє створювати сертифікати, тож DER збирається тут вручну.
 */

import { createSign, generateKeyPairSync, randomBytes, X509Certificate, type KeyObject } from 'node:crypto';

// ---------------------------------------------------------------- DER

function length(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

const tlv = (tag: number, content: Buffer) => Buffer.concat([Buffer.from([tag]), length(content.length), content]);
const seq = (...items: Buffer[]) => tlv(0x30, Buffer.concat(items));
const set = (...items: Buffer[]) => tlv(0x31, Buffer.concat(items));

function integer(bytes: Buffer): Buffer {
  let b = bytes;
  while (b.length > 1 && b[0] === 0 && b[1]! < 0x80) b = b.subarray(1);
  return tlv(0x02, b[0]! >= 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b);
}

function oid(dotted: string): Buffer {
  const [a, b, ...rest] = dotted.split('.').map(Number);
  const out = [a! * 40 + b!];
  for (const n of rest) {
    const chunk = [n & 0x7f];
    for (let v = n >>> 7; v > 0; v >>>= 7) chunk.unshift((v & 0x7f) | 0x80);
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}

const utf8 = (s: string) => tlv(0x0c, Buffer.from(s, 'utf8'));
const printable = (s: string) => tlv(0x13, Buffer.from(s, 'ascii'));
const nul = () => Buffer.from([0x05, 0x00]);
const bitString = (b: Buffer) => tlv(0x03, Buffer.concat([Buffer.from([0]), b]));

/** UTCTime до 2049 року, далі GeneralizedTime (RFC 5280, 4.1.2.5) */
function time(d: Date): Buffer {
  const iso = d.toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return d.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(`${iso.slice(2)}Z`)) : tlv(0x18, Buffer.from(`${iso}Z`));
}

// ---------------------------------------------------------------- certificate

export interface TestIdentityOptions {
  /** NIP, який KSeF прочитає із сертифіката (serialNumber «TINPL-<NIP>») */
  nip: string;
  givenName?: string;
  surname?: string;
  commonName?: string;
  /** Ключ: EC P-256 (як сертифікат KSeF) або RSA 2048 */
  keyType?: 'ec' | 'rsa';
  notBefore?: Date;
  notAfter?: Date;
}

export interface TestIdentity {
  certificatePem: string;
  privateKeyPem: string;
  certificate: X509Certificate;
  privateKey: KeyObject;
}

const OID = {
  givenName: '2.5.4.42',
  surname: '2.5.4.4',
  serialNumber: '2.5.4.5',
  commonName: '2.5.4.3',
  countryName: '2.5.4.6',
  ecdsaWithSha256: '1.2.840.10045.4.3.2',
  sha256WithRsa: '1.2.840.113549.1.1.11',
};

const attribute = (type: string, value: Buffer) => set(seq(oid(type), value));

/** Створює самопідписаний сертифікат і ключ для автентифікації на TEST KSeF */
export function createTestIdentity(opts: TestIdentityOptions): TestIdentity {
  if (!/^\d{10}$/.test(opts.nip)) throw new Error(`NIP має бути з 10 цифр: «${opts.nip}»`);
  const keyType = opts.keyType ?? 'ec';
  const { publicKey, privateKey } =
    keyType === 'ec'
      ? generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
      : generateKeyPairSync('rsa', { modulusLength: 2048 });

  const name = seq(
    attribute(OID.givenName, utf8(opts.givenName ?? 'Jan')),
    attribute(OID.surname, utf8(opts.surname ?? 'Testowy')),
    attribute(OID.serialNumber, printable(`TINPL-${opts.nip}`)),
    attribute(OID.commonName, utf8(opts.commonName ?? 'Jan Testowy')),
    attribute(OID.countryName, printable('PL')),
  );
  const algorithm = keyType === 'ec' ? seq(oid(OID.ecdsaWithSha256)) : seq(oid(OID.sha256WithRsa), nul());
  const now = Date.now();
  const tbs = seq(
    tlv(0xa0, integer(Buffer.from([2]))), // v3
    integer(randomBytes(16)),
    algorithm,
    name,
    seq(
      time(opts.notBefore ?? new Date(now - 61 * 60_000)),
      time(opts.notAfter ?? new Date(now + 2 * 365 * 86_400_000)),
    ),
    name,
    publicKey.export({ type: 'spki', format: 'der' }),
  );
  const signature = createSign('sha256').update(tbs).sign(privateKey);
  const der = seq(tbs, algorithm, bitString(signature));
  const certificate = new X509Certificate(der);

  return {
    certificatePem: certificate.toString(),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    certificate,
    privateKey,
  };
}
