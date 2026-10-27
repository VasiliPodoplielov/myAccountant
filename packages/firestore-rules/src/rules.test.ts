import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
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

// documents, periods і locks мають окремі правила (закриті місяці) і окремі тести нижче
const OWNED = ['settings', 'fixedAssets', 'filings', 'reference', 'vendorRules', 'categoryOverrides', 'fxRates'];

describe('власник з allowlist', () => {
  it.each(OWNED)('читає й пише %s', async (collection) => {
    const ref = doc(as(OWNER), `users/${OWNER.uid}/${collection}/x`);
    await assertSucceeds(setDoc(ref, { value: 1 }));
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(updateDoc(ref, { value: 2 }));
    await assertSucceeds(deleteDoc(ref));
  });

  // хуки підписуються на колекції через onSnapshot, а це list, не get
  it.each([...OWNED, 'documents', 'periods'])('читає колекцію %s списком', async (name) => {
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

const LOCK = `users/${OWNER.uid}/locks/periods`;

describe('documents і закриті місяці', () => {
  const docPath = (id: string) => `users/${OWNER.uid}/documents/${id}`;
  const base = { kind: 'cost', number: 'F/1', issueDate: '2026-02-10', source: 'manual' };
  const stamped = (...touchedPeriods: string[]) => ({ ...base, touchedPeriods });

  /** Стан місяців (periods і locks/periods) і документи до перевірки, в обхід правил */
  async function seed(periods: Record<string, 'open' | 'closed'>, docs: Record<string, object> = {}) {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      for (const [p, status] of Object.entries(periods)) {
        await setDoc(doc(db, `users/${OWNER.uid}/periods/${p}`), { status, confirmations: {} });
      }
      if (Object.keys(periods).length > 0) {
        const closed = Object.entries(periods)
          .filter(([, s]) => s === 'closed')
          .map(([p]) => p);
        await setDoc(doc(db, LOCK), { closed: arrayUnion(...closed) }, { merge: true });
        const open = Object.entries(periods)
          .filter(([, s]) => s === 'open')
          .map(([p]) => p);
        if (open.length > 0) await setDoc(doc(db, LOCK), { closed: arrayRemove(...open) }, { merge: true });
      }
      for (const [id, data] of Object.entries(docs)) await setDoc(doc(db, docPath(id)), data);
    });
  }

  describe('відкриті місяці', () => {
    it('власник створює, читає, змінює й видаляє документ', async () => {
      await seed({ '2026-02': 'open' });
      const ref = doc(as(OWNER), docPath('d1'));
      await assertSucceeds(setDoc(ref, stamped('2026-02')));
      await assertSucceeds(getDoc(ref));
      await assertSucceeds(setDoc(ref, { ...stamped('2026-03'), number: 'F/2' }));
      await assertSucceeds(deleteDoc(ref));
    });

    it('місяць без запису periods відкритий', async () => {
      await assertSucceeds(setDoc(doc(as(OWNER), docPath('d1')), stamped('2026-02', '2026-03', '2026-04')));
    });

    it('без touchedPeriods документ не записується', async () => {
      await assertFails(setDoc(doc(as(OWNER), docPath('d1')), base));
    });

    it.each([
      ['порожній список', []],
      ['чотири місяці', ['2026-01', '2026-02', '2026-03', '2026-04']],
      ['не місяць', ['2026-13']],
      ['дата замість місяця', ['2026-02-10']],
      ['шлях', ['2026-02/x']],
      ['число', [202602]],
    ])('некоректний touchedPeriods (%s) відхиляється', async (_label, touchedPeriods) => {
      await assertFails(setDoc(doc(as(OWNER), docPath('d1')), { ...base, touchedPeriods }));
    });

    it('touchedPeriods не можна прибрати при зміні', async () => {
      await seed({}, { d1: stamped('2026-02') });
      await assertFails(setDoc(doc(as(OWNER), docPath('d1')), { ...base, number: 'F/2' }));
    });
  });

  describe('закритий місяць', () => {
    beforeEach(async () => {
      await seed(
        { '2026-01': 'closed', '2026-02': 'open' },
        { jan: stamped('2026-01'), cross: stamped('2026-01', '2026-02') },
      );
    });

    it('новий документ у закритий місяць не створюється', async () => {
      await assertFails(setDoc(doc(as(OWNER), docPath('d1')), stamped('2026-01')));
    });

    it('не створюється, навіть якщо закритий лише один з місяців (VAT)', async () => {
      await assertFails(setDoc(doc(as(OWNER), docPath('d1')), stamped('2026-02', '2026-01')));
    });

    it('третій місяць (оплата) теж перевіряється', async () => {
      await assertFails(setDoc(doc(as(OWNER), docPath('d1')), stamped('2026-02', '2026-03', '2026-01')));
    });

    it('документ закритого місяця не видаляється', async () => {
      await assertFails(deleteDoc(doc(as(OWNER), docPath('jan'))));
      await assertFails(deleteDoc(doc(as(OWNER), docPath('cross'))));
    });

    it('документ закритого місяця не змінюється', async () => {
      await assertFails(updateDoc(doc(as(OWNER), docPath('jan')), { number: 'F/9' }));
      await assertFails(setDoc(doc(as(OWNER), docPath('cross')), { ...stamped('2026-01', '2026-02'), number: 'F/9' }));
    });

    it('документ не переноситься з закритого місяця у відкритий', async () => {
      await assertFails(setDoc(doc(as(OWNER), docPath('jan')), { ...stamped('2026-02'), issueDate: '2026-02-01' }));
    });

    it('документ відкритого місяця не переноситься в закритий', async () => {
      await seed({}, { feb: stamped('2026-02') });
      await assertFails(setDoc(doc(as(OWNER), docPath('feb')), { ...stamped('2026-01'), issueDate: '2026-01-05' }));
    });

    it('повторний запис без змін (повторний імпорт) дозволено', async () => {
      await assertSucceeds(setDoc(doc(as(OWNER), docPath('jan')), stamped('2026-01')));
    });

    it('документ відкритого місяця змінюється й видаляється, поки сусідній закритий', async () => {
      await seed({}, { feb: stamped('2026-02') });
      await assertSucceeds(updateDoc(doc(as(OWNER), docPath('feb')), { number: 'F/3' }));
      await assertSucceeds(deleteDoc(doc(as(OWNER), docPath('feb'))));
    });

    it('після повторного відкриття документ знову змінюється', async () => {
      await seed({ '2026-01': 'open' });
      await assertSucceeds(updateDoc(doc(as(OWNER), docPath('jan')), { number: 'F/9' }));
      await assertSucceeds(deleteDoc(doc(as(OWNER), docPath('cross'))));
    });

    it('locks/periods без поля closed: закритих місяців немає', async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), LOCK), {});
      });
      await assertSucceeds(setDoc(doc(as(OWNER), docPath('d1')), stamped('2026-01')));
    });

    it('закритий місяць іншого користувача не впливає на власника', async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), `users/${STRANGER.uid}/locks/periods`), { closed: ['2026-02'] });
      });
      await assertSucceeds(setDoc(doc(as(OWNER), docPath('d1')), stamped('2026-02')));
    });

    it('пакет імпорту з одним документом у закритому місяці відхиляється цілком', async () => {
      const db = as(OWNER);
      const batch = writeBatch(db);
      batch.set(doc(db, docPath('ok')), stamped('2026-02'));
      batch.set(doc(db, docPath('bad')), stamped('2026-01'));
      await assertFails(batch.commit());
      await env.withSecurityRulesDisabled(async (ctx) => {
        const snap = await getDoc(doc(ctx.firestore(), docPath('ok')));
        if (snap.exists()) throw new Error('частину пакета записано');
      });
    });
  });

  describe('документи без touchedPeriods (записані до правила)', () => {
    beforeEach(async () => {
      await seed({ '2026-01': 'closed' }, { legacy: base });
    });

    it('можна дописати touchedPeriods, навіть у закритому місяці', async () => {
      await assertSucceeds(updateDoc(doc(as(OWNER), docPath('legacy')), { touchedPeriods: ['2026-01'] }));
    });

    it('разом з полем змінити інше не можна, якщо місяць закритий', async () => {
      await assertFails(updateDoc(doc(as(OWNER), docPath('legacy')), { touchedPeriods: ['2026-01'], number: 'X' }));
    });

    it('дописане поле одразу захищає документ', async () => {
      await updateDoc(doc(as(OWNER), docPath('legacy')), { touchedPeriods: ['2026-01'] });
      await assertFails(deleteDoc(doc(as(OWNER), docPath('legacy'))));
      await assertFails(updateDoc(doc(as(OWNER), docPath('legacy')), { touchedPeriods: ['2026-02'] }));
    });

    it('некоректне поле не дописується', async () => {
      await assertFails(updateDoc(doc(as(OWNER), docPath('legacy')), { touchedPeriods: [] }));
    });

    it('без поля документ не захищений: видалення проходить', async () => {
      await assertSucceeds(deleteDoc(doc(as(OWNER), docPath('legacy'))));
    });
  });

  describe('ліміти звернень правил', () => {
    // найгірший випадок одного запису: allowlist + три старі й три нові місяці, усі з записом periods
    it('перенесення документа між шістьма різними місяцями вкладається в ліміт', async () => {
      const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'];
      await seed(Object.fromEntries(months.map((m) => [m, 'open'])), { d1: stamped(...months.slice(0, 3)) });
      await assertSucceeds(setDoc(doc(as(OWNER), docPath('d1')), { ...stamped(...months.slice(3)), number: 'F/2' }));
    });

    // відновлення бекапу року: документи з місяцями від грудня попереднього року до січня наступного
    it('пакет документів чотирнадцяти місяців вкладається в ліміт', async () => {
      const months = [
        '2025-12',
        ...Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`),
        '2027-01',
      ];
      await seed(Object.fromEntries(months.map((m) => [m, 'open'])));
      const db = as(OWNER);
      const batch = writeBatch(db);
      months.forEach((m, i) => batch.set(doc(db, docPath(`d${i}`)), stamped(m)));
      await assertSucceeds(batch.commit());
    });
  });

  describe('стан місяця periods і locks/periods', () => {
    const periodRef = (db: ReturnType<typeof as>, p: string) => doc(db, `users/${OWNER.uid}/periods/${p}`);
    const closeBatch = (db: ReturnType<typeof as>, p: string) => {
      const batch = writeBatch(db);
      batch.set(periodRef(db, p), { status: 'closed', confirmations: {}, closedAt: '2026-02-05T10:00:00Z' });
      batch.set(doc(db, LOCK), { closed: arrayUnion(p) }, { merge: true });
      return batch;
    };
    const reopenBatch = (db: ReturnType<typeof as>, p: string) => {
      const batch = writeBatch(db);
      batch.set(periodRef(db, p), { status: 'open', confirmations: {} });
      batch.set(doc(db, LOCK), { closed: arrayRemove(p) }, { merge: true });
      return batch;
    };

    it('закриття: стан місяця й список закритих одним пакетом', async () => {
      await assertSucceeds(closeBatch(as(OWNER), '2026-01').commit());
      await assertFails(setDoc(doc(as(OWNER), docPath('d1')), stamped('2026-01')));
    });

    it('відкриття знову: обидва одним пакетом', async () => {
      await seed({ '2026-01': 'closed' });
      await assertSucceeds(reopenBatch(as(OWNER), '2026-01').commit());
      await assertSucceeds(setDoc(doc(as(OWNER), docPath('d1')), stamped('2026-01')));
    });

    it('закрити місяць без locks/periods не можна', async () => {
      await assertFails(setDoc(periodRef(as(OWNER), '2026-01'), { status: 'closed', confirmations: {} }));
    });

    it('відкрити місяць, лишивши його в locks/periods, не можна', async () => {
      await seed({ '2026-01': 'closed' });
      await assertFails(setDoc(periodRef(as(OWNER), '2026-01'), { status: 'open', confirmations: {} }));
      await assertFails(deleteDoc(periodRef(as(OWNER), '2026-01')));
    });

    it('відкритий місяць не можна записати, якщо він у locks/periods', async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), LOCK), { closed: ['2026-03'] });
      });
      await assertFails(
        setDoc(periodRef(as(OWNER), '2026-03'), { status: 'open', confirmations: { documents: true } }),
      );
    });

    it('підтвердження чекліста відкритого місяця пишуться', async () => {
      await seed({ '2026-02': 'open' });
      await assertSucceeds(
        setDoc(periodRef(as(OWNER), '2026-02'), { status: 'open', confirmations: { documents: true } }),
      );
      await assertSucceeds(setDoc(periodRef(as(OWNER), '2026-04'), { status: 'open', confirmations: { ksef: true } }));
    });

    it('невідомий стан чи id не місяця відхиляються', async () => {
      await assertFails(setDoc(periodRef(as(OWNER), '2026-02'), { status: 'locked', confirmations: {} }));
      await assertFails(setDoc(periodRef(as(OWNER), '2026-02'), { confirmations: {} }));
      await assertFails(setDoc(periodRef(as(OWNER), 'x'), { status: 'open', confirmations: {} }));
    });

    it('locks/periods: closed має бути списком', async () => {
      await assertFails(setDoc(doc(as(OWNER), LOCK), { closed: '2026-01' }));
      await assertSucceeds(setDoc(doc(as(OWNER), LOCK), { closed: [] }));
    });

    it('інші документи в locks заборонені', async () => {
      await assertFails(setDoc(doc(as(OWNER), `users/${OWNER.uid}/locks/other`), { closed: [] }));
    });

    it('чужий акаунт не читає й не пише стан місяців', async () => {
      await seed({ '2026-01': 'closed' });
      const db = as(STRANGER);
      await assertFails(getDoc(periodRef(db, '2026-01')));
      await assertFails(getDoc(doc(db, LOCK)));
      await assertFails(reopenBatch(db, '2026-01').commit());
    });
  });

  it('чужий акаунт не читає й не пише документи', async () => {
    await seed({}, { d1: stamped('2026-02') });
    const db = as(STRANGER);
    await assertFails(getDoc(doc(db, docPath('d1'))));
    await assertFails(setDoc(doc(db, docPath('d2')), stamped('2026-02')));
    await assertFails(deleteDoc(doc(db, docPath('d1'))));
  });

  it('неавторизований не пише документи', async () => {
    await assertFails(setDoc(doc(env.unauthenticatedContext().firestore(), docPath('d2')), stamped('2026-02')));
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
