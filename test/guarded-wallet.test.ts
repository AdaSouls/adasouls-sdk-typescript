import { describe, expect, it, vi } from "vitest";
import { Agent } from "../src/agent.js";
import type { AdaSoulsClient } from "../src/client.js";
import { AdaSoulsApprovalPending, AdaSoulsPolicyError } from "../src/errors.js";
import { GuardedWalletMismatchError, PaymentNotReportedError, erc20Transfer } from "../src/guarded-wallet.js";
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
