import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const OWNER = { uid: 'owner', email: 'owner@example.com' };
const STRANGER = { uid: 'stranger', email: 'stranger@example.com' };

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-jdg-ledger',
    firestore: { rules: readFileSync(new URL('../../../firestore.rules', import.meta.url), 'utf8') },
  });
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'meta/allowlist'), { emails: [OWNER.email] });
    await setDoc(doc(ctx.firestore(), `users/${OWNER.uid}/ksefInbox/K1`), {
      status: 'new',
      seller: 'ACME',
      total: 100,
    });
  });
});

interface AsOptions {
  email?: string;
  emailVerified?: boolean;
  provider?: 'google.com' | 'password';
}

function as(
  user: { uid: string; email: string },
  { email, emailVerified = true, provider = 'google.com' }: AsOptions = {},
) {
  return env
    .authenticatedContext(user.uid, {
      email: email ?? user.email,
      email_verified: emailVerified,
      firebase: { sign_in_provider: provider },
    })
    .firestore();
}

const OWNED = [
  'settings',
  'documents',
  'fixedAssets',
  'periods',
  'filings',
  'reference',
  'vendorRules',
  'categoryOverrides',
  'fxRates',
];

describe('власник з allowlist', () => {
  it.each(OWNED)('читає й пише %s', async (collection) => {
    const ref = doc(as(OWNER), `users/${OWNER.uid}/${collection}/x`);
    await assertSucceeds(setDoc(ref, { value: 1 }));
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(updateDoc(ref, { value: 2 }));
    await assertSucceeds(deleteDoc(ref));
  });

  // хуки підписуються на колекції через onSnapshot, а це list, не get
  it.each(OWNED)('читає колекцію %s списком', async (name) => {
    await assertSucceeds(getDocs(collection(as(OWNER), `users/${OWNER.uid}/${name}`)));
  });

  // saveFxRates пише пакетами по 500 з merge; правило на кожен запис читає meta/allowlist
  it('пакет із 500 записів fxRates проходить', async () => {
    const db = as(OWNER);
    const batch = writeBatch(db);
    for (let i = 0; i < 500; i++) {
      batch.set(doc(db, `users/${OWNER.uid}/fxRates/d${i}`), { EUR: 4.2 }, { merge: true });
    }
    await assertSucceeds(batch.commit());
  });

  it('вхід з іншим регістром пошти проходить', async () => {
    const db = as(OWNER, { email: 'Owner@Example.com' });
    await assertSucceeds(setDoc(doc(db, `users/${OWNER.uid}/settings/2026`), { chorobowe: false }));
  });
});

describe('відмова', () => {
  it('неавторизований не читає й не пише', async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, `users/${OWNER.uid}/settings/2026`)));
    await assertFails(setDoc(doc(db, `users/${OWNER.uid}/settings/2026`), { a: 1 }));
  });

  it('чужий акаунт поза allowlist не бачить даних власника', async () => {
    const db = as(STRANGER);
    await assertFails(getDoc(doc(db, `users/${OWNER.uid}/documents/d1`)));
    await assertFails(setDoc(doc(db, `users/${OWNER.uid}/documents/d1`), { a: 1 }));
  });

  it('чужий акаунт поза allowlist не працює навіть у власній гілці', async () => {
    const db = as(STRANGER);
    await assertFails(setDoc(doc(db, `users/${STRANGER.uid}/documents/d1`), { a: 1 }));
    await assertFails(getDoc(doc(db, `users/${STRANGER.uid}/settings/2026`)));
  });

  it('користувач з allowlist не бачить гілку іншого uid', async () => {
    const db = as(OWNER);
    await assertFails(getDoc(doc(db, `users/${STRANGER.uid}/documents/d1`)));
    await assertFails(setDoc(doc(db, `users/${STRANGER.uid}/documents/d1`), { a: 1 }));
  });

  it('пошта з allowlist, але інший uid: гілка власника недоступна', async () => {
    const db = as({ uid: 'other-uid', email: OWNER.email });
    await assertFails(getDoc(doc(db, `users/${OWNER.uid}/documents/d1`)));
  });

  it('чужий акаунт не читає колекції списком', async () => {
    const db = as(STRANGER);
    await assertFails(getDocs(collection(db, `users/${OWNER.uid}/documents`)));
    await assertFails(getDocs(collection(db, `users/${STRANGER.uid}/documents`)));
    await assertFails(getDocs(collection(db, `users/${OWNER.uid}/ksefInbox`)));
  });

  it('токен без пошти', async () => {
    const db = env.authenticatedContext(OWNER.uid, { firebase: { sign_in_provider: 'google.com' } }).firestore();
    await assertFails(getDoc(doc(db, `users/${OWNER.uid}/settings/2026`)));
  });

  it('непідтверджена пошта', async () => {
    const db = as(OWNER, { emailVerified: false });
    await assertFails(getDoc(doc(db, `users/${OWNER.uid}/settings/2026`)));
  });

  it('вхід не через Google', async () => {
    const db = as(OWNER, { provider: 'password' });
    await assertFails(getDoc(doc(db, `users/${OWNER.uid}/settings/2026`)));
  });

  it('allowlist відсутній: відмова всім', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await deleteDoc(doc(ctx.firestore(), 'meta/allowlist'));
    });
    await assertFails(getDoc(doc(as(OWNER), `users/${OWNER.uid}/settings/2026`)));
  });

  it('allowlist без поля emails: відмова', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'meta/allowlist'), { other: 1 });
    });
    await assertFails(getDoc(doc(as(OWNER), `users/${OWNER.uid}/settings/2026`)));
  });

  it('невідома колекція користувача заборонена', async () => {
    const db = as(OWNER);
    await assertFails(setDoc(doc(db, `users/${OWNER.uid}/secrets/s1`), { a: 1 }));
    await assertFails(getDoc(doc(db, `users/${OWNER.uid}/secrets/s1`)));
  });

  it('вкладена підколекція заборонена', async () => {
    await assertFails(setDoc(doc(as(OWNER), `users/${OWNER.uid}/documents/d1/lines/l1`), { a: 1 }));
  });

  it('корінь поза users заборонений', async () => {
    await assertFails(setDoc(doc(as(OWNER), 'other/o1'), { a: 1 }));
  });
});

describe('meta/allowlist', () => {
  it('клієнт не читає й не пише, навіть власник', async () => {
    const db = as(OWNER);
    await assertFails(getDoc(doc(db, 'meta/allowlist')));
    await assertFails(setDoc(doc(db, 'meta/allowlist'), { emails: [STRANGER.email] }));
    await assertFails(updateDoc(doc(db, 'meta/allowlist'), { emails: [] }));
  });

  it('спроба змінити allowlist не відкриває доступ іншому', async () => {
    await assertFails(setDoc(doc(as(OWNER), 'meta/allowlist'), { emails: [STRANGER.email] }));
    await assertFails(getDoc(doc(as(STRANGER), `users/${STRANGER.uid}/settings/2026`)));
  });
});

describe('ksefInbox', () => {
  const ref = (db: ReturnType<typeof as>) => doc(db, `users/${OWNER.uid}/ksefInbox/K1`);

  it('власник читає', async () => {
    await assertSucceeds(getDoc(ref(as(OWNER))));
  });

  it('власник читає списком', async () => {
    await assertSucceeds(getDocs(collection(as(OWNER), `users/${OWNER.uid}/ksefInbox`)));
  });

  it.each(['accepted', 'ignored', 'new'])('власник міняє status на %s', async (status) => {
    await assertSucceeds(updateDoc(ref(as(OWNER)), { status }));
  });

  it('невідоме значення status відхиляється', async () => {
    await assertFails(updateDoc(ref(as(OWNER)), { status: 'deleted' }));
  });

  it('інші поля змінювати не можна', async () => {
    await assertFails(updateDoc(ref(as(OWNER)), { total: 1 }));
    await assertFails(updateDoc(ref(as(OWNER)), { status: 'accepted', total: 1 }));
  });

  it('нове поле разом зі status додати не можна', async () => {
    await assertFails(updateDoc(ref(as(OWNER)), { status: 'accepted', extra: true }));
  });

  it('створення й видалення клієнтом заборонені', async () => {
    const db = as(OWNER);
    await assertFails(setDoc(doc(db, `users/${OWNER.uid}/ksefInbox/K2`), { status: 'new' }));
    await assertFails(deleteDoc(ref(db)));
  });

  it('повна заміна документа клієнтом заборонена', async () => {
    await assertFails(setDoc(ref(as(OWNER)), { status: 'new', seller: 'EVIL', total: 1 }));
  });

  it('чужий акаунт не читає й не міняє', async () => {
    const db = as(STRANGER);
    await assertFails(getDoc(ref(db)));
    await assertFails(updateDoc(ref(db), { status: 'ignored' }));
  });

  it('неавторизований не читає', async () => {
    await assertFails(getDoc(ref(env.unauthenticatedContext().firestore())));
  });
});
