/**
 * Налаштування сервісу зі змінних середовища (на сервері — EnvironmentFile у systemd, див. deploy/).
 * Секрети (ключ сертифіката KSeF, ключ service account Firebase) лежать у файлах з правами 600;
 * у змінних — лише шляхи до них.
 */

import { statSync } from 'node:fs';
import { isoSeconds, type KsefEnvironment } from './http';

export interface Config {
  env: KsefEnvironment;
  /** NIP контексту: фактури цього платника */
  nip: string;
  certFile: string;
  keyFile: string;
  /** Пароль до зашифрованого ключа, з файла */
  keyPassphraseFile?: string;
  /** uid власника у Firebase Auth: дані пишуться в users/{uid} */
  ownerUid: string;
  /** Звідки починати першу синхронізацію (ISO date-time) */
  startFrom: string;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

const ENVIRONMENTS = new Set<string>(['test', 'demo', 'prod']);

function required(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key]?.trim();
  if (!v) throw new ConfigError(`Не задано ${key}`);
  return v;
}

/**
 * Дата початку: повна дата й час ISO або 'YYYY-MM-DD' — тоді північ за часом Польщі. Зсув беремо +01:00:
 * для літнього часу це на годину раніше, а повтор фактур відсіє номер KSeF.
 */
export function parseStartFrom(value: string): string {
  const v = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+01:00` : value;
  const t = Date.parse(v);
  if (Number.isNaN(t)) throw new ConfigError(`KSEF_SYNC_FROM: не дата «${value}»`);
  return isoSeconds(t);
}

/** Файл із секретом не має бути доступний групі й іншим (на Windows права не перевіряються) */
export function checkSecretFile(path: string, platform: NodeJS.Platform = process.platform): void {
  let mode: number;
  try {
    mode = statSync(path).mode;
  } catch {
    throw new ConfigError(`Немає файла ${path}`);
  }
  if (platform !== 'win32' && (mode & 0o077) !== 0) {
    throw new ConfigError(`${path}: права ${(mode & 0o777).toString(8)}, потрібно 600 (chmod 600 ${path})`);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const ksefEnv = env.KSEF_ENV?.trim() || 'test';
  if (!ENVIRONMENTS.has(ksefEnv)) throw new ConfigError(`KSEF_ENV: «${ksefEnv}», можливі test, demo, prod`);
  const nip = required(env, 'KSEF_NIP');
  if (!/^\d{10}$/.test(nip)) throw new ConfigError('KSEF_NIP: потрібно 10 цифр');

  return {
    env: ksefEnv as KsefEnvironment,
    nip,
    certFile: required(env, 'KSEF_CERT_FILE'),
    keyFile: required(env, 'KSEF_KEY_FILE'),
    keyPassphraseFile: env.KSEF_KEY_PASSPHRASE_FILE?.trim() || undefined,
    ownerUid: required(env, 'OWNER_UID'),
    startFrom: parseStartFrom(required(env, 'KSEF_SYNC_FROM')),
  };
}
