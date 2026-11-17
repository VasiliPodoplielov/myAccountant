import { DOMParser } from '@xmldom/xmldom';
import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SignedXml } from 'xml-crypto';
import { createTestIdentity } from './selfSigned';
import {
  authTokenRequestXml,
  escapeText,
  issuerName,
  loadIdentity,
  serialDecimal,
  signAuthTokenRequest,
  SigningError,
} from './xades';

const REQ = { challenge: '20250604-CR-461EA5B000-537A6BA15D-D7', nip: '5265877635' };
const NOW = new Date('2026-10-29T10:00:00Z');
const DS = 'http://www.w3.org/2000/09/xmldsig#';

/** ECDSA для xml-crypto: підпис R||S, як вимагає XMLDSig 1.1 */
class EcdsaSha256 {
  getSignature(): string {
    throw new Error('only verification');
  }
  verifySignature(material: string, key: Parameters<typeof verify>[2], signatureValue: string): boolean {
    return verify(
      'sha256',
      Buffer.from(material, 'utf8'),
      { key: key as never, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signatureValue, 'base64'),
    );
  }
  getAlgorithmName() {
    return 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256';
  }
}

/** Незалежна перевірка: xml-crypto сам канонізує документ і SignedProperties і звіряє дайджести та підпис */
function checkWithXmlCrypto(xml: string, certificatePem: string): { ok: boolean; errors: string[] } {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const signature = doc.getElementsByTagNameNS(DS, 'Signature')[0];
  if (!signature) throw new Error('no signature');
  const sig = new SignedXml({ publicCert: certificatePem });
  (sig.SignatureAlgorithms as Record<string, unknown>)['http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256'] =
    EcdsaSha256;
  sig.loadSignature(signature as never);
  try {
    return { ok: sig.checkSignature(xml), errors: [] };
  } catch (e) {
    return { ok: false, errors: [(e as Error).message] };
  }
}

describe('authTokenRequestXml', () => {
  it('builds the request from the documentation example in canonical form', () => {
    expect(authTokenRequestXml(REQ)).toBe(
      '<AuthTokenRequest xmlns="http://ksef.mf.gov.pl/auth/token/2.0">' +
        '<Challenge>20250604-CR-461EA5B000-537A6BA15D-D7</Challenge>' +
        '<ContextIdentifier><Nip>5265877635</Nip></ContextIdentifier>' +
        '<SubjectIdentifierType>certificateSubject</SubjectIdentifierType></AuthTokenRequest>',
    );
    expect(authTokenRequestXml({ ...REQ, subjectIdentifierType: 'certificateFingerprint' })).toContain(
      '<SubjectIdentifierType>certificateFingerprint</SubjectIdentifierType>',
    );
  });

  it('rejects values the schema does not allow', () => {
    expect(() => authTokenRequestXml({ ...REQ, challenge: 'abc' })).toThrow(SigningError);
    expect(() => authTokenRequestXml({ ...REQ, nip: '0123456789' })).toThrow(/NIP/);
    expect(() => authTokenRequestXml({ ...REQ, nip: '52658776<' })).toThrow(/NIP/);
  });
});

describe('signAuthTokenRequest', () => {
  for (const keyType of ['ec', 'rsa'] as const) {
    it(`produces a XAdES signature that an independent verifier accepts (${keyType})`, () => {
      const id = createTestIdentity({ nip: REQ.nip, keyType });
      const xml = signAuthTokenRequest(REQ, loadIdentity(id.certificatePem, id.privateKeyPem), NOW);
      expect(checkWithXmlCrypto(xml, id.certificatePem)).toEqual({ ok: true, errors: [] });
    });
  }

  it('places the enveloped signature as the last child with XAdES signed properties', () => {
    const id = createTestIdentity({ nip: REQ.nip });
    const xml = signAuthTokenRequest(REQ, loadIdentity(id.certificatePem, id.privateKeyPem), NOW);
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    const root = doc.documentElement!;
    expect(root.localName).toBe('AuthTokenRequest');
    expect(root.lastChild?.localName).toBe('Signature');
    expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?><AuthTokenRequest')).toBe(true);

    const text = (ns: string, name: string) => doc.getElementsByTagNameNS(ns, name)[0]?.textContent;
    const XADES = 'http://uri.etsi.org/01903/v1.3.2#';
    // signingTime на хвилину раніше, як в офіційному клієнті
    expect(text(XADES, 'SigningTime')).toBe('2026-10-29T09:59:00.000Z');
    expect(text(DS, 'DigestValue')).toBeTruthy();
    expect(
      doc.getElementsByTagNameNS(XADES, 'CertDigest')[0]?.getElementsByTagNameNS(DS, 'DigestValue')[0]?.textContent,
    ).toBe(createHash('sha256').update(id.certificate.raw).digest('base64'));
    expect(text(DS, 'X509SerialNumber')).toBe(BigInt(`0x${id.certificate.serialNumber}`).toString());
    expect(text(DS, 'X509Certificate')).toBe(id.certificate.raw.toString('base64'));
    expect(doc.getElementsByTagNameNS(DS, 'SignatureMethod')[0]?.getAttribute('Algorithm')).toBe(
      'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256',
    );
  });

  it('fails verification when the signed document or properties change', () => {
    const id = createTestIdentity({ nip: REQ.nip });
    const xml = signAuthTokenRequest(REQ, loadIdentity(id.certificatePem, id.privateKeyPem), NOW);
    expect(
      checkWithXmlCrypto(xml.replace('<Nip>5265877635</Nip>', '<Nip>5265877636</Nip>'), id.certificatePem).ok,
    ).toBe(false);
    expect(
      checkWithXmlCrypto(xml.replace('2026-10-29T09:59:00.000Z', '2026-10-29T09:59:01.000Z'), id.certificatePem).ok,
    ).toBe(false);
    const other = createTestIdentity({ nip: REQ.nip });
    expect(checkWithXmlCrypto(xml, other.certificatePem).ok).toBe(false);
  });
});

describe('loadIdentity', () => {
  it('accepts an encrypted private key with its passphrase', () => {
    const id = createTestIdentity({ nip: REQ.nip });
    const encrypted = id.privateKey
      .export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'tajne' })
      .toString();
    expect(loadIdentity(id.certificatePem, encrypted, 'tajne').certificate.serialNumber).toBe(
      id.certificate.serialNumber,
    );
    expect(() => loadIdentity(id.certificatePem, encrypted, 'zle')).toThrow();
  });

  it('rejects a key that does not match the certificate or is too weak', () => {
    const id = createTestIdentity({ nip: REQ.nip });
    const other = createTestIdentity({ nip: REQ.nip });
    expect(() => loadIdentity(id.certificatePem, other.privateKeyPem)).toThrow(/не відповідає/);

    const p384 = generateKeyPairSync('ec', { namedCurve: 'secp384r1' });
    expect(() =>
      loadIdentity(id.certificatePem, p384.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()),
    ).toThrow(SigningError);
  });
});

describe('helpers', () => {
  it('reads the test certificate subject the way KSeF expects', () => {
    const id = createTestIdentity({ nip: REQ.nip, givenName: 'Anna', surname: 'Nowak', commonName: 'Anna Nowak' });
    expect(id.certificate.subject.split('\n')).toEqual([
      'GN=Anna',
      'SN=Nowak',
      'serialNumber=TINPL-5265877635',
      'CN=Anna Nowak',
      'C=PL',
    ]);
    expect(issuerName(id.certificate)).toBe('C=PL, CN=Anna Nowak, serialNumber=TINPL-5265877635, SN=Nowak, GN=Anna');
    expect(serialDecimal(id.certificate)).toMatch(/^\d+$/);
    expect(id.certificate.checkIssued(id.certificate)).toBe(true);
    expect(id.certificate.verify(id.certificate.publicKey)).toBe(true);
    expect(() => createTestIdentity({ nip: '123' })).toThrow(/NIP/);
  });

  it('escapes text the way c14n does', () => {
    expect(escapeText('A & B <C> "q"\r\n')).toBe('A &amp; B &lt;C&gt; "q"&#xD;\n');
  });
});
