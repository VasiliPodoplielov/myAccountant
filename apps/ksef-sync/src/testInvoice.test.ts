import { constants, createDecipheriv, createHash, privateDecrypt } from 'node:crypto';
import { faDocumentLines, parseFa3 } from '@jdg/core';
import { describe, expect, it } from 'vitest';
import { KsefClient } from './api';
import { KSEF_BASE_URL, KsefHttp } from './http';
import { createTestIdentity } from './selfSigned';
import { encryptAes, randomNip, sendInvoice, testInvoiceXml, TestInvoiceError } from './testInvoice';
import { FakeClock, fakeFetch, json, type Call } from './testing';

const nipValid = (nip: string) => {
  const w = [6, 5, 7, 2, 3, 4, 5, 6, 7];
  const d = nip.split('').map(Number);
  return /^[1-9]((\d[1-9])|([1-9]\d))\d{7}$/.test(nip) && w.reduce((s, x, i) => s + x * d[i]!, 0) % 11 === d[9];
};

const DATA = {
  sellerNip: '5265877635',
  buyerNip: '7770001234',
  number: 'TEST/1',
  issueDate: '2026-10-29',
  net: 10000,
  createdAt: new Date('2026-10-29T10:00:00Z'),
};

describe('randomNip', () => {
  it('generates NIPs with a valid check digit', () => {
    for (let i = 0; i < 200; i++) expect(nipValid(randomNip())).toBe(true);
    expect(nipValid('5265877635')).toBe(true);
  });
});

describe('testInvoiceXml', () => {
  it('is an FA(3) invoice the parser reads back with the same sums', () => {
    const inv = parseFa3(testInvoiceXml(DATA));
    expect(inv).toMatchObject({
      invoiceType: 'VAT',
      number: 'TEST/1',
      issueDate: '2026-10-29',
      seller: { nip: '5265877635' },
      buyer: { nip: '7770001234' },
      total: 12300,
    });
    expect(faDocumentLines(inv).lines).toEqual([{ net: 10000, vatRate: '23', vat: 2300 }]);
    expect(() => testInvoiceXml({ ...DATA, net: 0 })).toThrow(TestInvoiceError);
  });
});

describe('sendInvoice', () => {
  it('encrypts the invoice for the MF key, sends it and returns the KSeF number', async () => {
    const clock = new FakeClock();
    const mf = createTestIdentity({ nip: '1111111111', keyType: 'rsa' });
    const xml = testInvoiceXml(DATA);
    let sessionKey: Buffer | undefined;
    let sessionIv: Buffer | undefined;
    let received: string | undefined;
    const validUntil = new Date(clock.now() + 3_600_000).toISOString();
    const f = fakeFetch({
      'POST /auth/challenge': () => json({ challenge: '20251010-CR-2DFC46C000-3AC6D5877F-D4' }),
      'POST /auth/xades-signature': () =>
        json({ referenceNumber: 'R', authenticationToken: { token: 'AUTH', validUntil } }),
      'GET /auth/{r}': () => json({ status: { code: 200, description: 'ok' } }),
      'POST /auth/token/redeem': () =>
        json({ accessToken: { token: 'ACC', validUntil }, refreshToken: { token: 'REF', validUntil } }),
      'GET /security/public-key-certificates': () =>
        json([
          {
            certificate: 'AAAA',
            validFrom: '2025-01-01T00:00:00Z',
            validTo: '2027-01-01T00:00:00Z',
            usage: ['KsefTokenEncryption'],
          },
          {
            certificate: mf.certificate.raw.toString('base64'),
            validFrom: '2025-01-01T00:00:00Z',
            validTo: '2027-01-01T00:00:00Z',
            usage: ['SymmetricKeyEncryption'],
          },
        ]),
      'POST /sessions/online': (c: Call) => {
        const body = JSON.parse(c.body!);
        expect(body.formCode).toEqual({ systemCode: 'FA (3)', schemaVersion: '1-0E', value: 'FA' });
        sessionKey = privateDecrypt(
          { key: mf.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
          Buffer.from(body.encryption.encryptedSymmetricKey, 'base64'),
        );
        sessionIv = Buffer.from(body.encryption.initializationVector, 'base64');
        return json({ referenceNumber: 'S1', validUntil }, 201);
      },
      'POST /sessions/online/{s}/invoices': (c: Call) => {
        const body = JSON.parse(c.body!);
        const enc = Buffer.from(body.encryptedInvoiceContent, 'base64');
        const d = createDecipheriv('aes-256-cbc', sessionKey!, sessionIv!);
        const plain = Buffer.concat([d.update(enc), d.final()]);
        received = plain.toString('utf8');
        expect(body.invoiceHash).toBe(createHash('sha256').update(plain).digest('base64'));
        expect(body.invoiceSize).toBe(plain.length);
        expect(body.encryptedInvoiceSize).toBe(enc.length);
        expect(body.encryptedInvoiceHash).toBe(createHash('sha256').update(enc).digest('base64'));
        return json({ referenceNumber: 'I1' }, 202);
      },
      'GET /sessions/{s}/invoices/{i}': [
        () => json({ status: { code: 150, description: 'Trwa przetwarzanie' } }),
        () => json({ ksefNumber: '5265877635-20261029-0100001AF629-AF', status: { code: 200, description: 'Sukces' } }),
      ],
      'POST /sessions/online/{s}/close': () => new Response(null, { status: 204 }),
    });
    const http = new KsefHttp(KSEF_BASE_URL.test, { fetch: f.fetch, clock });
    const client = new KsefClient(http, { clock });
    const seller = createTestIdentity({ nip: DATA.sellerNip });
    await client.authenticate(seller, DATA.sellerNip);

    expect(await sendInvoice(http, client, xml, clock, { pollMs: 1000 })).toBe('5265877635-20261029-0100001AF629-AF');
    expect(received).toBe(xml);
    expect(f.calls.at(-1)!.url.pathname).toBe('/v2/sessions/online/S1/close');
    expect(clock.slept).toEqual([1000]);
  });

  it('reports a rejected invoice with the status from KSeF', async () => {
    const clock = new FakeClock();
    const mf = createTestIdentity({ nip: '1111111111', keyType: 'rsa' });
    const validUntil = new Date(clock.now() + 3_600_000).toISOString();
    const f = fakeFetch({
      'POST /auth/challenge': () => json({ challenge: '20251010-CR-2DFC46C000-3AC6D5877F-D4' }),
      'POST /auth/xades-signature': () =>
        json({ referenceNumber: 'R', authenticationToken: { token: 'AUTH', validUntil } }),
      'GET /auth/{r}': () => json({ status: { code: 200, description: 'ok' } }),
      'POST /auth/token/redeem': () =>
        json({ accessToken: { token: 'ACC', validUntil }, refreshToken: { token: 'REF', validUntil } }),
      'GET /security/public-key-certificates': () =>
        json([
          {
            certificate: mf.certificate.raw.toString('base64'),
            validFrom: '2025-01-01T00:00:00Z',
            validTo: '2027-01-01T00:00:00Z',
            usage: ['SymmetricKeyEncryption'],
          },
        ]),
      'POST /sessions/online': () => json({ referenceNumber: 'S1', validUntil }, 201),
      'POST /sessions/online/{s}/invoices': () => json({ referenceNumber: 'I1' }, 202),
      'GET /sessions/{s}/invoices/{i}': () =>
        json({ status: { code: 450, description: 'Błąd weryfikacji semantyki', details: ['P_15'] } }),
    });
    const http = new KsefHttp(KSEF_BASE_URL.test, { fetch: f.fetch, clock });
    const client = new KsefClient(http, { clock });
    await client.authenticate(createTestIdentity({ nip: DATA.sellerNip }), DATA.sellerNip);
    await expect(sendInvoice(http, client, testInvoiceXml(DATA), clock)).rejects.toThrow(
      'Фактуру відхилено: 450 Błąd weryfikacji semantyki (P_15)',
    );
  });

  it('pads AES-256-CBC with PKCS#7', () => {
    const key = Buffer.alloc(32, 1);
    const iv = Buffer.alloc(16, 2);
    expect(encryptAes(Buffer.alloc(16), key, iv)).toHaveLength(32);
    expect(encryptAes(Buffer.alloc(15), key, iv)).toHaveLength(16);
  });
});
