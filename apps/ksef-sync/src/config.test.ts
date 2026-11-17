import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkSecretFile, ConfigError, loadConfig, parseStartFrom } from './config';

const ENV = {
  KSEF_NIP: '5265877635',
  KSEF_CERT_FILE: '/etc/jdg/cert.pem',
  KSEF_KEY_FILE: '/etc/jdg/key.pem',
  OWNER_UID: 'uid-1',
  KSEF_SYNC_FROM: '2026-02-01',
};

describe('loadConfig', () => {
  it('reads the environment with TEST as the default KSeF environment', () => {
    expect(loadConfig(ENV)).toEqual({
      env: 'test',
      nip: '5265877635',
      certFile: '/etc/jdg/cert.pem',
      keyFile: '/etc/jdg/key.pem',
      keyPassphraseFile: undefined,
      ownerUid: 'uid-1',
      startFrom: '2026-01-31T23:00:00Z',
    });
    expect(loadConfig({ ...ENV, KSEF_ENV: 'prod' }).env).toBe('prod');
  });

  it('rejects missing or malformed values', () => {
    expect(() => loadConfig({ ...ENV, KSEF_NIP: '' })).toThrow('Не задано KSEF_NIP');
    expect(() => loadConfig({ ...ENV, KSEF_NIP: '52-658' })).toThrow(/10 цифр/);
    expect(() => loadConfig({ ...ENV, KSEF_ENV: 'production' })).toThrow(/test, demo, prod/);
    expect(() => loadConfig({ ...ENV, OWNER_UID: undefined })).toThrow(/OWNER_UID/);
    expect(() => loadConfig({ ...ENV, KSEF_SYNC_FROM: 'luty' })).toThrow(ConfigError);
  });
});

describe('parseStartFrom', () => {
  it('treats a bare date as Polish midnight and keeps full timestamps', () => {
    expect(parseStartFrom('2026-02-01')).toBe('2026-01-31T23:00:00Z');
    expect(parseStartFrom('2026-10-01T06:00:00+02:00')).toBe('2026-10-01T04:00:00Z');
  });
});

describe('checkSecretFile', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ksef-'));

  it('requires the file to exist', () => {
    expect(() => checkSecretFile(join(dir, 'missing.pem'))).toThrow(/Немає файла/);
  });

  it.runIf(process.platform !== 'win32')('rejects a key readable by group or others', () => {
    const f = join(dir, 'key.pem');
    writeFileSync(f, 'x');
    chmodSync(f, 0o644);
    expect(() => checkSecretFile(f)).toThrow(/600/);
    chmodSync(f, 0o600);
    expect(() => checkSecretFile(f)).not.toThrow();
  });

  it('does not check permissions on Windows', () => {
    const f = join(dir, 'win.pem');
    writeFileSync(f, 'x');
    expect(() => checkSecretFile(f, 'win32')).not.toThrow();
  });
});
