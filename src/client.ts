import {
  AdaSoulsAuthError,
  AdaSoulsError,
  AdaSoulsRateLimitError,
  AdaSoulsTimeoutError,
  AdaSoulsValidationError,
} from "./errors.js";

export interface AdaSoulsClientOptions {
  apiKey: string;
  /** Defaults to the hosted production API -- override for local dev/testing against a self-run adasouls-api. */
  baseUrl?: string;
  /** Milliseconds before a request is abandoned with AdaSoulsTimeoutError. Default 20000. */
  timeoutMs?: number;
}

/**
 * Retry-After is either a number of seconds or an HTTP date (RFC 9110
 * 10.2.3). Returns the seconds to wait, or undefined when it's neither.
 */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value.trim());
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - now) / 1000));
}

/**
 * The one place that talks HTTP -- everything else in this package goes
 * through here, per REPOSITORY.md ("No business logic ... always through
 * adasouls-api"). Maps every non-2xx response to the documented error
 * taxonomy (06-api-contracts.md) rather than letting a raw fetch/HTTP
 * error escape, and never logs the API key (REPOSITORY.md's "Security
 * boundaries").
 */
export class AdaSoulsClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(options: AdaSoulsClientOptions) {
    if (!options.apiKey?.trim()) {
      throw new AdaSoulsValidationError("apiKey is required");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "https://api.adasouls.io/v1").replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 20_000;
    if (!Number.isFinite(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new AdaSoulsValidationError("timeoutMs must be a positive number");
    }
  }

  async get<T>(path: string, query?: Record<string, string | number | undefined>): Promise<T> {
    return this.request<T>("GET", path, undefined, query);
  }

  async post<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
    return this.request<T>("POST", path, body, undefined, headers);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    query?: Record<string, string | number | undefined>,
    extraHeaders?: Record<string, string>
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...extraHeaders,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      // The request may still have reached the API: a POST that timed out isn't known not to have happened.
      if ((cause as Error).name === "TimeoutError") {
        throw new AdaSoulsTimeoutError(`${method} ${path} got no response within ${this.timeoutMs} ms`);
      }
      // A network failure isn't in the documented taxonomy -- surfaced
      // as a plain AdaSoulsError rather than invented as one of the
      // HTTP-status-derived types below, which would misrepresent it.
      throw new AdaSoulsError(`network error calling AdaSouls API: ${(cause as Error).message}`);
    }

    if (response.ok) {
      const text = await this.readBody(response, method, path);
      if (text.trim() === "") return undefined as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new AdaSoulsError(`${method} ${path} answered ${response.status} with a body that isn't JSON`);
      }
    }

    return this.throwMappedError(response);
  }

  /** The body as text; a timeout while it streams in is a timeout, not a raw abort error. */
  private async readBody(response: Response, method: string, path: string): Promise<string> {
    try {
      return await response.text();
    } catch (cause) {
      if ((cause as Error).name === "TimeoutError") {
        throw new AdaSoulsTimeoutError(`${method} ${path} got no complete response within ${this.timeoutMs} ms`);
      }
      throw new AdaSoulsError(`reading the AdaSouls API's response failed: ${(cause as Error).message}`);
    }
  }

  private async throwMappedError(response: Response): Promise<never> {
    let body: { error?: string; message?: string } = {};
    try {
      body = (JSON.parse(await response.text()) ?? {}) as { error?: string; message?: string };
    } catch {
      // Empty or non-JSON error body (e.g. a proxy/gateway error page) -- fall through with just the status.
    }
    const message = body.message ?? `request failed with status ${response.status}`;

    if (response.status === 401 || response.status === 403) {
      throw new AdaSoulsAuthError(message);
    }
    if (response.status === 429) {
      throw new AdaSoulsRateLimitError(message, parseRetryAfter(response.headers.get("Retry-After")));
    }
    if (response.status === 400) {
      throw new AdaSoulsValidationError(message);
    }
    throw new AdaSoulsError(message);
  }
}
