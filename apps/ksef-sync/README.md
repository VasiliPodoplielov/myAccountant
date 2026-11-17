# ksef-sync

Сервіс синхронізації вхідних з KSeF 2.0 (етап 9 у `ROADMAP.md`). Раз на добу входить у KSeF сертифікатом,
бере нові фактури, де власник покупець (витрати) і продавець (доходи), і пише їх у
`users/{uid}/ksefInbox/{numer KSeF}` зі статусом `new`. Фактури лише читаються: сервіс нічого в KSeF не подає.

## Як працює

- **Вхід** (`api.ts`, `xades.ts`): `POST /auth/challenge` → `AuthTokenRequest`, підписаний XAdES-BES
  (enveloped, SHA-256, exc-c14n) → `POST /auth/xades-signature` → статус → `POST /auth/token/redeem`.
  Ключ EC P-256 або RSA 2048. Наприкінці сесія закривається (`DELETE /auth/sessions/current`).
- **Синхронізація** (`sync.ts`): `POST /invoices/query/metadata` за датою `PermanentStorage` з
  `restrictToPermanentStorageHwmDate`, вікна до 90 днів, сторінки по 250, обрізані відповіді продовжуються від
  останньої дати. Нові номери (яких ще немає у `ksefInbox`) завантажуються `GET /invoices/ksef/{numer}` і
  розбираються як FA(3) (`@jdg/core`, `fa.ts`). Точка продовження для кожної ролі —
  `users/{uid}/ksefSync/state` — пишеться після кожного вікна.
- **Ліміти** (`http.ts`): клієнт сам тримає темп за лімітами PROD (метадані 20 на годину, фактури 64 на
  годину), на 429 чекає `Retry-After`, тимчасові збої повторює.
- **Запис**: наявний запис ніколи не перезаписується (статус міг змінити власник). Фактура, яку не вдалося
  розібрати, теж записується — з `parseError` і XML. Якщо хеш XML не збігся з метаданими — `hashMismatch`.
- **Помилки**: запуск завершується з кодом 1 (systemd позначає його невдалим), підсумок у
  `ksefSync/state.lastRun`, деталі в journald. Сповіщення в Telegram — окремий етап 9.1 у `ROADMAP.md`.

Документація API: [github.com/CIRFMF/ksef-docs](https://github.com/CIRFMF/ksef-docs) (OpenAPI 2.9.0).

## Команди

```bash
npm run build -w @jdg/ksef-sync        # dist/main.mjs (firebase-admin лишається зовнішньою залежністю)
npm run test -w @jdg/ksef-sync         # тести; сховище — на емуляторі Firestore (потрібна JDK 21+)
npm run test:unit -w @jdg/ksef-sync    # без емулятора (тести сховища пропускаються)
```

```bash
node dist/main.mjs                          # синхронізація
node dist/main.mjs test-cert <NIP> <тека>   # самопідписаний сертифікат для TEST
node dist/main.mjs send-test-invoice        # тестова фактура на KSEF_NIP, лише KSEF_ENV=test
```

## Перевірка на середовищі TEST

TEST приймає самопідписані сертифікати, дані там спільні для всіх інтеграторів: лише вигадані NIP і суми.

1. Сертифікат для вигаданого NIP: `node dist/main.mjs test-cert 1234563218 ./test-cert`.
2. `.env` з `KSEF_ENV=test`, `KSEF_NIP` — той самий NIP, `KSEF_CERT_FILE`/`KSEF_KEY_FILE` — файли з кроку 1,
   `GOOGLE_APPLICATION_CREDENTIALS`, `OWNER_UID`, `KSEF_SYNC_FROM` — сьогоднішня дата.
3. `node --env-file=.env dist/main.mjs send-test-invoice` — продавець із випадковим NIP виставляє фактуру
   на 100,00 + 23% на `KSEF_NIP`; команда друкує номер KSeF.
4. Через кілька хвилин (поки HWM дійде до фактури) `node --env-file=.env dist/main.mjs` — у `ksefInbox`
   з'являється запис з цим номером, `role: cost`, netto 100,00, VAT 23,00.

## Розгортання на сервері (Oracle Cloud, systemd)

1. Користувач без входу: `sudo useradd --system --home /opt/jdg-ledger --shell /usr/sbin/nologin jdg`.
2. Node 22.22+; код у `/opt/jdg-ledger`: `git clone`, `npm ci`, `npm run build -w @jdg/ksef-sync`.
3. Секрети в `/etc/jdg-ledger` (тека 700, файли 600, власник `jdg`):
   - сертифікат KSeF типу `Authentication` і ключ (PEM). Сертифікат видає KSeF (застосунок MF або
     `POST /certificates/enrollments`); токени KSeF після 31.12.2026 не діють, тому вхід лише сертифікатом;
   - ключ service account Firebase (JSON). Краще окремий service account з роллю _Cloud Datastore User_,
     а не типовий адміністративний;
   - `ksef-sync.env` за зразком `deploy/ksef-sync.env.example`.
     Сервіс не стартує, якщо ключ або service account доступні групі чи іншим.
4. `sudo cp deploy/ksef-sync.service deploy/ksef-sync.timer /etc/systemd/system/`,
   `sudo systemctl daemon-reload`, `sudo systemctl enable --now ksef-sync.timer`.
5. Перший запуск вручну: `sudo systemctl start ksef-sync`, логи: `journalctl -u ksef-sync -e`.

`KSEF_SYNC_FROM` для PROD: фактури, уже внесені з JPK (етап 6), мають той самий номер KSeF у документах;
щоб не розбирати їх вдруге на екрані «Нові з KSeF» (етап 10), почніть з першого місяця, якого ще немає в обліку.
