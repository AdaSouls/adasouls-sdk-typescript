import { describe, expect, it, vi } from "vitest";
import { Agent } from "../src/agent.js";
import { EconomicActionHandle } from "../src/economic-action-handle.js";
import { AdaSoulsApprovalPending, AdaSoulsNoDelegationError, AdaSoulsPolicyError } from "../src/errors.js";
import type { AdaSoulsClient } from "../src/client.js";
import type { AgentAuthority, EconomicAction } from "../src/types.js";

function fakeClient(overrides: Partial<AdaSoulsClient> = {}): AdaSoulsClient {
  return { get: vi.fn(), post: vi.fn(), ...overrides } as unknown as AdaSoulsClient;
}

function baseAction(overrides: Partial<EconomicAction> = {}): EconomicAction {
  return {
    id: "eco_1",
    principalId: "alma:main:organization:acme",
    agentId: "agent_1",
    intent: {},
    capability: "pay",
    authority: { delegationId: "del_1", policySnapshot: [] },
    status: "authorized",
    needsReconciliation: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("Agent.execute()", () => {
  it("uses an explicit delegationId without calling authority()", async () => {
    const post = vi.fn().mockResolvedValue(baseAction());
    const client = fakeClient({ post });
    const agent = new Agent(client, "agent_1");

    const handle = await agent.execute({ capability: "pay", amount: "1", asset: "USDC", delegationId: "del_explicit" });

    expect(handle).toBeInstanceOf(EconomicActionHandle);
    expect(post).toHaveBeenCalledWith(
      "/economic-actions",
      expect.objectContaining({ delegationId: "del_explicit" }),
      undefined
    );
  });

  it("resolves a delegationId automatically via authority() when omitted", async () => {
    const authority: AgentAuthority = {
      agentId: "agent_1",
      activeDelegations: [
        { id: "del_wrong", issuer: "x", subject: "agent_1", scope: { capabilities: ["hire"] }, status: "active", issuedAt: "now" },
        { id: "del_right", issuer: "x", subject: "agent_1", scope: { capabilities: ["pay"] }, status: "active", issuedAt: "now" },
      ],
      policySummary: [],
    };
    const get = vi.fn().mockResolvedValue(authority);
    const post = vi.fn().mockResolvedValue(baseAction());
    const agent = new Agent(fakeClient({ get, post }), "agent_1");

    await agent.execute({ capability: "pay", amount: "1", asset: "USDC" });

    expect(post).toHaveBeenCalledWith("/economic-actions", expect.objectContaining({ delegationId: "del_right" }), undefined);
  });

  it("throws AdaSoulsNoDelegationError when no active delegation covers the capability", async () => {
    const get = vi.fn().mockResolvedValue({ agentId: "agent_1", activeDelegations: [], policySummary: [] });
    const agent = new Agent(fakeClient({ get }), "agent_1");

    await expect(agent.execute({ capability: "pay", amount: "1", asset: "USDC" })).rejects.toThrow(AdaSoulsNoDelegationError);
  });

  it("throws AdaSoulsPolicyError on a rejected action, with reasons/approvalsRequired attached", async () => {
    const post = vi.fn().mockResolvedValue(
      baseAction({ status: "rejected", policyEvaluation: { allowed: false, reasons: ["exceeds limit"], approvalsRequired: [] } })
    );
    const agent = new Agent(fakeClient({ post }), "agent_1");

    await expect(
      agent.execute({ capability: "pay", amount: "999999", asset: "USDC", delegationId: "del_1" })
    ).rejects.toMatchObject({ reasons: ["exceeds limit"] });
  });

  it("throws AdaSoulsApprovalPending on pending_approval, not a policy error", async () => {
    const post = vi.fn().mockResolvedValue(
      baseAction({ status: "pending_approval", policyEvaluation: { allowed: false, reasons: [], approvalsRequired: ["human_approval"] } })
    );
    const agent = new Agent(fakeClient({ post }), "agent_1");

    let error: unknown;
    try {
      await agent.execute({ capability: "pay", amount: "500", asset: "USDC", delegationId: "del_1" });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(AdaSoulsApprovalPending);
    expect(error).not.toBeInstanceOf(AdaSoulsPolicyError);
  });

  it("blocking mode ({ wait: true }) polls to a terminal state before resolving", async () => {
    const post = vi.fn().mockResolvedValue(baseAction({ status: "executing" }));
    const get = vi.fn().mockResolvedValue(baseAction({ status: "confirmed" }));
    const agent = new Agent(fakeClient({ post, get }), "agent_1");

    const handle = await agent.execute({ capability: "pay", amount: "1", asset: "USDC", delegationId: "del_1", wait: true });

    expect(handle.action.status).toBe("confirmed");
  });

  it("non-blocking by default: resolves immediately at 'authorized' without polling", async () => {
    const post = vi.fn().mockResolvedValue(baseAction({ status: "authorized" }));
    const get = vi.fn();
    const agent = new Agent(fakeClient({ post, get }), "agent_1");

    const handle = await agent.execute({ capability: "pay", amount: "1", asset: "USDC", delegationId: "del_1" });

    expect(handle.action.status).toBe("authorized");
    expect(get).not.toHaveBeenCalled();
  });
});

describe("Agent.checkPolicy()", () => {
  it("posts to /agents/:id/check-policy and returns the evaluation without throwing on a denial", async () => {
    const post = vi.fn().mockResolvedValue({ allowed: false, reasons: ["exceeds limit"], approvalsRequired: [] });
    const agent = new Agent(fakeClient({ post }), "agent_1");

    const result = await agent.checkPolicy({ capability: "pay", amount: "999999", asset: "USDC" });

    expect(result).toEqual({ allowed: false, reasons: ["exceeds limit"], approvalsRequired: [] });
    expect(post).toHaveBeenCalledWith(
      "/agents/agent_1/check-policy",
      expect.objectContaining({ intent: expect.objectContaining({ capability: "pay", amount: "999999" }) })
    );
  });
});

describe("Agent.testConnection()", () => {
  it("posts the runtime label to /agents/:id/test-connection and returns the result without throwing on a failed test", async () => {
    const failed = { ok: false, reasons: ["no policy applies to this agent"], checks: { credential: true, authority: true, policies: false }, economicActionId: null, instanceId: null, status: "identity_issued" };
    const post = vi.fn().mockResolvedValue(failed);
    const agent = new Agent(fakeClient({ post }), "alma:main:agent:x");

    expect(await agent.testConnection({ runtime: "treasury-bot@prod" })).toEqual(failed);
    expect(post).toHaveBeenCalledWith("/agents/alma%3Amain%3Aagent%3Ax/test-connection", { runtime: "treasury-bot@prod", capability: undefined, asset: undefined });
  });
});

describe("paying from the agent's own wallet", () => {
  const selfPaid = (over: Partial<EconomicAction> = {}) =>
    baseAction({
      executionPlan: { providerId: "self", route: "self-paid", mode: "self", chain: "base-sepolia", from: "0xfrom", to: "0xto", amount: "5", asset: "USDC" },
      ...over,
    });

  it("execute() returns the payment to make, and doesn't wait even when asked: nothing happens until the agent reports it", async () => {
    const post = vi.fn().mockResolvedValue(selfPaid());
    const get = vi.fn();
    const agent = new Agent(fakeClient({ post, get }), "agent_1");
    const handle = await agent.execute({ capability: "pay", amount: "5", asset: "USDC", delegationId: "del_1", wait: true });
    expect(handle.payment).toEqual({ economicActionId: "eco_1", chain: "base-sepolia", from: "0xfrom", to: "0xto", amount: "5", asset: "USDC" });
    expect(get).not.toHaveBeenCalled();
  });

  it("reportPayment() posts the transaction and returns the updated action; then there is no payment left to make", async () => {
    const post = vi.fn().mockResolvedValue(selfPaid({ status: "executing" }));
    const handle = new EconomicActionHandle(fakeClient({ post }), selfPaid());
    await handle.reportPayment("0xabc");
    expect(post).toHaveBeenCalledWith("/economic-actions/eco_1/payment", { txHash: "0xabc" });
    expect(handle.action.status).toBe("executing");
    expect(handle.payment).toBeNull();
  });

  it("an action AdaSouls executes has no payment for the agent to make", () => {
    expect(new EconomicActionHandle(fakeClient(), baseAction({ executionPlan: { mode: "adasouls" } })).payment).toBeNull();
  });
});

describe("reports", () => {
  const all = { computeCost: { amount: "0.0421", currency: "USD" }, model: "claude-sonnet-5", inputTokens: 1820, outputTokens: 0, durationMs: 950 };

  it("report() declares each figure about an action or a job, as this agent", async () => {
    const post = vi.fn().mockResolvedValue({ reports: [{ id: "arp_1" }] });
    const agent = new Agent(fakeClient({ post }), "alma:main:agent:a1");
    expect(await agent.report({ job: "job_1" }, all)).toEqual([{ id: "arp_1" }]);
    expect(post).toHaveBeenCalledWith("/agents/alma%3Amain%3Aagent%3Aa1/reports", {
      about: "job",
      ref: "job_1",
      metrics: [
        { metric: "compute_cost", value: "0.0421", unit: "USD" },
        { metric: "model", value: "claude-sonnet-5" },
        { metric: "input_tokens", value: "1820" },
        { metric: "output_tokens", value: "0" },
        { metric: "duration_ms", value: "950" },
      ],
    });
  });

  it("an action handle reports about its own action", async () => {
    const post = vi.fn().mockResolvedValue({ reports: [] });
    await new EconomicActionHandle(fakeClient({ post }), baseAction()).report({ model: "m" });
    expect(post).toHaveBeenCalledWith("/agents/agent_1/reports", { about: "action", ref: "eco_1", metrics: [{ metric: "model", value: "m" }] });
  });

  it("refuses an empty report and counts that aren't whole numbers, before calling the API", async () => {
    const post = vi.fn();
    const agent = new Agent(fakeClient({ post }), "agent_1");
    await expect(agent.report({ action: "eco_1" }, {})).rejects.toThrow(TypeError);
    for (const bad of [1.5, -1, Number.NaN]) await expect(agent.report({ action: "eco_1" }, { inputTokens: bad })).rejects.toThrow(TypeError);
    expect(post).not.toHaveBeenCalled();
  });

  it("reports() lists them, optionally for one subject", async () => {
    const get = vi.fn().mockResolvedValue({ treeHead: null, reports: [] });
    const agent = new Agent(fakeClient({ get }), "agent_1");
    await agent.reports();
    await agent.reports({ action: "eco_1" });
    expect(get).toHaveBeenNthCalledWith(1, "/agents/agent_1/reports", undefined);
    expect(get).toHaveBeenNthCalledWith(2, "/agents/agent_1/reports", { about: "action", ref: "eco_1" });
  });
});

describe("presence", () => {
  it("signal() and presence() call the agent's own endpoints", async () => {
    const post = vi.fn().mockResolvedValue({ online: true });
    const get = vi.fn().mockResolvedValue({ online: false });
    const agent = new Agent(fakeClient({ post, get }), "alma:main:agent:a1");
    expect(await agent.signal()).toEqual({ online: true });
    expect(post).toHaveBeenCalledWith("/agents/alma%3Amain%3Aagent%3Aa1/signal");
    expect(await agent.presence()).toEqual({ online: false });
    expect(get).toHaveBeenCalledWith("/agents/alma%3Amain%3Aagent%3Aa1/presence");
  });

  it("stayOnline() signals at once and on every interval until stopped; a failed signal doesn't stop it", async () => {
    vi.useFakeTimers();
    try {
      const post = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error("network")).mockResolvedValue({});
      const onError = vi.fn();
      const stop = new Agent(fakeClient({ post }), "agent_1").stayOnline({ intervalMs: 10_000, onError });
      expect(post).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(post).toHaveBeenCalledTimes(2);
      expect(onError).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(post).toHaveBeenCalledTimes(3);
      stop();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(post).toHaveBeenCalledTimes(3);
      expect(() => new Agent(fakeClient({ post }), "agent_1").stayOnline({ intervalMs: 100 })).toThrow(TypeError);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("marketplace", () => {
  const job = { id: "job_1", status: "awaiting_payment" };

  it("findAgents() passes the filters through", async () => {
    const get = vi.fn().mockResolvedValue({ items: [{ id: "lst_1" }] });
    expect(await new Agent(fakeClient({ get }), "agent_1").findAgents({ capability: "analyze-protocol", q: "risk" })).toEqual([{ id: "lst_1" }]);
    expect(get).toHaveBeenCalledWith("/marketplace/listings", { capability: "analyze-protocol", q: "risk", limit: undefined });
  });

  it("hire() hires as this agent and returns the job, the payment action and what to pay", async () => {
    const action = baseAction({ capability: "hire", executionPlan: { mode: "self", chain: "mock-chain", from: "0xa", to: "0xb", amount: "0.10", asset: "USDC" } });
    const post = vi.fn().mockResolvedValue({ job, action });
    const result = await new Agent(fakeClient({ post }), "agent_1").hire("lst_1", { service: "analyze-protocol", input: { protocol: "aave" } });
    expect(post).toHaveBeenCalledWith("/marketplace/listings/lst_1/hire", { agentId: "agent_1", service: "analyze-protocol", input: { protocol: "aave" } });
    expect(result.job).toEqual(job);
    expect(result.payment).toMatchObject({ to: "0xb", amount: "0.10" });
  });

  it("hire() throws like execute() when policy refuses or a person must approve", async () => {
    const reject = vi.fn().mockResolvedValue({ job, action: baseAction({ status: "rejected", policyEvaluation: { allowed: false, reasons: ["too expensive"], approvalsRequired: [] } }) });
    await expect(new Agent(fakeClient({ post: reject }), "agent_1").hire("lst_1", { service: "x" })).rejects.toBeInstanceOf(AdaSoulsPolicyError);
    const pending = vi.fn().mockResolvedValue({ job, action: baseAction({ status: "pending_approval" }) });
    await expect(new Agent(fakeClient({ post: pending }), "agent_1").hire("lst_1", { service: "x" })).rejects.toBeInstanceOf(AdaSoulsApprovalPending);
  });

  it("waitForJob() polls until the job is done", async () => {
    const get = vi.fn().mockResolvedValueOnce({ ...job, status: "paid" }).mockResolvedValueOnce({ ...job, status: "completed", result: { ok: true } });
    expect(await new Agent(fakeClient({ get }), "agent_1").waitForJob("job_1", { intervalMs: 1 })).toMatchObject({ status: "completed", result: { ok: true } });
    expect(get).toHaveBeenCalledTimes(2);
  });
});
