import {
  AdaSoulsAuthError,
  AdaSoulsError,
  AdaSoulsRateLimitError,
  AdaSoulsValidationError,
} from "./errors.js";

export interface AdaSoulsClientOptions {
  apiKey: string;
  /** Defaults to the hosted production API -- override for local dev/testing against a self-run adasouls-api. */
  baseUrl?: string;
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

  constructor(options: AdaSoulsClientOptions) {
    if (!options.apiKey?.trim()) {
      throw new AdaSoulsValidationError("apiKey is required");
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? "https://api.adasouls.io/v1").replace(/\/+$/, "");
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
      });
    } catch (cause) {
      // A network failure isn't in the documented taxonomy -- surfaced
      // as a plain AdaSoulsError rather than invented as one of the
      // HTTP-status-derived types below, which would misrepresent it.
      throw new AdaSoulsError(`network error calling AdaSouls API: ${(cause as Error).message}`);
    }

    if (response.ok) {
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    }

    return this.throwMappedError(response);
  }

  private async throwMappedError(response: Response): Promise<never> {
    let body: { error?: string; message?: string } = {};
    try {
      body = (await response.json()) as { error?: string; message?: string };
    } catch {
      // Non-JSON error body (e.g. a proxy/gateway error page) -- fall through with just the status.
    }
    const message = body.message ?? `request failed with status ${response.status}`;

    if (response.status === 401 || response.status === 403) {
      throw new AdaSoulsAuthError(message);
    }
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      throw new AdaSoulsRateLimitError(message, retryAfter ? Number(retryAfter) : undefined);
    }
    if (response.status === 400) {
      throw new AdaSoulsValidationError(message);
    }
    throw new AdaSoulsError(message);
  }
}
