/**
 * Виклики KSeF API 2.0, потрібні синхронізації (open-api.json з github.com/CIRFMF/ksef-docs, версія API 2.9.0):
 * вхід сертифікатом (XAdES), метадані фактур і XML фактури за номером KSeF.
 */

import { KSEF_LIMITS, RateLimiter, realClock, type Clock, type KsefHttp } from './http';
import { signAuthTokenRequest, type SigningIdentity } from './xades';

// ---------------------------------------------------------------- types (open-api.json)

export interface TokenInfo {
  token: string;
  validUntil: string;
}

export interface AuthenticationChallengeResponse {
  challenge: string;
  timestamp: string;
  timestampMs: number;
  clientIp: string;
}

export interface AuthenticationInitResponse {
  referenceNumber: string;
  authenticationToken: TokenInfo;
}

export interface StatusInfo {
  code: number;
  description: string;
  details?: string[] | null;
}

export interface AuthenticationOperationStatusResponse {
  startDate: string;
  status: StatusInfo;
}

export interface AuthenticationTokensResponse {
  accessToken: TokenInfo;
  refreshToken: TokenInfo;
}

/** Podmiot 1 — продавець, Podmiot 2 — покупець */
export type InvoiceSubjectType = 'Subject1' | 'Subject2' | 'Subject3' | 'SubjectAuthorized';

export interface InvoiceQueryFilters {
  subjectType: InvoiceSubjectType;
  dateRange: {
    dateType: 'Issue' | 'Invoicing' | 'PermanentStorage';
    from: string;
    to?: string;
    restrictToPermanentStorageHwmDate?: boolean;
  };
}

export interface InvoiceMetadata {
  ksefNumber: string;
  invoiceNumber: string;
  issueDate: string;
  invoicingDate: string;
  acquisitionDate: string;
  permanentStorageDate: string;
  seller: { nip: string; name?: string | null };
  buyer: { identifier: { type: string; value?: string | null }; name?: string | null };
  netAmount: number;
  grossAmount: number;
  vatAmount: number;
  currency: string;
  invoicingMode: string;
  invoiceType: string;
  formCode: { systemCode: string; schemaVersion: string; value: string };
  isSelfInvoicing: boolean;
  hasAttachment: boolean;
  invoiceHash: string;
}

export interface QueryInvoicesMetadataResponse {
  hasMore: boolean;
  isTruncated: boolean;
  permanentStorageHwmDate?: string | null;
  invoices: InvoiceMetadata[];
}

// ---------------------------------------------------------------- errors

export class KsefAuthError extends Error {
  override name = 'KsefAuthError';
  constructor(readonly status: StatusInfo) {
    super(
      `Вхід у KSeF не вдався: ${status.code} ${status.description}${status.details?.length ? ` (${status.details.join('; ')})` : ''}`,
    );
  }
}

// ---------------------------------------------------------------- client

export interface KsefClientOptions {
  clock?: Clock;
  /** Як часто питати статус входу і скільки чекати загалом */
  authPollMs?: number;
  authTimeoutMs?: number;
}

/** Запас до кінця дії токена, після якого його оновлюємо */
const TOKEN_MARGIN_MS = 60_000;

export class KsefClient {
  private readonly clock: Clock;
  private readonly metadataLimiter: RateLimiter;
  private readonly invoiceLimiter: RateLimiter;
  private readonly authPollMs: number;
  private readonly authTimeoutMs: number;
  private access?: TokenInfo;
  private refresh?: TokenInfo;

  constructor(
    private readonly http: KsefHttp,
    opts: KsefClientOptions = {},
  ) {
    this.clock = opts.clock ?? realClock;
    this.metadataLimiter = new RateLimiter(KSEF_LIMITS.metadata, this.clock);
    this.invoiceLimiter = new RateLimiter(KSEF_LIMITS.invoice, this.clock);
    this.authPollMs = opts.authPollMs ?? 1000;
    this.authTimeoutMs = opts.authTimeoutMs ?? 5 * 60_000;
  }

  /**
   * Вхід: challenge → підписаний AuthTokenRequest → очікування статусу 200 → пара токенів.
   * На DEMO і PROD перевірка сертифіката (OCSP/CRL) може тривати: статус 100 «в процесі» — це норма.
   */
  async authenticate(identity: SigningIdentity, nip: string): Promise<void> {
    const challenge = await this.http.json<AuthenticationChallengeResponse>('/auth/challenge', {
      method: 'POST',
    });
    const signed = signAuthTokenRequest({ challenge: challenge.challenge, nip }, identity, new Date(this.clock.now()));
    const init = await this.http.json<AuthenticationInitResponse>('/auth/xades-signature', { xml: signed });
    const authToken = init.authenticationToken.token;

    const deadline = this.clock.now() + this.authTimeoutMs;
    for (;;) {
      const st = await this.http.json<AuthenticationOperationStatusResponse>(`/auth/${init.referenceNumber}`, {
        token: authToken,
      });
      if (st.status.code === 200) break;
      if (st.status.code !== 100) throw new KsefAuthError(st.status);
      if (this.clock.now() >= deadline)
        throw new KsefAuthError({ code: 100, description: 'Вхід не завершився вчасно' });
      await this.clock.sleep(this.authPollMs);
    }

    const tokens = await this.http.json<AuthenticationTokensResponse>('/auth/token/redeem', {
      method: 'POST',
      token: authToken,
    });
    this.access = tokens.accessToken;
    this.refresh = tokens.refreshToken;
  }

  /** Чинний accessToken; за хвилину до кінця дії оновлюється refresh-токеном */
  async accessToken(): Promise<string> {
    if (!this.access || !this.refresh) throw new Error('Спершу authenticate()');
    if (Date.parse(this.access.validUntil) - this.clock.now() > TOKEN_MARGIN_MS) return this.access.token;
    const res = await this.http.json<{ accessToken: TokenInfo }>('/auth/token/refresh', {
      method: 'POST',
      token: this.refresh.token,
    });
    this.access = res.accessToken;
    return this.access.token;
  }

  async queryMetadata(
    filters: InvoiceQueryFilters,
    page: { pageOffset: number; pageSize: number },
  ): Promise<QueryInvoicesMetadataResponse> {
    return this.http.json<QueryInvoicesMetadataResponse>('/invoices/query/metadata', {
      json: filters,
      token: () => this.accessToken(),
      query: { sortOrder: 'Asc', pageOffset: page.pageOffset, pageSize: page.pageSize },
      limiter: this.metadataLimiter,
    });
  }

  /** XML фактури, як його зберігає KSeF (байти; хеш рахується від них) */
  async invoiceXml(ksefNumber: string): Promise<Buffer> {
    const res = await this.http.request(`/invoices/ksef/${encodeURIComponent(ksefNumber)}`, {
      token: () => this.accessToken(),
      accept: 'application/xml',
      limiter: this.invoiceLimiter,
    });
    return res.body;
  }

  /** Завершує сесію входу: refresh-токен перестає діяти. Помилку тут не вважаємо збоєм синхронізації */
  async logout(): Promise<void> {
    if (!this.access) return;
    try {
      await this.http.request('/auth/sessions/current', { method: 'DELETE', token: () => this.accessToken() });
    } finally {
      this.access = undefined;
      this.refresh = undefined;
    }
  }
}
