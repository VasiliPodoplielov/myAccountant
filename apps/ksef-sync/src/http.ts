/**
 * HTTP до KSeF API 2.0: повтори на 429 (за Retry-After) і на тимчасових збоях, обмеження темпу запитів
 * за лімітами з limity/limity-api.md, помилки з кодом і описом від API. Токенів у логи й помилки не пишемо.
 */

export type KsefEnvironment = 'test' | 'demo' | 'prod';

/** srodowiska.md: адреси API для кожного середовища */
export const KSEF_BASE_URL: Record<KsefEnvironment, string> = {
  test: 'https://api-test.ksef.mf.gov.pl/v2',
  demo: 'https://api-demo.ksef.mf.gov.pl/v2',
  prod: 'https://api.ksef.mf.gov.pl/v2',
};

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

/** ISO 8601 до секунд з Z: такий формат дат наводить документація KSeF */
export const isoSeconds = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export class KsefApiError extends Error {
  override name = 'KsefApiError';
  constructor(
    readonly status: number,
    readonly path: string,
    readonly detail: string,
  ) {
    super(`KSeF ${status} ${path}: ${detail}`);
  }
}

// ---------------------------------------------------------------- rate limiting

export interface RateWindow {
  max: number;
  ms: number;
}

/** Ліміт у ковзному вікні: перед запитом чекає, доки в кожному вікні буде місце */
export class RateLimiter {
  private readonly calls: number[] = [];
  constructor(
    private readonly windows: RateWindow[],
    private readonly clock: Clock,
  ) {}

  async take(): Promise<void> {
    for (;;) {
      const now = this.clock.now();
      const longest = Math.max(...this.windows.map((w) => w.ms));
      while (this.calls.length && this.calls[0]! <= now - longest) this.calls.shift();
      let wait = 0;
      for (const w of this.windows) {
        const inWindow = this.calls.filter((t) => t > now - w.ms);
        if (inWindow.length >= w.max) wait = Math.max(wait, inWindow[inWindow.length - w.max]! + w.ms - now);
      }
      if (wait <= 0) {
        this.calls.push(now);
        return;
      }
      await this.clock.sleep(wait);
    }
  }
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** Ліміти PROD з limity-api.md («Pobieranie faktur - limity»); на TEST вони вдесятеро вищі */
export const KSEF_LIMITS = {
  metadata: [
    { max: 8, ms: SECOND },
    { max: 16, ms: MINUTE },
    { max: 20, ms: HOUR },
  ],
  invoice: [
    { max: 8, ms: SECOND },
    { max: 16, ms: MINUTE },
    { max: 64, ms: HOUR },
  ],
} satisfies Record<string, RateWindow[]>;

// ---------------------------------------------------------------- requests

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  /**
   * Bearer: authenticationToken, accessToken або refreshToken. Функція викликається перед кожною спробою,
   * уже після очікування ліміту, тож довге очікування не залишає запит із простроченим токеном.
   */
  token?: string | (() => Promise<string>);
  query?: Record<string, string | number | boolean | undefined>;
  json?: unknown;
  xml?: string;
  accept?: 'application/json' | 'application/xml';
  limiter?: RateLimiter;
}

export interface HttpResponse {
  status: number;
  headers: Headers;
  body: Buffer;
}

export interface HttpOptions {
  fetch?: typeof fetch;
  clock?: Clock;
  /** Скільки разів повторювати 429 і тимчасові збої */
  retries?: number;
  /** Довше за це на Retry-After не чекаємо: запуск завершиться помилкою, наступний спробує знову */
  maxRetryAfterMs?: number;
  log?: (message: string) => void;
}

/** Retry-After у секундах або датою HTTP */
export function retryAfterMs(header: string | null, now: number): number | undefined {
  if (!header) return undefined;
  const s = Number(header);
  if (Number.isFinite(s)) return Math.max(0, s * 1000);
  const t = Date.parse(header);
  return Number.isNaN(t) ? undefined : Math.max(0, t - now);
}

/** Опис помилки з тіла відповіді: ExceptionResponse, StatusInfo або Problem Details */
export function errorDetail(body: string): string {
  try {
    const j = JSON.parse(body) as Record<string, unknown>;
    const exc = j.exception as
      | { exceptionDetailList?: { exceptionCode?: number; exceptionDescription?: string; details?: string[] }[] }
      | undefined;
    const list = exc?.exceptionDetailList;
    if (list?.length) {
      return list
        .map((d) =>
          [d.exceptionCode, d.exceptionDescription, d.details?.join('; ')]
            .filter((x) => x !== undefined && x !== '')
            .join(' '),
        )
        .join(' | ');
    }
    const status = j.status as { code?: number; description?: string; details?: string[] } | undefined;
    if (status?.description)
      return [status.code, status.description, status.details?.join('; ')].filter((x) => x).join(' ');
    if (typeof j.title === 'string') return [j.status, j.title, j.detail].filter((x) => x).join(' ');
  } catch {
    // не JSON
  }
  return body.slice(0, 300);
}

const TRANSIENT = new Set([500, 502, 503, 504]);

export class KsefHttp {
  private readonly fetchFn: typeof fetch;
  private readonly clock: Clock;
  private readonly retries: number;
  private readonly maxRetryAfterMs: number;
  private readonly log: (message: string) => void;

  constructor(
    private readonly baseUrl: string,
    opts: HttpOptions = {},
  ) {
    this.fetchFn = opts.fetch ?? fetch;
    this.clock = opts.clock ?? realClock;
    this.retries = opts.retries ?? 3;
    this.maxRetryAfterMs = opts.maxRetryAfterMs ?? 15 * MINUTE;
    this.log = opts.log ?? (() => {});
  }

  url(path: string, query?: RequestOptions['query']): string {
    const u = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) u.searchParams.set(k, String(v));
    return u.toString();
  }

  async request(path: string, opts: RequestOptions = {}): Promise<HttpResponse> {
    const headers: Record<string, string> = { Accept: opts.accept ?? 'application/json' };
    let body: string | undefined;
    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.json);
    } else if (opts.xml !== undefined) {
      headers['Content-Type'] = 'application/xml';
      body = opts.xml;
    }
    const method = opts.method ?? (body === undefined ? 'GET' : 'POST');
    const url = this.url(path, opts.query);

    for (let attempt = 0; ; attempt++) {
      await opts.limiter?.take();
      // токен — після очікування ліміту й паузи повтору: вони можуть пережити accessToken (~15 хв)
      const token = typeof opts.token === 'function' ? await opts.token() : opts.token;
      const attemptHeaders = token ? { ...headers, Authorization: `Bearer ${token}` } : headers;
      let res: Response;
      try {
        res = await this.fetchFn(url, { method, headers: attemptHeaders, body });
      } catch (e) {
        if (attempt >= this.retries) throw new KsefApiError(0, path, `мережа: ${(e as Error).message}`);
        const wait = 2 ** attempt * 2 * SECOND;
        this.log(`${method} ${path}: мережа (${(e as Error).message}), повтор за ${wait / 1000} с`);
        await this.clock.sleep(wait);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (res.ok) return { status: res.status, headers: res.headers, body: buf };

      const detail = errorDetail(buf.toString('utf8'));
      if (attempt < this.retries && (res.status === 429 || TRANSIENT.has(res.status))) {
        const wait =
          res.status === 429
            ? (retryAfterMs(res.headers.get('Retry-After'), this.clock.now()) ?? MINUTE)
            : 2 ** attempt * 2 * SECOND;
        if (wait <= this.maxRetryAfterMs) {
          this.log(`${method} ${path}: ${res.status}, повтор за ${Math.ceil(wait / 1000)} с`);
          await this.clock.sleep(wait);
          continue;
        }
      }
      throw new KsefApiError(res.status, path, detail);
    }
  }

  async json<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const res = await this.request(path, opts);
    if (res.status === 204 || res.body.length === 0) return undefined as T;
    return JSON.parse(res.body.toString('utf8')) as T;
  }
}
