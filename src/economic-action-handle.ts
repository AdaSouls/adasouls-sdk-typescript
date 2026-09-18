import type { AdaSoulsClient } from "./client.js";
import { AdaSoulsProviderError } from "./errors.js";
import type { EconomicAction } from "./types.js";

const TERMINAL_STATUSES = new Set(["confirmed", "failed", "rejected", "reversed"]);

export interface WaitOptions {
  /** Milliseconds between polls. Default 1000. */
  intervalMs?: number;
  /** Give up after this long and return the last-seen (non-terminal) state rather than polling forever. Default 60000. */
  timeoutMs?: number;
}

/**
 * A live, pollable reference to one EconomicAction -- REST is the only
 * transport in v1 (no websocket/streaming, ADR-008), so "wait for it to
 * settle" means polling GET /economic-actions/:id, per REPOSITORY.md's
 * "Polling/wait helpers for EconomicAction state (action.wait())".
 */
export class EconomicActionHandle {
  constructor(private readonly client: AdaSoulsClient, public action: EconomicAction) {}

  /**
   * Polls until the action reaches a terminal state (or the timeout
   * elapses), returning the final EconomicAction. Throws
   * AdaSoulsProviderError if it settled into "failed" -- confirmed,
   * rejected, and reversed are returned normally (rejected is caught
   * earlier, at execute() time, before a handle is even created; it's
   * included here only for completeness against every terminal state).
   */
  async wait(options: WaitOptions = {}): Promise<EconomicAction> {
    const intervalMs = options.intervalMs ?? 1000;
    const deadline = Date.now() + (options.timeoutMs ?? 60_000);

    while (!TERMINAL_STATUSES.has(this.action.status)) {
      if (Date.now() >= deadline) return this.action;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      this.action = await this.client.get<EconomicAction>(`/economic-actions/${this.action.id}`);
    }

    if (this.action.status === "failed") {
      throw new AdaSoulsProviderError(
        `EconomicAction ${this.action.id} failed`,
        this.action.id,
        this.action.result ?? undefined
      );
    }

    return this.action;
  }
}
