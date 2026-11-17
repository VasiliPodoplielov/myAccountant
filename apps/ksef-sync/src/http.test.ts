import { describe, expect, it } from 'vitest';
import { errorDetail, KSEF_BASE_URL, KsefApiError, KsefHttp, RateLimiter, retryAfterMs } from './http';
import { FakeClock, fakeFetch, json } from './testing';

const BASE = KSEF_BASE_URL.test;

describe('RateLimiter', () => {
  it('waits until every sliding window has room', async () => {
    const clock = new FakeClock(0);
    const limiter = new RateLimiter(
      [
        { max: 2, ms: 1000 },
        { max: 3, ms: 60_000 },
      ],
      clock,
    );
    const at: number[] = [];
    for (let i = 0; i < 4; i++) {
      await limiter.take();
      at.push(clock.now());
    }
    // 2 на секунду, 3 на хвилину: третій чекає секунду, четвертий — до кінця хвилини від першого
    expect(at).toEqual([0, 0, 1000, 60_000]);
  });
});

describe('KsefHttp', () => {
  it('sends JSON with the bearer token and query parameters', async () => {
    const f = fakeFetch({ 'POST /invoices/query/metadata': () => json({ ok: true }) });
    const http = new KsefHttp(BASE, { fetch: f.fetch, clock: new FakeClock() });
    expect(
      await http.json('/invoices/query/metadata', {
        json: { a: 1 },
        token: 'T',
        query: { pageSize: 250, x: undefined },
      }),
    ).toEqual({
      ok: true,
    });
    const [c] = f.calls;
    expect(c!.url.toString()).toBe('https://api-test.ksef.mf.gov.pl/v2/invoices/query/metadata?pageSize=250');
    expect(c!.headers).toEqual({
      Accept: 'application/json',
      Authorization: 'Bearer T',
      'Content-Type': 'application/json',
    });
    expect(c!.body).toBe('{"a":1}');
  });

  it('waits Retry-After on 429 and then succeeds', async () => {
    const clock = new FakeClock();
    const f = fakeFetch({
      'GET /x': [
        () => json({ status: { code: 429, description: 'Too Many Requests' } }, 429, { 'Retry-After': '30' }),
        () => json({ n: 1 }),
      ],
    });
    const logs: string[] = [];
    const http = new KsefHttp(BASE, { fetch: f.fetch, clock, log: (m) => logs.push(m) });
    expect(await http.json('/x')).toEqual({ n: 1 });
    expect(clock.slept).toEqual([30_000]);
    expect(logs).toEqual(['GET /x: 429, повтор за 30 с']);
  });

  it('gives up when Retry-After is longer than allowed', async () => {
    const f = fakeFetch({ 'GET /x': () => json({}, 429, { 'Retry-After': '3600' }) });
    const http = new KsefHttp(BASE, { fetch: f.fetch, clock: new FakeClock() });
    await expect(http.request('/x')).rejects.toMatchObject({ status: 429 });
    expect(f.calls).toHaveLength(1);
  });

  it('retries transient errors with backoff and reports the API error after the last try', async () => {
    const clock = new FakeClock();
    const body = {
      exception: {
        exceptionDetailList: [{ exceptionCode: 21418, exceptionDescription: 'Błąd', details: ['szczegół'] }],
      },
    };
    const f = fakeFetch({ 'GET /x': () => json(body, 503) });
    const http = new KsefHttp(BASE, { fetch: f.fetch, clock, retries: 2 });
    const err = await http.request('/x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KsefApiError);
    expect((err as KsefApiError).message).toBe('KSeF 503 /x: 21418 Błąd szczegół');
    expect(clock.slept).toEqual([2000, 4000]);
    expect(f.calls).toHaveLength(3);
  });

  it('does not retry client errors and never puts the token into the error', async () => {
    const f = fakeFetch({ 'GET /x': () => json({ status: { code: 401, description: 'Unauthorized' } }, 401) });
    const http = new KsefHttp(BASE, { fetch: f.fetch, clock: new FakeClock() });
    const err = (await http.request('/x', { token: 'SECRET-TOKEN' }).catch((e: unknown) => e)) as Error;
    expect(err.message).toBe('KSeF 401 /x: 401 Unauthorized');
    expect(err.message).not.toContain('SECRET');
    expect(f.calls).toHaveLength(1);
  });

  it('retries network failures', async () => {
    let n = 0;
    const fetchFn = (async () => {
      if (n++ === 0) throw new Error('ECONNRESET');
      return json({ ok: 1 });
    }) as typeof fetch;
    const clock = new FakeClock();
    const http = new KsefHttp(BASE, { fetch: fetchFn, clock });
    expect(await http.json('/x')).toEqual({ ok: 1 });
    expect(clock.slept).toEqual([2000]);

    const down = new KsefHttp(BASE, {
      fetch: (async () => {
        throw new Error('ENOTFOUND');
      }) as typeof fetch,
      clock: new FakeClock(),
      retries: 1,
    });
    await expect(down.request('/x')).rejects.toThrow('KSeF 0 /x: мережа: ENOTFOUND');
  });

  it('asks for the token on every attempt, after the wait', async () => {
    const clock = new FakeClock();
    const f = fakeFetch({
      'GET /x': [() => json({}, 429, { 'Retry-After': '600' }), () => json({ ok: 1 })],
    });
    const http = new KsefHttp(BASE, { fetch: f.fetch, clock });
    const asked: number[] = [];
    await http.json('/x', {
      token: async () => {
        asked.push(clock.now());
        return `T${asked.length}`;
      },
    });
    expect(f.calls.map((c) => c.headers.Authorization)).toEqual(['Bearer T1', 'Bearer T2']);
    expect(asked[1]! - asked[0]!).toBe(600_000);
  });

  it('returns raw bytes for XML', async () => {
    const f = fakeFetch({
      'GET /invoices/ksef/{n}': () => new Response('<a>ą</a>', { headers: { 'Content-Type': 'application/xml' } }),
    });
    const http = new KsefHttp(BASE, { fetch: f.fetch, clock: new FakeClock() });
    const res = await http.request('/invoices/ksef/1', { accept: 'application/xml' });
    expect(res.body.toString('utf8')).toBe('<a>ą</a>');
    expect(f.calls[0]!.headers.Accept).toBe('application/xml');
  });
});

describe('helpers', () => {
  it('reads Retry-After in seconds or as an HTTP date', () => {
    const now = Date.parse('2026-10-29T10:00:00Z');
    expect(retryAfterMs('30', now)).toBe(30_000);
    expect(retryAfterMs('Thu, 29 Oct 2026 10:01:00 GMT', now)).toBe(60_000);
    expect(retryAfterMs(null, now)).toBeUndefined();
    expect(retryAfterMs('soon', now)).toBeUndefined();
  });

  it('extracts the error description from the known body formats', () => {
    expect(
      errorDetail(
        JSON.stringify({ status: { code: 429, description: 'Too Many Requests', details: ['Spróbuj później'] } }),
      ),
    ).toBe('429 Too Many Requests Spróbuj później');
    expect(errorDetail(JSON.stringify({ title: 'Forbidden', status: 403, detail: 'Brak uprawnień' }))).toBe(
      '403 Forbidden Brak uprawnień',
    );
    expect(errorDetail('plain text')).toBe('plain text');
  });
});
