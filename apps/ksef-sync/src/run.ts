/**
 * Один запуск синхронізації: вхід у KSeF, синхронізація ролей, вихід, підсумок у ksefSync/state.lastRun.
 * Помилку повертає як невдалий підсумок: main завершується з кодом 1, і systemd позначає запуск невдалим.
 */

import type { KsefClient } from './api';
import type { LastRun } from './firestore';
import { syncKsef, type RoleReport, type SyncStore } from './sync';
import type { SigningIdentity } from './xades';

export interface RunDeps {
  client: Pick<KsefClient, 'authenticate' | 'logout' | 'queryMetadata' | 'invoiceXml'>;
  store: SyncStore & { saveLastRun(run: LastRun): Promise<void> };
  identity: SigningIdentity;
  nip: string;
  startFrom: string;
  now?: () => Date;
  log?: (message: string) => void;
  /** Мітка середовища в логах: test, demo, prod */
  env: string;
}

const ROLE_NAME = { cost: 'витрати', income: 'доходи' } as const;

export function summarize(reports: RoleReport[]): string {
  return reports
    .map((r) => {
      const extra = [
        r.unparsed.length ? `не розібрано ${r.unparsed.length}` : '',
        r.hashMismatch.length ? `хеш не збігся ${r.hashMismatch.length}` : '',
      ].filter((x) => x);
      return `${ROLE_NAME[r.role]}: нових ${r.added} з ${r.found}${extra.length ? ` (${extra.join(', ')})` : ''}`;
    })
    .join('; ');
}

export async function runOnce(deps: RunDeps): Promise<LastRun> {
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  let run: LastRun;
  try {
    await deps.client.authenticate(deps.identity, deps.nip);
    let reports: RoleReport[];
    try {
      reports = await syncKsef(deps.client, deps.store, { startFrom: deps.startFrom, now, log });
    } finally {
      await deps.client.logout().catch((e: unknown) => log(`Вихід з KSeF: ${(e as Error).message}`));
    }
    run = { at: now().toISOString(), ok: true, summary: summarize(reports), reports };
    log(`KSeF ${deps.env}: ${run.summary}`);
  } catch (e) {
    const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    run = { at: now().toISOString(), ok: false, summary: message };
    log(`KSeF ${deps.env}: помилка синхронізації: ${message}`);
  }
  await deps.store.saveLastRun(run).catch((e: unknown) => log(`Запис lastRun: ${(e as Error).message}`));
  return run;
}
