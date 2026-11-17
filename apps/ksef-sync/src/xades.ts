/**
 * Підпис XAdES-BES (enveloped) документа AuthTokenRequest для POST /auth/xades-signature (KSeF 2.0,
 * uwierzytelnianie.md, auth/podpis-xades.md). Структура — як у SignatureService офіційного клієнта:
 * дві референції (документ з enveloped-signature + exc-c14n і SignedProperties з exc-c14n), SHA-256,
 * SigningTime і SigningCertificate (CertDigest, IssuerSerial), KeyInfo з сертифікатом.
 *
 * Канонізація: увесь XML будується тут, тому кожна підписана частина одразу пишеться у формі exclusive
 * c14n (http://www.w3.org/2001/10/xml-exc-c14n#): без пробілів між елементами, порожні елементи як
 * <a></a>, простір імен оголошено на першому елементі, що його використовує. Ці самі рядки й стоять
 * у документі, тож перевірка з канонізацією дає ті самі байти.
 *
 * Ключі: EC P-256 (ecdsa-sha256, підпис R||S) — так генерує сертифікат KSeF; RSA від 2048 біт (rsa-sha256).
 */

import { createHash, createPrivateKey, sign, X509Certificate, type KeyObject } from 'node:crypto';

const DS = 'http://www.w3.org/2000/09/xmldsig#';
const XADES = 'http://uri.etsi.org/01903/v1.3.2#';
const EXC_C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';
const SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';
const RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const ECDSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256';
const SIGNED_PROPERTIES_TYPE = 'http://uri.etsi.org/01903#SignedProperties';
export const AUTH_NAMESPACE = 'http://ksef.mf.gov.pl/auth/token/2.0';

const SIGNATURE_ID = 'Signature';
const SIGNED_PROPERTIES_ID = 'SignedProperties';

export interface SigningIdentity {
  certificate: X509Certificate;
  privateKey: KeyObject;
}

export class SigningError extends Error {
  override name = 'SigningError';
}

/** Сертифікат і ключ з PEM; ключ може бути зашифрованим (passphrase) */
export function loadIdentity(certificatePem: string, privateKeyPem: string, passphrase?: string): SigningIdentity {
  const certificate = new X509Certificate(certificatePem);
  const privateKey = createPrivateKey(passphrase === undefined ? privateKeyPem : { key: privateKeyPem, passphrase });
  if (!certificate.checkPrivateKey(privateKey)) throw new SigningError('Ключ не відповідає сертифікату');
  signatureMethod(privateKey);
  return { certificate, privateKey };
}

function signatureMethod(key: KeyObject): string {
  const details = key.asymmetricKeyDetails;
  if (key.asymmetricKeyType === 'ec') {
    if (details?.namedCurve !== 'prime256v1') {
      throw new SigningError(`Непідтримана крива ${details?.namedCurve ?? '?'}: потрібна P-256`);
    }
    return ECDSA_SHA256;
  }
  if (key.asymmetricKeyType === 'rsa') {
    if ((details?.modulusLength ?? 0) < 2048) throw new SigningError('Ключ RSA коротший за 2048 біт');
    return RSA_SHA256;
  }
  throw new SigningError(`Непідтриманий тип ключа ${key.asymmetricKeyType ?? '?'}`);
}

// ---------------------------------------------------------------- c14n text

/** Текст елемента в c14n: &, <, > і CR як посилання */
export function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
}

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest('base64');

/**
 * Ім'я видавця для X509IssuerName у порядку RFC 4514 (від найконкретнішого): Node дає RDN у порядку
 * сертифіката, по одному в рядку.
 */
export function issuerName(cert: X509Certificate): string {
  return cert.issuer
    .split('\n')
    .filter((l) => l)
    .reverse()
    .join(', ');
}

/** Серійний номер сертифіката десятковим числом */
export const serialDecimal = (cert: X509Certificate) => BigInt(`0x${cert.serialNumber}`).toString(10);

// ---------------------------------------------------------------- documents

export interface AuthTokenRequest {
  /** Challenge з POST /auth/challenge */
  challenge: string;
  /** NIP контексту (ContextIdentifier/Nip) */
  nip: string;
  /** certificateSubject — NIP береться з сертифіката; certificateFingerprint — за відбитком (SHA-256) */
  subjectIdentifierType?: 'certificateSubject' | 'certificateFingerprint';
}

const CHALLENGE = /^\d{8}-CR-[A-F0-9]{10}-[A-F0-9]{10}-[A-F0-9]{2}$/;
const NIP = /^[1-9]((\d[1-9])|([1-9]\d))\d{7}$/;

/** AuthTokenRequest без підпису, уже в канонічній формі */
export function authTokenRequestXml(req: AuthTokenRequest): string {
  if (!CHALLENGE.test(req.challenge)) throw new SigningError(`Некоректний challenge: «${req.challenge}»`);
  if (!NIP.test(req.nip)) throw new SigningError(`Некоректний NIP: «${req.nip}»`);
  return (
    `<AuthTokenRequest xmlns="${AUTH_NAMESPACE}">` +
    `<Challenge>${req.challenge}</Challenge>` +
    `<ContextIdentifier><Nip>${req.nip}</Nip></ContextIdentifier>` +
    `<SubjectIdentifierType>${req.subjectIdentifierType ?? 'certificateSubject'}</SubjectIdentifierType>` +
    `</AuthTokenRequest>`
  );
}

function signedProperties(identity: SigningIdentity, signingTime: Date): string {
  const ds = (name: string, attrs: string, body: string) => `<ds:${name} xmlns:ds="${DS}"${attrs}>${body}</ds:${name}>`;
  const certDigest = createHash('sha256').update(identity.certificate.raw).digest('base64');
  return (
    `<xades:SignedProperties xmlns:xades="${XADES}" Id="${SIGNED_PROPERTIES_ID}">` +
    `<xades:SignedSignatureProperties>` +
    `<xades:SigningTime>${signingTime.toISOString()}</xades:SigningTime>` +
    `<xades:SigningCertificate><xades:Cert>` +
    `<xades:CertDigest>${ds('DigestMethod', ` Algorithm="${SHA256}"`, '')}${ds('DigestValue', '', certDigest)}</xades:CertDigest>` +
    `<xades:IssuerSerial>${ds('X509IssuerName', '', escapeText(issuerName(identity.certificate)))}` +
    `${ds('X509SerialNumber', '', serialDecimal(identity.certificate))}</xades:IssuerSerial>` +
    `</xades:Cert></xades:SigningCertificate>` +
    `</xades:SignedSignatureProperties>` +
    `</xades:SignedProperties>`
  );
}

function reference(attrs: string, transforms: string[], digestValue: string): string {
  const t = transforms.map((a) => `<ds:Transform Algorithm="${a}"></ds:Transform>`).join('');
  return (
    `<ds:Reference${attrs}><ds:Transforms>${t}</ds:Transforms>` +
    `<ds:DigestMethod Algorithm="${SHA256}"></ds:DigestMethod>` +
    `<ds:DigestValue>${digestValue}</ds:DigestValue></ds:Reference>`
  );
}

/**
 * Підписує канонічний документ (кореневий елемент без префікса, без пробілів між елементами): підпис
 * стає останнім дочірнім елементом кореня. signingTime за прикладом офіційного клієнта на хвилину раніше
 * поточного часу — запас на розбіжність годинників.
 */
export function signEnveloped(canonicalXml: string, identity: SigningIdentity, signingTime: Date): string {
  const close = canonicalXml.lastIndexOf('</');
  if (close < 0 || !canonicalXml.startsWith('<')) throw new SigningError('Документ має бути одним кореневим елементом');

  const props = signedProperties(identity, signingTime);
  const method = signatureMethod(identity.privateKey);
  const signedInfo =
    `<ds:SignedInfo xmlns:ds="${DS}">` +
    `<ds:CanonicalizationMethod Algorithm="${EXC_C14N}"></ds:CanonicalizationMethod>` +
    `<ds:SignatureMethod Algorithm="${method}"></ds:SignatureMethod>` +
    reference(' URI=""', [ENVELOPED, EXC_C14N], digest(canonicalXml)) +
    // атрибути в c14n — за абеткою: Type перед URI
    reference(` Type="${SIGNED_PROPERTIES_TYPE}" URI="#${SIGNED_PROPERTIES_ID}"`, [EXC_C14N], digest(props)) +
    `</ds:SignedInfo>`;

  const value = sign('sha256', Buffer.from(signedInfo, 'utf8'), {
    key: identity.privateKey,
    // XMLDSig 1.1 / RFC 4050: підпис ECDSA як R||S фіксованої довжини
    dsaEncoding: 'ieee-p1363',
  }).toString('base64');
  const certificate = identity.certificate.raw.toString('base64');

  const signature =
    `<ds:Signature xmlns:ds="${DS}" Id="${SIGNATURE_ID}">` +
    signedInfo +
    `<ds:SignatureValue>${value}</ds:SignatureValue>` +
    `<ds:KeyInfo><ds:X509Data><ds:X509Certificate>${certificate}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>` +
    `<ds:Object><xades:QualifyingProperties xmlns:xades="${XADES}" Target="#${SIGNATURE_ID}">${props}</xades:QualifyingProperties></ds:Object>` +
    `</ds:Signature>`;

  return `<?xml version="1.0" encoding="utf-8"?>${canonicalXml.slice(0, close)}${signature}${canonicalXml.slice(close)}`;
}

/** Підписаний AuthTokenRequest, готовий до POST /auth/xades-signature */
export function signAuthTokenRequest(req: AuthTokenRequest, identity: SigningIdentity, now: Date): string {
  return signEnveloped(authTokenRequestXml(req), identity, new Date(now.getTime() - 60_000));
}
