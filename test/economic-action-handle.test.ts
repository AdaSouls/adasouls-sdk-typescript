import { describe, expect, it, vi } from "vitest";
import { EconomicActionHandle } from "../src/economic-action-handle.js";
import { AdaSoulsProviderError } from "../src/errors.js";
import type { AdaSoulsClient } from "../src/client.js";
import type { EconomicAction } from "../src/types.js";

function baseAction(overrides: Partial<EconomicAction> = {}): EconomicAction {
  return {
    id: "eco_1",
    principalId: "p",
    agentId: "a",
    intent: {},
    capability: "pay",
    authority: { delegationId: "d", policySnapshot: [] },
    status: "executing",
    needsReconciliation: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("EconomicActionHandle.wait()", () => {
  it("polls until a terminal state and returns the final action", async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce(baseAction({ status: "executing" }))
      .mockResolvedValueOnce(baseAction({ status: "confirmed" }));
    const client = { get } as unknown as AdaSoulsClient;
    const handle = new EconomicActionHandle(client, baseAction({ status: "executing" }));

    const result = await handle.wait({ intervalMs: 1 });

    expect(result.status).toBe("confirmed");
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("throws AdaSoulsProviderError when it settles into failed", async () => {
    const get = vi.fn().mockResolvedValue(baseAction({ status: "failed", result: { reason: "provider timeout" } }));
    const client = { get } as unknown as AdaSoulsClient;
    const handle = new EconomicActionHandle(client, baseAction({ status: "executing" }));

    await expect(handle.wait({ intervalMs: 1 })).rejects.toMatchObject({
      economicActionId: "eco_1",
      result: { reason: "provider timeout" },
    });
    await expect(handle.wait({ intervalMs: 1 })).rejects.toBeInstanceOf(AdaSoulsProviderError);
  });

  it("gives up at the timeout and returns the last-seen non-terminal state, without throwing", async () => {
    const get = vi.fn().mockResolvedValue(baseAction({ status: "executing" }));
    const client = { get } as unknown as AdaSoulsClient;
    const handle = new EconomicActionHandle(client, baseAction({ status: "executing" }));

    const result = await handle.wait({ intervalMs: 1, timeoutMs: 1 });

    expect(result.status).toBe("executing");
  });

  it("returns immediately without polling if already terminal", async () => {
    const get = vi.fn();
    const client = { get } as unknown as AdaSoulsClient;
    const handle = new EconomicActionHandle(client, baseAction({ status: "confirmed" }));

    const result = await handle.wait();

    expect(result.status).toBe("confirmed");
    expect(get).not.toHaveBeenCalled();
  });
});
