import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Agent } from "../src/agent.js";
import type { AdaSoulsClient } from "../src/client.js";
import { AdaSoulsApprovalPending, AdaSoulsPolicyError } from "../src/errors.js";
import {
  AuthorizationTooOldError,
  GuardedWalletMismatchError,
  PaymentInDoubtError,
  PaymentNotReportedError,
  PaymentNotSentError,
  erc20Transfer,
  type GuardedWalletOptions,
  type SendPayment,
} from "../src/guarded-wallet.js";
import { FilePaymentStore, type PaymentStore } from "../src/payment-store.js";
import type { EconomicAction } from "../src/types.js";

const TO = "0x1111111111111111111111111111111111111111";
const plan = (over: Record<string, unknown> = {}) => ({ mode: "self", chain: "base-sepolia", from: "0xfrom", to: TO, amount: "10", asset: "USDC", ...over });

function action(over: Partial<EconomicAction> = {}): EconomicAction {
  return {
    id: "eco_1",
    principalId: "alma:main:organization:acme",
    agentId: "agent_1",
    intent: { capability: "pay", amount: "10", asset: "USDC", to: TO },
    capability: "pay",
    authority: { delegationId: "del_1", policySnapshot: [] },
    status: "authorized",
    needsReconciliation: false,
    createdAt: new Date().toISOString(),
    executionPlan: plan(),
    ...over,
  } as EconomicAction;
}

/** A client whose POST answers by path, and whose GET returns the action as confirmed. */
function wallet(posts: Record<string, unknown>, send = vi.fn().mockResolvedValue("0xabc"), get = vi.fn().mockResolvedValue(action({ status: "confirmed" }))) {
  const post = vi.fn(async (path: string) => {
    const hit = Object.entries(posts).find(([p]) => path.endsWith(p));
    if (!hit) throw new Error(`unexpected POST ${path}`);
    if (hit[1] instanceof Error) throw hit[1];
    return hit[1];
  });
  const client = { get, post } as unknown as AdaSoulsClient;
  const agent = new Agent(client, "agent_1");
  return { wallet: agent.guardedWallet(send, { waitOptions: { intervalMs: 1 } }), send, post, get };
}

describe("GuardedWallet", () => {
  it("authorizes, sends exactly what was authorized, reports it, and waits for the check", async () => {
    const { wallet: w, send, post } = wallet({ "/economic-actions": action(), "/payment": action({ status: "executing" }) });
    const paid = await w.pay({ amount: "10", asset: "USDC", to: TO, delegationId: "del_1" } as never);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toEqual({ economicActionId: "eco_1", chain: "base-sepolia", from: "0xfrom", to: TO, amount: "10", asset: "USDC" });
    expect(Object.isFrozen(send.mock.calls[0][0])).toBe(true);
    expect(post).toHaveBeenCalledWith("/economic-actions/eco_1/payment", { txHash: "0xabc" });
    expect(paid).toMatchObject({ txHash: "0xabc", action: { status: "confirmed" } });
  });

  it("the recipient of a payment to an agent comes from the authorization, not from the caller", async () => {
    const owner = "0x2222222222222222222222222222222222222222";
    const authorized = action({ intent: { capability: "pay", amount: "10", asset: "USDC", to: owner }, executionPlan: plan({ to: owner }) } as never);
    const { wallet: w, send } = wallet({ "/economic-actions": authorized, "/payment": authorized });
    await w.pay({ amount: "10.00", asset: "usdc", counterparty: { id: "alma:main:agent:vendor" }, delegationId: "del_1" } as never);
    expect(send.mock.calls[0][0]).toMatchObject({ to: owner, amount: "10" });
  });

  it("sends nothing when the agent's rules refuse, or a person has to approve first", async () => {
    const refused = wallet({ "/economic-actions": action({ status: "rejected", policyEvaluation: { allowed: false, reasons: ["amount 5000 exceeds maxTransaction 1000"], approvalsRequired: [] } } as never) });
    await expect(refused.wallet.pay({ amount: "5000", asset: "USDC", to: TO, delegationId: "d" } as never)).rejects.toBeInstanceOf(AdaSoulsPolicyError);
    expect(refused.send).not.toHaveBeenCalled();

    const pending = wallet({ "/economic-actions": action({ status: "pending_approval" }) });
    await expect(pending.wallet.pay({ amount: "10", asset: "USDC", to: TO, delegationId: "d" } as never)).rejects.toBeInstanceOf(AdaSoulsApprovalPending);
    expect(pending.send).not.toHaveBeenCalled();
  });

  it("sends nothing when the authorization isn't what was asked for", async () => {
    for (const [over, what] of [
      [{ amount: "1000" }, /amount 1000, asked for 10/],
      [{ asset: "DAI" }, /asset DAI/],
      [{ to: "0x9999999999999999999999999999999999999999" }, /recipient/],
    ] as const) {
      const { wallet: w, send } = wallet({ "/economic-actions": action({ executionPlan: plan(over) } as never) });
      const err = await w.pay({ amount: "10", asset: "USDC", to: TO, delegationId: "d" } as never).catch((e) => e);
      expect(err).toBeInstanceOf(GuardedWalletMismatchError);
      expect(err.message).toMatch(what);
      expect(send).not.toHaveBeenCalled();
    }
  });

  it("when AdaSouls executes the agent's payments there is nothing to send", async () => {
    const { wallet: w, send } = wallet({ "/economic-actions": action({ executionPlan: { mode: "adasouls" } } as never) });
    expect(await w.pay({ amount: "10", asset: "USDC", to: TO, delegationId: "d" } as never)).toMatchObject({ txHash: null, action: { status: "confirmed" } });
    expect(send).not.toHaveBeenCalled();
  });

  it("a payment that was sent but couldn't be reported is never sent again: it is reported", async () => {
    const down = new Error("network down");
    const posts: Record<string, unknown> = { "/economic-actions": action(), "/payment": down };
    const { wallet: w, send, get } = wallet(posts);
    const err = await w.pay({ amount: "10", asset: "USDC", to: TO, delegationId: "d" } as never).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentNotReportedError);
    expect(err).toMatchObject({ economicActionId: "eco_1", txHash: "0xabc" });

    // Still authorized on the server (the report never arrived): resuming reports the same transaction.
    posts["/payment"] = action({ status: "executing" });
    get.mockResolvedValueOnce(action()).mockResolvedValue(action({ status: "confirmed" }));
    expect(await w.resume("eco_1")).toMatchObject({ txHash: "0xabc", action: { status: "confirmed" } });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("resume() pays an action a person has since approved", async () => {
    const send = vi.fn().mockResolvedValue("0xdef");
    const get = vi.fn().mockResolvedValueOnce(action()).mockResolvedValue(action({ status: "confirmed" }));
    const { wallet: w } = wallet({ "/payment": action({ status: "executing" }) }, send, get);
    expect(await w.resume("eco_1")).toMatchObject({ txHash: "0xdef" });
    expect(send.mock.calls[0][0]).toMatchObject({ amount: "10", to: TO });
  });

  it("hire() pays the price the job agreed, and returns the job", async () => {
    const job = { id: "job_1", status: "awaiting_payment", price: { amount: "0.10", asset: "USDC" } };
    const hired = action({ capability: "hire", executionPlan: plan({ amount: "0.10" }) } as never);
    const { wallet: w, send } = wallet({ "/hire": { job, action: hired }, "/payment": hired });
    const out = await w.hire("lst_1", { service: "assess-risk" });
    expect(out).toMatchObject({ job: { id: "job_1" }, txHash: "0xabc" });
    expect(send.mock.calls[0][0]).toMatchObject({ amount: "0.10" });

    const overpriced = wallet({ "/hire": { job, action: action({ executionPlan: plan({ amount: "100" }) } as never) } });
    await expect(overpriced.wallet.hire("lst_1", { service: "assess-risk" })).rejects.toBeInstanceOf(GuardedWalletMismatchError);
    expect(overpriced.send).not.toHaveBeenCalled();
  });
});

/**
 * The API's side of a self-paid action, enough to restart a wallet
 * against: authorized until a payment is reported, then executing with
 * the reported transaction, then confirmed. Reporting twice is a 409,
 * as on the real API.
 */
function fakeApi(over: Partial<EconomicAction> = {}) {
  let current = action(over);
  let reportsDown = 0;
  const post = vi.fn(async (path: string, body: { txHash: string }) => {
    if (!path.endsWith("/payment")) throw new Error(`unexpected POST ${path}`);
    if (reportsDown > 0) {
      reportsDown--;
      throw new Error("network down");
    }
    if (current.status !== "authorized") throw new Error(`409: economic action is ${current.status}, not waiting for a payment`);
    current = { ...current, status: "executing", execution: { mode: "self", txHash: body.txHash } };
    return current;
  });
  const get = vi.fn(async () => {
    if (current.status === "executing") current = { ...current, status: "confirmed" };
    return current;
  });
  const agent = new Agent({ get, post } as unknown as AdaSoulsClient, "agent_1");
  return {
    post,
    /** A wallet process: a new one shares nothing with the last but the store. */
    process: (send: SendPayment, options: GuardedWalletOptions = {}) => agent.guardedWallet(send, { waitOptions: { intervalMs: 1 }, ...options }),
    failNextReports: (n: number) => (reportsDown = n),
    get status() {
      return current.status;
    },
  };
}

describe("GuardedWallet: one authorization, one payment (B6)", () => {
  let dir: string;
  let store: PaymentStore;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "adasouls-payments-"));
    store = new FilePaymentStore(dir);
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("two concurrent resume() calls send once, and share the outcome", async () => {
    const api = fakeApi();
    const send = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return "0xabc";
    });
    const w = api.process(send, { store });
    const [a, b] = await Promise.all([w.resume("eco_1"), w.resume("eco_1")]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ txHash: "0xabc", action: { status: "confirmed" } });
  });

  it("two wallet processes sharing a file store: only one sends", async () => {
    const api = fakeApi();
    const send = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return "0xabc";
    });
    const results = await Promise.allSettled([api.process(send, { store: new FilePaymentStore(dir) }).resume("eco_1"), api.process(send, { store: new FilePaymentStore(dir) }).resume("eco_1")]);
    expect(send).toHaveBeenCalledTimes(1);
    // The loser saw a payment it didn't start, still unrecorded: it doesn't send, it says so.
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((results.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(PaymentInDoubtError);
  });

  it("a crash between sending and reporting: after the restart the payment is reported, not sent again", async () => {
    const api = fakeApi();
    const send = vi.fn().mockResolvedValue("0xabc");
    api.failNextReports(1); // the process dies here: the report never arrives
    await expect(api.process(send, { store }).resume("eco_1")).rejects.toBeInstanceOf(PaymentNotReportedError);
    expect(api.status).toBe("authorized");

    const restarted = api.process(send, { store: new FilePaymentStore(dir) });
    expect(await restarted.resume("eco_1")).toMatchObject({ txHash: "0xabc", action: { status: "confirmed" } });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("a crash while send was running: after the restart nothing is sent, and the payment is in doubt", async () => {
    const api = fakeApi();
    // The process dies inside send: it never returns.
    const hung = vi.fn(() => new Promise<string>(() => {}));
    void api.process(hung, { store }).resume("eco_1");
    await vi.waitFor(() => expect(hung).toHaveBeenCalled());

    const send = vi.fn().mockResolvedValue("0xdef");
    const err = await api.process(send, { store: new FilePaymentStore(dir) }).resume("eco_1").catch((e) => e);
    expect(err).toBeInstanceOf(PaymentInDoubtError);
    expect(err).toMatchObject({ economicActionId: "eco_1", payment: { to: TO, amount: "10" } });
    expect(send).not.toHaveBeenCalled();

    // With a way to look the payment up, it is found and reported instead.
    const findPayment = vi.fn().mockResolvedValue("0xabc");
    expect(await api.process(send, { store: new FilePaymentStore(dir), findPayment }).resume("eco_1")).toMatchObject({ txHash: "0xabc" });
    expect(findPayment.mock.calls[0][0]).toMatchObject({ to: TO, amount: "10" });
    expect(send).not.toHaveBeenCalled();
  });

  it("a payment AdaSouls already has is not reported again after a restart", async () => {
    const api = fakeApi();
    const hung = vi.fn(() => new Promise<string>(() => {}));
    void api.process(hung, { store }).resume("eco_1");
    await vi.waitFor(() => expect(hung).toHaveBeenCalled());
    // The report reached the API but the record of it didn't reach disk.
    await api.post("/economic-actions/eco_1/payment", { txHash: "0xabc" });

    const send = vi.fn();
    expect(await api.process(send, { store: new FilePaymentStore(dir) }).resume("eco_1")).toMatchObject({ txHash: "0xabc", action: { status: "confirmed" } });
    expect(send).not.toHaveBeenCalled();
    expect(await store.get("eco_1")).toMatchObject({ state: "sent", txHash: "0xabc" });
  });

  it("the state report's probe (two concurrent resumes, then a restart before reporting) sends once, not three times", async () => {
    const api = fakeApi();
    const send = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return "0xabc";
    });
    api.failNextReports(1);
    const first = api.process(send, { store });
    const outcomes = await Promise.allSettled([first.resume("eco_1"), first.resume("eco_1")]);
    // One attempt, shared: one send, one lost report, the same error for both callers.
    expect(outcomes.map((o) => (o as PromiseRejectedResult).reason)).toEqual([expect.any(PaymentNotReportedError), expect.any(PaymentNotReportedError)]);
    expect(api.post).toHaveBeenCalledTimes(1);

    const restarted = api.process(send, { store: new FilePaymentStore(dir) });
    expect(await restarted.resume("eco_1")).toMatchObject({ txHash: "0xabc", action: { status: "confirmed" } });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("a send that fails without broadcasting can be retried; any other failure can't", async () => {
    const api = fakeApi();
    const send = vi.fn().mockRejectedValueOnce(new PaymentNotSentError("insufficient funds")).mockRejectedValueOnce(new Error("rpc timeout")).mockResolvedValue("0xabc");
    const w = api.process(send, { store });
    await expect(w.resume("eco_1")).rejects.toBeInstanceOf(PaymentNotSentError);
    await expect(w.resume("eco_1")).rejects.toBeInstanceOf(PaymentInDoubtError);
    await expect(w.resume("eco_1")).rejects.toBeInstanceOf(PaymentInDoubtError);
    expect(send).toHaveBeenCalledTimes(2);

    // Checked by hand: the rpc timeout never broadcast.
    await w.forget("eco_1");
    expect(await w.resume("eco_1")).toMatchObject({ txHash: "0xabc" });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("refuses an authorization past the API's expiresAt, whatever its own cap says", async () => {
    const send = vi.fn();
    const expired = new Date(Date.now() - 60_000).toISOString();
    const err = await fakeApi({ expiresAt: expired } as never).process(send, { store, maxAuthorizationAgeMs: Infinity }).resume("eco_1").catch((e) => e);
    expect(err).toBeInstanceOf(AuthorizationTooOldError);
    expect(err.message).toMatch(/expired at .*start a new payment/);
    expect(send).not.toHaveBeenCalled();
    expect(await store.get("eco_1")).toBeUndefined();
  });

  it("an action approved long after it was asked for is paid: its age counts from the approval", async () => {
    const asked = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const approved = { createdAt: asked, approval: { id: "apr_1", status: "granted", decidedAt: new Date().toISOString() }, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() };
    const send = vi.fn().mockResolvedValue("0xabc");
    expect(await fakeApi(approved as never).process(send, { store }).resume("eco_1")).toMatchObject({ txHash: "0xabc" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("refuses an authorization older than maxAuthorizationAgeMs, and sends nothing", async () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const send = vi.fn();
    const err = await fakeApi({ createdAt: old }).process(send, { store }).resume("eco_1").catch((e) => e);
    expect(err).toBeInstanceOf(AuthorizationTooOldError);
    expect(send).not.toHaveBeenCalled();
    expect(await store.get("eco_1")).toBeUndefined();

    const lenient = fakeApi({ createdAt: old }).process(vi.fn().mockResolvedValue("0xabc"), { maxAuthorizationAgeMs: Infinity });
    expect(await lenient.resume("eco_1")).toMatchObject({ txHash: "0xabc" });
  });
});

describe("GuardedWallet paying by card", () => {
  it("send returns the PaymentIntent it paid, and it is reported on the Stripe rail", async () => {
    const card = action({ intent: { capability: "pay", amount: "12.50", asset: "USD" }, executionPlan: plan({ chain: "stripe-test", from: "acct_payer", to: "acct_payee", amount: "12.50", asset: "USD" }) } as never);
    const { wallet: w, send, post } = wallet({ "/economic-actions": card, "/payment": action({ status: "executing" }) }, vi.fn().mockResolvedValue("pi_3Ncard"));
    const paid = await w.pay({ amount: "12.50", asset: "USD", counterparty: { id: "alma:main:agent:vendor" }, delegationId: "del_1" } as never);
    expect(send.mock.calls[0][0]).toMatchObject({ chain: "stripe-test", to: "acct_payee", amount: "12.50", asset: "USD" });
    expect(post).toHaveBeenCalledWith("/economic-actions/eco_1/payment", { rail: "stripe", reference: "pi_3Ncard" });
    expect(paid).toMatchObject({ txHash: "pi_3Ncard" });
  });
});

describe("FilePaymentStore", () => {
  let dir: string;
  beforeEach(async () => (dir = await mkdtemp(join(tmpdir(), "adasouls-payments-"))));
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const record = { economicActionId: "eco/1", state: "sending" as const, payment: null, txHash: null, sendingAt: new Date().toISOString() };

  it("claims an action once, across instances, and leaves no temporary files", async () => {
    const wins = await Promise.all(Array.from({ length: 8 }, () => new FilePaymentStore(dir).claim(record)));
    expect(wins.filter(Boolean)).toHaveLength(1);
    expect(await readdir(dir)).toEqual(["eco%2F1.json"]);
  });

  it("reads back what it wrote, replaces it, and deletes it", async () => {
    const store = new FilePaymentStore(dir);
    expect(await store.get("eco/1")).toBeUndefined();
    await store.claim(record);
    await store.put({ ...record, state: "sent", txHash: "0xabc" });
    expect(await new FilePaymentStore(dir).get("eco/1")).toMatchObject({ state: "sent", txHash: "0xabc" });
    await store.delete("eco/1");
    expect(await store.get("eco/1")).toBeUndefined();
  });
});

describe("erc20Transfer", () => {
  it("encodes transfer(recipient, amount) to the token contract, exactly", () => {
    const call = erc20Transfer({ economicActionId: "eco_1", chain: "base-sepolia", from: "0xfrom", to: TO, amount: "12.5", asset: "USDC" });
    expect(call).toEqual({
      chainId: 84532,
      to: "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
      data: `0xa9059cbb${"0".repeat(24)}${"1".repeat(40)}${(12_500_000).toString(16).padStart(64, "0")}`,
      value: 0n,
    });
  });

  it("refuses what it can't encode exactly", () => {
    const base = { economicActionId: "eco_1", chain: "base-sepolia", from: "0xfrom", to: TO, amount: "1", asset: "USDC" };
    expect(() => erc20Transfer({ ...base, amount: "0.0000001" })).toThrow(/more than 6 decimals/);
    expect(() => erc20Transfer({ ...base, amount: "-1" })).toThrow();
    expect(() => erc20Transfer({ ...base, asset: "DOGE" })).toThrow(/no known token/);
    expect(() => erc20Transfer({ ...base, chain: "mock-chain" })).toThrow(/no known token/);
    expect(() => erc20Transfer({ ...base, to: "vitalik.eth" })).toThrow(/isn't an address/);
  });
});
