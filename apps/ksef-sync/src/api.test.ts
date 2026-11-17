import { describe, expect, it } from 'vitest';
import { KsefAuthError, KsefClient } from './api';
import { KSEF_BASE_URL, KsefHttp } from './http';
import { createTestIdentity } from './selfSigned';
import { FakeClock, fakeFetch, json, type Call } from './testing';
import { loadIdentity } from './xades';

const NIP = '5265877635';
const id = createTestIdentity({ nip: NIP });
const identity = loadIdentity(id.certificatePem, id.privateKeyPem);
const REF = '20251010-AU-2DFC46C000-3AC6D5877F-D4';
const CHALLENGE = '20251010-CR-2DFC46C000-3AC6D5877F-D4';

function authRoutes(clock: FakeClock, statuses: number[] = [100, 200]) {
  const validUntil = (ms: number) => new Date(clock.now() + ms).toISOString();
  return {
    'POST /auth/challenge': () =>
      json({ challenge: CHALLENGE, timestamp: '2026-10-29T10:00:00Z', timestampMs: 0, clientIp: '1.2.3.4' }),
    'POST /auth/xades-signature': () =>
      json({ referenceNumber: REF, authenticationToken: { token: 'AUTH', validUntil: validUntil(600_000) } }, 202),
    'GET /auth/{ref}': statuses.map(
      (code) => () =>
        json({
          startDate: '2026-10-29T10:00:00Z',
          authenticationMethodInfo: {},
          status: { code, description: `s${code}`, details: code === 450 ? ['Nieprawidłowy token'] : null },
        }),
    ),
    'POST /auth/token/redeem': () =>
      json({
        accessToken: { token: 'ACCESS-1', validUntil: validUntil(15 * 60_000) },
        refreshToken: { token: 'REFRESH', validUntil: validUntil(7 * 86_400_000) },
      }),
    'POST /auth/token/refresh': () => json({ accessToken: { token: 'ACCESS-2', validUntil: validUntil(15 * 60_000) } }),
    'POST /invoices/query/metadata': () =>
      json({ hasMore: false, isTruncated: false, permanentStorageHwmDate: '2026-10-29T09:00:00Z', invoices: [] }),
    'GET /invoices/ksef/{n}': () => new Response('<Faktura/>'),
    'DELETE /auth/sessions/current': () => new Response(null, { status: 204 }),
  };
}

const bearer = (c: Call) => c.headers.Authorization;

describe('KsefClient', () => {
  it('authenticates with a signed AuthTokenRequest and polls until success', async () => {
    const clock = new FakeClock();
    const f = fakeFetch(authRoutes(clock));
    const client = new KsefClient(new KsefHttp(KSEF_BASE_URL.test, { fetch: f.fetch, clock }), {
      clock,
      authPollMs: 500,
    });
    await client.authenticate(identity, NIP);

    const paths = f.calls.map((c) => `${c.method} ${c.url.pathname}`);
    expect(paths).toEqual([
      'POST /v2/auth/challenge',
      'POST /v2/auth/xades-signature',
      `GET /v2/auth/${REF}`,
      `GET /v2/auth/${REF}`,
      'POST /v2/auth/token/redeem',
    ]);
    const signed = f.calls[1]!;
    expect(signed.headers['Content-Type']).toBe('application/xml');
    expect(signed.body).toContain(`<Challenge>${CHALLENGE}</Challenge>`);
    expect(signed.body).toContain(`<Nip>${NIP}</Nip>`);
    expect(signed.body).toContain('<ds:SignatureValue>');
    expect(bearer(f.calls[2]!)).toBe('Bearer AUTH');
    expect(bearer(f.calls[4]!)).toBe('Bearer AUTH');
    expect(clock.slept).toEqual([500]);
    expect(await client.accessToken()).toBe('ACCESS-1');
  });

  it('reports a failed authentication with the status from KSeF', async () => {
    const clock = new FakeClock();
    const client = new KsefClient(
      new KsefHttp(KSEF_BASE_URL.test, { fetch: fakeFetch(authRoutes(clock, [450])).fetch, clock }),
      { clock },
    );
    const err = await client.authenticate(identity, NIP).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KsefAuthError);
    expect((err as Error).message).toBe('Вхід у KSeF не вдався: 450 s450 (Nieprawidłowy token)');
  });

  it('gives up when the authentication stays in progress too long', async () => {
    const clock = new FakeClock();
    const client = new KsefClient(
      new KsefHttp(KSEF_BASE_URL.test, { fetch: fakeFetch(authRoutes(clock, [100])).fetch, clock }),
      {
        clock,
        authPollMs: 1000,
        authTimeoutMs: 3000,
      },
    );
    await expect(client.authenticate(identity, NIP)).rejects.toThrow(/вчасно/);
  });

  it('queries metadata and fetches XML with the access token, refreshing it before expiry', async () => {
    const clock = new FakeClock();
    const f = fakeFetch(authRoutes(clock, [200]));
    const client = new KsefClient(new KsefHttp(KSEF_BASE_URL.test, { fetch: f.fetch, clock }), { clock });
    await client.authenticate(identity, NIP);

    const filters = {
      subjectType: 'Subject2' as const,
      dateRange: { dateType: 'PermanentStorage' as const, from: '2026-10-01T00:00:00Z' },
    };
    await client.queryMetadata(filters, { pageOffset: 2, pageSize: 250 });
    const q = f.calls.at(-1)!;
    expect(q.url.search).toBe('?sortOrder=Asc&pageOffset=2&pageSize=250');
    expect(JSON.parse(q.body!)).toEqual(filters);
    expect(bearer(q)).toBe('Bearer ACCESS-1');

    clock.t += 14.5 * 60_000; // до кінця дії лишилося пів хвилини
    const xml = await client.invoiceXml('5265877635-20250826-0100001AF629-AF');
    expect(xml.toString()).toBe('<Faktura/>');
    const calls = f.calls.slice(-2);
    expect(calls.map((c) => c.url.pathname)).toEqual([
      '/v2/auth/token/refresh',
      '/v2/invoices/ksef/5265877635-20250826-0100001AF629-AF',
    ]);
    expect(bearer(calls[0]!)).toBe('Bearer REFRESH');
    expect(bearer(calls[1]!)).toBe('Bearer ACCESS-2');

    await client.logout();
    expect(f.calls.at(-1)!.method).toBe('DELETE');
    await expect(client.accessToken()).rejects.toThrow(/authenticate/);
  });

  it('refreshes the token after a long wait for the hourly invoice limit', async () => {
    const clock = new FakeClock();
    const f = fakeFetch(authRoutes(clock, [200]));
    const client = new KsefClient(new KsefHttp(KSEF_BASE_URL.test, { fetch: f.fetch, clock }), { clock });
    await client.authenticate(identity, NIP);
    const start = clock.now();

    // 64 фактури на годину: 65-та чекає до кінця години, коли accessToken (15 хв) уже прострочений
    for (let i = 0; i < 65; i++) await client.invoiceXml(`5265877635-20261029-${String(i).padStart(12, '0')}-AF`);
    expect(clock.now() - start).toBeGreaterThanOrEqual(3_600_000);

    const last = f.calls.at(-1)!;
    expect(last.url.pathname).toMatch(/^\/v2\/invoices\/ksef\//);
    expect(bearer(last)).toBe('Bearer ACCESS-2');
    const refresh = f.calls.findIndex((c) => c.url.pathname === '/v2/auth/token/refresh');
    expect(refresh).toBe(f.calls.length - 2);
  });
});
