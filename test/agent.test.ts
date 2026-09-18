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
