/**
 * Сховище синхронізації у Firestore (firebase-admin). Admin SDK обходить firestore.rules: правила лише
 * не дають клієнту писати ksefInbox (крім status) і ksefSync.
 *
 *   users/{uid}/ksefInbox/{ksefNumber}  — запис вхідних (KsefInboxItem), створюється один раз
 *   users/{uid}/ksefSync/state           — { cost?: SyncPoint, income?: SyncPoint, lastRun? }
 *   users/{uid}/vendorRules/{key}        — правила контрагентів (ключ закодовано encodeURIComponent)
 */

import type { ContractorRule, ContractorRules, KsefInboxItem, KsefRole } from '@jdg/core';
import type { Firestore } from 'firebase-admin/firestore';
import type { RoleReport, SyncPoint, SyncState, SyncStore } from './sync';

/** gRPC ALREADY_EXISTS: create() на наявному документі */
const ALREADY_EXISTS = 6;

/** getAll приймає багато посилань, але великі пакети ділимо */
const GET_ALL_CHUNK = 100;

export interface LastRun {
  at: string;
  ok: boolean;
  /** Коротко: скільки нових або текст помилки */
  summary: string;
  reports?: RoleReport[];
}

export function firestoreStore(db: Firestore, uid: string) {
  const user = db.collection('users').doc(uid);
  const inbox = user.collection('ksefInbox');
  const stateRef = user.collection('ksefSync').doc('state');

  const store: SyncStore & { saveLastRun(run: LastRun): Promise<void> } = {
    async loadState(): Promise<SyncState> {
      const data = (await stateRef.get()).data() ?? {};
      const state: SyncState = {};
      for (const role of ['cost', 'income'] as const) {
        const p = data[role] as Partial<SyncPoint> | undefined;
        if (typeof p?.from === 'string') state[role] = { from: p.from, updatedAt: String(p.updatedAt ?? '') };
      }
      return state;
    },

    async saveState(role: KsefRole, point: SyncPoint) {
      await stateRef.set({ [role]: point }, { merge: true });
    },

    async existing(ksefNumbers: string[]) {
      const found = new Set<string>();
      for (let i = 0; i < ksefNumbers.length; i += GET_ALL_CHUNK) {
        const refs = ksefNumbers.slice(i, i + GET_ALL_CHUNK).map((n) => inbox.doc(n));
        if (!refs.length) continue;
        for (const snap of await db.getAll(...refs)) if (snap.exists) found.add(snap.id);
      }
      return found;
    },

    async add(item: KsefInboxItem) {
      try {
        await inbox.doc(item.ksefNumber).create(item);
        return true;
      } catch (e) {
        if ((e as { code?: number }).code === ALREADY_EXISTS) return false;
        throw e;
      }
    },

    async vendorRules() {
      const rules: ContractorRules = {};
      for (const d of (await user.collection('vendorRules').get()).docs) {
        rules[decodeURIComponent(d.id)] = d.data() as ContractorRule;
      }
      return rules;
    },

    async saveLastRun(run: LastRun) {
      await stateRef.set({ lastRun: run }, { merge: true });
    },
  };
  return store;
}
