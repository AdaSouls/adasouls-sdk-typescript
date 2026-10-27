import { describe, expect, it, vi, afterEach } from "vitest";
import { AdaSoulsClient, parseRetryAfter } from "../src/client.js";
import { AdaSoulsAuthError, AdaSoulsValidationError, AdaSoulsError, AdaSoulsRateLimitError, AdaSoulsTimeoutError } from "../src/errors.js";

function mockFetchOnce(status: number, body: unknown, headers: Record<string, string> = {}) {
  const response = new Response(JSON.stringify(body), { status, headers });
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(response);
}

describe("AdaSoulsClient", () => {
  afterEach(() => vi.restoreAllMocks());

  it("requires an apiKey", () => {
    expect(() => new AdaSoulsClient({ apiKey: "" })).toThrow(AdaSoulsValidationError);
  });

  it("sends the Bearer header and parses a 2xx JSON body", async () => {
    mockFetchOnce(200, { hello: "world" });
    const client = new AdaSoulsClient({ apiKey: "ak_test", baseUrl: "http://localhost:3000/v1" });

    const result = await client.get<{ hello: string }>("/whatever");

    expect(result).toEqual({ hello: "world" });
    const call = vi.mocked(fetch).mock.calls[0];
    expect(call[0].toString()).toBe("http://localhost:3000/v1/whatever");
    expect((call[1]?.headers as Record<string, string>).Authorization).toBe("Bearer ak_test");
  });

  it("maps 401 to AdaSoulsAuthError", async () => {
    mockFetchOnce(401, { error: "unauthorized", message: "missing Bearer token" });
    const client = new AdaSoulsClient({ apiKey: "ak_test" });
    await expect(client.get("/x")).rejects.toThrow(AdaSoulsAuthError);
  });

  it("maps 429 to AdaSoulsRateLimitError, carrying Retry-After", async () => {
    mockFetchOnce(429, { error: "rate_limited", message: "slow down" }, { "Retry-After": "30" });
    const client = new AdaSoulsClient({ apiKey: "ak_test" });

    await expect(client.get("/x")).rejects.toMatchObject({ retryAfterSeconds: 30 });
  });

  it("maps 400 to AdaSoulsValidationError", async () => {
    mockFetchOnce(400, { error: "validation_error", message: "capability: must be a non-empty string" });
    const client = new AdaSoulsClient({ apiKey: "ak_test" });
    await expect(client.get("/x")).rejects.toThrow(AdaSoulsValidationError);
  });

  it("maps an unrecognized status to the generic AdaSoulsError, not a crash", async () => {
    mockFetchOnce(503, { error: "internal_error", message: "down for maintenance" });
    const client = new AdaSoulsClient({ apiKey: "ak_test" });
    await expect(client.get("/x")).rejects.toThrow(AdaSoulsError);
  });

  it("sends query params and JSON body correctly on post()", async () => {
    mockFetchOnce(201, { id: "eco_1" });
    const client = new AdaSoulsClient({ apiKey: "ak_test", baseUrl: "http://localhost:3000/v1" });

    await client.post("/economic-actions", { capability: "pay" }, { "Idempotency-Key": "idem_1" });

    const call = vi.mocked(fetch).mock.calls[0];
    expect(call[1]?.body).toBe(JSON.stringify({ capability: "pay" }));
    const headers = call[1]?.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("idem_1");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("reads Retry-After as an HTTP date too", async () => {
    const at = new Date(Date.now() + 90_000).toUTCString();
    mockFetchOnce(429, { message: "slow down" }, { "Retry-After": at });
    const err = await new AdaSoulsClient({ apiKey: "ak_test" }).get("/x").catch((e) => e);
    expect(err).toBeInstanceOf(AdaSoulsRateLimitError);
    expect(err.retryAfterSeconds).toBeGreaterThanOrEqual(88);
    expect(err.retryAfterSeconds).toBeLessThanOrEqual(90);

    expect(parseRetryAfter("Wed, 21 Oct 2015 07:28:00 GMT", Date.parse("Wed, 21 Oct 2015 07:27:00 GMT"))).toBe(60);
    expect(parseRetryAfter("Wed, 21 Oct 2015 07:28:00 GMT", Date.parse("Wed, 21 Oct 2015 08:00:00 GMT"))).toBe(0);
    expect(parseRetryAfter("soon")).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });

  it("an empty 2xx body is undefined, and a non-JSON one a typed error, never a raw SyntaxError", async () => {
    const client = new AdaSoulsClient({ apiKey: "ak_test" });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 200 }));
    expect(await client.post("/x")).toBeUndefined();

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("<html>ok</html>", { status: 200 }));
    const err = await client.get("/x").catch((e) => e);
    expect(err).toBeInstanceOf(AdaSoulsError);
    expect(err).not.toBeInstanceOf(SyntaxError);
  });

  it("an empty error body keeps its status mapping", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("", { status: 403 }));
    await expect(new AdaSoulsClient({ apiKey: "ak_test" }).get("/x")).rejects.toThrow(AdaSoulsAuthError);
  });

  it("gives up after timeoutMs with AdaSoulsTimeoutError", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(
      (_url, init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
        })
    );
    const client = new AdaSoulsClient({ apiKey: "ak_test", timeoutMs: 20 });
    await expect(client.post("/economic-actions", {})).rejects.toThrow(AdaSoulsTimeoutError);
    expect(() => new AdaSoulsClient({ apiKey: "ak_test", timeoutMs: 0 })).toThrow(AdaSoulsValidationError);
  });
});
