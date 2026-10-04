import type { AdaSoulsClient } from "./client.js";
import { AdaSoulsProviderError } from "./errors.js";
import { reportBody } from "./reports.js";
import type { AgentReport, EconomicAction, PaymentInstruction, ReportedMetrics } from "./types.js";

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
   * The payment this agent must make itself, when it pays from its own
   * wallet and hasn't reported it yet; null otherwise (AdaSouls executes
   * it, or it's already reported). Nothing happens to the action until
   * the payment is reported, so don't wait() before calling reportPayment().
   */
  get payment(): PaymentInstruction | null {
    const plan = this.action.executionPlan as { mode?: string; chain?: string; from?: string; to?: string; amount?: string; asset?: string } | null | undefined;
    if (plan?.mode !== "self" || this.action.status !== "authorized" || !plan.to || !plan.amount || !plan.asset) return null;
    return { economicActionId: this.action.id, chain: plan.chain!, from: plan.from!, to: plan.to, amount: plan.amount, asset: plan.asset };
  }

  /**
   * Reports the transaction that made this payment. AdaSouls checks it
   * on-chain (from the agent's declared wallet, to the planned address,
   * this amount) before confirming the action; wait() afterwards to see
   * the outcome.
   */
  async reportPayment(txHash: string): Promise<this> {
    this.action = await this.client.post<EconomicAction>(`/economic-actions/${encodeURIComponent(this.action.id)}/payment`, { txHash });
    return this;
  }

  /** Declares figures only the agent knows about this action (see Agent.report). */
  async report(metrics: ReportedMetrics): Promise<AgentReport[]> {
    const body = reportBody({ action: this.action.id }, metrics);
    const res = await this.client.post<{ reports: AgentReport[] }>(`/agents/${encodeURIComponent(this.action.agentId)}/reports`, body);
    return res.reports;
  }

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
