/**
 * Точка входу сервісу (systemd: deploy/ksef-sync.service, раз на добу через ksef-sync.timer).
 *
 *   node dist/main.mjs                         синхронізація (типово)
 *   node dist/main.mjs test-cert <NIP> <тека>  самопідписаний сертифікат для TEST (cert.pem, key.pem)
 *   node dist/main.mjs send-test-invoice       тестова фактура на KSEF_NIP (лише KSEF_ENV=test)
 *
 * Логи йдуть у stdout/stderr, тобто в journald.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { KsefClient } from './api';
import { checkSecretFile, ConfigError, loadConfig, type Config } from './config';
import { firestoreStore } from './firestore';
import { KSEF_BASE_URL, KsefHttp, realClock } from './http';
import { runOnce } from './run';
import { createTestIdentity } from './selfSigned';
import { randomNip, sendInvoice, testInvoiceXml } from './testInvoice';
import { loadIdentity } from './xades';

const log = (m: string) => console.log(m);

function identityFrom(config: Config) {
  checkSecretFile(config.keyFile);
  let passphrase: string | undefined;
  if (config.keyPassphraseFile) {
    checkSecretFile(config.keyPassphraseFile);
    passphrase = readFileSync(config.keyPassphraseFile, 'utf8').trim();
  }
  return loadIdentity(readFileSync(config.certFile, 'utf8'), readFileSync(config.keyFile, 'utf8'), passphrase);
}

async function sync(): Promise<number> {
  const config = loadConfig();
  const credentials = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credentials) throw new ConfigError('Не задано GOOGLE_APPLICATION_CREDENTIALS (ключ service account Firebase)');
  checkSecretFile(credentials);
  const identity = identityFrom(config);

  const db = getFirestore(initializeApp({ credential: applicationDefault() }));
  db.settings({ ignoreUndefinedProperties: true });
  const run = await runOnce({
    client: new KsefClient(new KsefHttp(KSEF_BASE_URL[config.env], { log })),
    store: firestoreStore(db, config.ownerUid),
    identity,
    nip: config.nip,
    startFrom: config.startFrom,
    env: config.env,
    log,
  });
  return run.ok ? 0 : 1;
}

function testCert(nip: string | undefined, dir: string | undefined): number {
  if (!nip || !dir) throw new ConfigError('Використання: test-cert <NIP> <тека>');
  const id = createTestIdentity({ nip });
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, 'cert.pem'), id.certificatePem, { mode: 0o600 });
  writeFileSync(join(dir, 'key.pem'), id.privateKeyPem, { mode: 0o600 });
  log(`Сертифікат для TEST (NIP ${nip}): ${join(dir, 'cert.pem')}, ключ: ${join(dir, 'key.pem')}`);
  return 0;
}

async function sendTest(): Promise<number> {
  const config = loadConfig();
  if (config.env !== 'test') throw new ConfigError('send-test-invoice працює лише з KSEF_ENV=test');
  const http = new KsefHttp(KSEF_BASE_URL.test, { log });
  const client = new KsefClient(http);
  const sellerNip = randomNip();
  const seller = createTestIdentity({
    nip: sellerNip,
    givenName: 'Testowy',
    surname: 'Sprzedawca',
    commonName: 'Testowy Sprzedawca',
  });
  await client.authenticate(seller, sellerNip);
  try {
    const now = new Date();
    const xml = testInvoiceXml({
      sellerNip,
      buyerNip: config.nip,
      number: `TEST/${now.getTime()}`,
      issueDate: now.toISOString().slice(0, 10),
      net: 10000,
      createdAt: now,
    });
    const ksefNumber = await sendInvoice(http, client, xml, realClock);
    log(`Тестову фактуру надіслано: ${ksefNumber} (продавець ${sellerNip}, покупець ${config.nip})`);
  } finally {
    await client.logout().catch((e: unknown) => log(`Вихід з KSeF: ${(e as Error).message}`));
  }
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const [command = 'sync', ...args] = argv;
  switch (command) {
    case 'sync':
      return sync();
    case 'test-cert':
      return testCert(args[0], args[1]);
    case 'send-test-invoice':
      return sendTest();
    default:
      throw new ConfigError(`Невідома команда «${command}»: sync, test-cert, send-test-invoice`);
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (e: unknown) => {
    console.error(e instanceof Error ? `${e.name}: ${e.message}` : e);
    process.exitCode = 1;
  },
);
