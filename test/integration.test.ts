import { describe, expect, it } from "vitest";
import { AdaSouls } from "../src/index.js";
import { AdaSoulsAuthError, AdaSoulsNoDelegationError } from "../src/errors.js";

/**
 * Real HTTP against a real, locally-running adasouls-api -- not mocked.
 * REPOSITORY.md calls for "a small integration suite against a real dev
 * deployment... to catch contract drift specifically"; no dev deployment
 * exists yet (Phase 0's ECS pipeline is still deferred), so this runs
 * against ADASOULS_API_URL instead (a local `npm run dev` instance).
 * Skipped entirely when the required env vars aren't set, same pattern
 * as provider-adapters' *.testnet.test.ts in adasouls-engine.
 *
 * Fixture (an org/agent/API key/delegation already granting "pay") comes
 * from `npm run create-sdk-test-fixture` in adasouls-api -- org/agent/
 * API-key creation are human/admin actions the public SDK surface itself
 * can't perform, so there's no way to bootstrap this through the SDK.
 */
const baseUrl = process.env.ADASOULS_API_URL;
const apiKey = process.env.ADASOULS_TEST_API_KEY;
const agentId = process.env.ADASOULS_TEST_AGENT_ID;

describe.skipIf(!baseUrl || !apiKey || !agentId)("SDK integration (real adasouls-api)", () => {
  it("identity()/reputation()/authority() return real data over real HTTP", async () => {
    const adasouls = new AdaSouls({ apiKey: apiKey!, baseUrl });
    const agent = adasouls.agent(agentId!);

    const identity = await agent.identity();
    expect(identity.id).toBe(agentId);

    const reputation = await agent.reputation();
    expect(reputation).toEqual({ agentId, evidence: [] });

    const authority = await agent.authority();
    expect(authority.activeDelegations.length).toBeGreaterThan(0);
    expect(authority.activeDelegations[0]!.scope.capabilities).toContain("pay");
  });

  it("execute() resolves the delegation automatically and returns a handle that wait()s to confirmed", async () => {
    const adasouls = new AdaSouls({ apiKey: apiKey!, baseUrl });
    const agent = adasouls.agent(agentId!);

    const handle = await agent.execute({ capability: "pay", amount: "5", asset: "USDC", to: "agent_counterparty" });
    expect(["authorized", "executing", "confirmed"]).toContain(handle.action.status);

    // adasouls-worker isn't running in this environment, so the action
    // won't actually reach "confirmed" -- just confirm wait() polls
    // without throwing and returns whatever the API currently reports,
    // rather than hanging forever (a short timeout, not the 60s default).
    const result = await handle.wait({ intervalMs: 200, timeoutMs: 1000 });
    expect(result.id).toBe(handle.action.id);
  });

  it("history() lists the action just created", async () => {
    const adasouls = new AdaSouls({ apiKey: apiKey!, baseUrl });
    const agent = adasouls.agent(agentId!);

    await agent.execute({ capability: "pay", amount: "1", asset: "USDC" });
    const page = await agent.history({ limit: 5 });

    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((a) => a.agentId === agentId)).toBe(true);
  });

  it("a bogus API key is rejected with AdaSoulsAuthError, not a crash", async () => {
    const adasouls = new AdaSouls({ apiKey: "ak_definitely_not_real", baseUrl });
    await expect(adasouls.agent(agentId!).identity()).rejects.toThrow(AdaSoulsAuthError);
  });

  it("execute() without a covering delegation throws AdaSoulsNoDelegationError", async () => {
    const adasouls = new AdaSouls({ apiKey: apiKey!, baseUrl });
    const agent = adasouls.agent(agentId!);
    await expect(agent.execute({ capability: "hire", amount: "1", asset: "USDC" })).rejects.toThrow(AdaSoulsNoDelegationError);
  });

  it("checkPolicy() evaluates without creating an EconomicAction", async () => {
    const adasouls = new AdaSouls({ apiKey: apiKey!, baseUrl });
    const agent = adasouls.agent(agentId!);

    const before = await agent.history({ limit: 100 });
    const result = await agent.checkPolicy({ capability: "pay", amount: "1", asset: "USDC" });
    const after = await agent.history({ limit: 100 });

    expect(result.allowed).toBe(true);
    expect(after.items.length).toBe(before.items.length);
  });
});
