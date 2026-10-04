import type { AdaSoulsClient } from "./client.js";
import { EconomicActionHandle } from "./economic-action-handle.js";
import { AdaSoulsApprovalPending, AdaSoulsNoDelegationError, AdaSoulsPolicyError } from "./errors.js";
import { reportBody } from "./reports.js";
import type {
  AgentAuthority,
  AgentReport,
  AgentReports,
  Presence,
  ReportedMetrics,
  ReportSubject,
  StayOnlineOptions,
  AgentIdentity,
  AgentReputation,
  CheckPolicyInput,
  EconomicAction,
  ExecuteInput,
  ListEconomicActionsOptions,
  FindAgentsInput,
  HireInput,
  Listing,
  ListEconomicActionsResult,
  MarketplaceJob,
  PaymentInstruction,
  PolicyEvaluation,
  TestConnectionInput,
  TestConnectionResult,
} from "./types.js";

/** A handle bound to one agentId -- `adasouls.agent("agent_123")`, per 06-api-contracts.md's SDK semantics. */
export class Agent {
  constructor(private readonly client: AdaSoulsClient, readonly id: string) {}

  async identity(): Promise<AgentIdentity> {
    return this.client.get<AgentIdentity>(`/agents/${encodeURIComponent(this.id)}/identity`);
  }

  async reputation(): Promise<AgentReputation> {
    return this.client.get<AgentReputation>(`/agents/${encodeURIComponent(this.id)}/reputation`);
  }

  async authority(): Promise<AgentAuthority> {
    return this.client.get<AgentAuthority>(`/agents/${encodeURIComponent(this.id)}/authority`);
  }

  async history(options: ListEconomicActionsOptions = {}): Promise<ListEconomicActionsResult> {
    return this.client.get<ListEconomicActionsResult>("/economic-actions", {
      agentId: this.id,
      cursor: options.cursor,
      limit: options.limit,
    });
  }

  /**
   * "Would executing this intent be allowed right now" -- evaluates
   * every policy currently applicable to the agent, without creating an
   * EconomicAction. Never throws on a policy denial (unlike execute());
   * inspect `.allowed`/`.reasons`/`.approvalsRequired` on the result.
   */
  async checkPolicy(input: CheckPolicyInput): Promise<PolicyEvaluation> {
    return this.client.post<PolicyEvaluation>(`/agents/${encodeURIComponent(this.id)}/check-policy`, {
      intent: {
        capability: input.capability,
        amount: input.amount,
        asset: input.asset,
        to: input.to,
        detail: input.detail,
      },
      counterparty: input.counterparty,
    });
  }

  /**
   * The "test connection" step of connecting an agent: proves this
   * runtime holds a working key for the agent, and runs a simulated
   * action of amount 0 through the same authority and policy checks a
   * real one gets. Nothing is paid and no reputation is added.
   *
   * Only works with the agent's own key (not an org-wide key). Never
   * throws on a failed test: inspect `.ok` and `.reasons`. On success
   * the runtime is recorded as attached to the agent, and a person can
   * then activate it in the console.
   */
  async testConnection(input: TestConnectionInput): Promise<TestConnectionResult> {
    return this.client.post<TestConnectionResult>(`/agents/${encodeURIComponent(this.id)}/test-connection`, {
      runtime: input.runtime,
      capability: input.capability,
      asset: input.asset,
    });
  }

  /**
   * `06-api-contracts.md`'s documented example calls execute() without a
   * delegationId -- an agent using its own SDK instance shouldn't need
   * to already know which delegation backs it. When omitted, this
   * resolves one via GET /agents/:id/authority (the first active
   * delegation whose scope covers the requested capability), throwing
   * AdaSoulsNoDelegationError if none qualifies. Passing delegationId
   * explicitly skips that extra lookup.
   *
   * Non-blocking by default (REPOSITORY.md's open-question resolution):
   * resolves to a pollable EconomicActionHandle as soon as the action is
   * authorized/executing, without waiting for a terminal state. Pass
   * `{ wait: true }` to block until confirmed/failed instead.
   *
   * Throws AdaSoulsPolicyError if the policy engine rejected the action
   * outright, or AdaSoulsApprovalPending if it's waiting on a human --
   * neither produces a handle, since there's nothing to execute yet.
   */
  async execute(input: ExecuteInput): Promise<EconomicActionHandle> {
    const delegationId = input.delegationId ?? (await this.resolveDelegationId(input.capability));

    const action = await this.client.post<EconomicAction>(
      "/economic-actions",
      {
        agentId: this.id,
        capability: input.capability,
        intent: {
          capability: input.capability,
          amount: input.amount,
          asset: input.asset,
          to: input.to,
          detail: input.detail,
        },
        delegationId,
        counterparty: input.counterparty,
      },
      input.idempotencyKey ? { "Idempotency-Key": input.idempotencyKey } : undefined
    );

    if (action.status === "rejected") {
      throw new AdaSoulsPolicyError(
        action.policyEvaluation?.reasons.join("; ") || "policy denied this action",
        action.policyEvaluation?.reasons ?? [],
        action.policyEvaluation?.approvalsRequired ?? []
      );
    }
    if (action.status === "pending_approval") {
      throw new AdaSoulsApprovalPending(
        `EconomicAction ${action.id} needs human approval before it can proceed`,
        action.id,
        action.policyEvaluation?.approvalsRequired ?? []
      );
    }

    const handle = new EconomicActionHandle(this.client, action);
    // An agent that pays by itself must pay and report first: there is nothing to wait for yet.
    return input.wait && !handle.payment ? new EconomicActionHandle(this.client, await handle.wait()) : handle;
  }

  /** Reports the transaction for a payment this agent made from its own wallet (see EconomicActionHandle.payment). */
  async reportPayment(economicActionId: string, txHash: string): Promise<EconomicActionHandle> {
    const action = await this.client.post<EconomicAction>(`/economic-actions/${encodeURIComponent(economicActionId)}/payment`, { txHash });
    return new EconomicActionHandle(this.client, action);
  }

  /**
   * Declares figures only this agent knows (what the work cost to
   * compute, which model did it) about one of its actions or a job it
   * was hired for. Needs this agent's own api key. Each figure can be
   * declared once: repeating it is harmless, changing it is refused.
   */
  async report(subject: ReportSubject, metrics: ReportedMetrics): Promise<AgentReport[]> {
    const res = await this.client.post<{ reports: AgentReport[] }>(`/agents/${encodeURIComponent(this.id)}/reports`, reportBody(subject, metrics));
    return res.reports;
  }

  /** What this agent has declared, each with its signed envelope and its proof of being in the transparency log. */
  async reports(subject?: ReportSubject): Promise<AgentReports> {
    const query = !subject ? undefined : "action" in subject ? { about: "action", ref: subject.action } : { about: "job", ref: subject.job };
    return this.client.get<AgentReports>(`/agents/${encodeURIComponent(this.id)}/reports`, query);
  }

  // ---------- Presence ----------

  /** Tells AdaSouls this agent is running right now. Optional; needs this agent's own api key. */
  async signal(): Promise<Presence> {
    return this.client.post<Presence>(`/agents/${encodeURIComponent(this.id)}/signal`);
  }

  /**
   * Shows this agent as online for as long as the process runs: sends a
   * signal now and then every `intervalMs`. Returns a function that
   * stops it (the agent then goes offline when the last signal lapses).
   * The timer doesn't keep the process alive on its own. An agent that
   * never calls this isn't shown as offline, only by its last activity.
   */
  stayOnline(options: StayOnlineOptions = {}): () => void {
    const intervalMs = options.intervalMs ?? 30_000;
    if (!Number.isFinite(intervalMs) || intervalMs < 5_000) throw new TypeError("intervalMs must be at least 5000");
    const beat = () => {
      this.signal().catch((err) => options.onError?.(err));
    };
    beat();
    const timer = setInterval(beat, intervalMs);
    (timer as { unref?: () => void }).unref?.();
    return () => clearInterval(timer);
  }

  async presence(): Promise<Presence> {
    return this.client.get<Presence>(`/agents/${encodeURIComponent(this.id)}/presence`);
  }

  // ---------- Marketplace ----------

  /** Published listings of active agents, with each seller's record computed from verified receipts. */
  async findAgents(input: FindAgentsInput = {}): Promise<Listing[]> {
    const page = await this.client.get<{ items: Listing[] }>("/marketplace/listings", { capability: input.capability, q: input.q, limit: input.limit });
    return page.items;
  }

  /**
   * Hires a listed agent: pays the listed price (under this agent's own
   * delegation and limits, like any payment) and, once it's paid,
   * AdaSouls calls the seller and stores its answer.
   *
   * If this agent pays from its own wallet, `payment` says what to pay:
   * send it, then `action.reportPayment(txHash)`. Then waitForJob() for
   * the seller's answer. Throws AdaSoulsPolicyError if this agent's
   * policies refuse the price, or AdaSoulsApprovalPending if a person
   * must approve it first.
   */
  async hire(listingId: string, input: HireInput): Promise<{ job: MarketplaceJob; action: EconomicActionHandle; payment: PaymentInstruction | null }> {
    const { job, action } = await this.client.post<{ job: MarketplaceJob; action: EconomicAction }>(`/marketplace/listings/${encodeURIComponent(listingId)}/hire`, {
      agentId: this.id,
      service: input.service,
      input: input.input,
    });
    if (action.status === "rejected") {
      throw new AdaSoulsPolicyError(action.policyEvaluation?.reasons.join("; ") || "policy denied this hire", action.policyEvaluation?.reasons ?? [], action.policyEvaluation?.approvalsRequired ?? []);
    }
    if (action.status === "pending_approval") {
      throw new AdaSoulsApprovalPending(`hiring needs human approval (EconomicAction ${action.id}, job ${job.id})`, action.id, action.policyEvaluation?.approvalsRequired ?? []);
    }
    const handle = new EconomicActionHandle(this.client, action);
    return { job, action: handle, payment: handle.payment };
  }

  /** One job this agent bought or sold. */
  async job(jobId: string): Promise<MarketplaceJob> {
    return this.client.get<MarketplaceJob>(`/marketplace/jobs/${encodeURIComponent(jobId)}`);
  }

  /** Polls a job until the seller answered (completed), or delivery or payment failed. Returns the last state seen on timeout. */
  async waitForJob(jobId: string, options: { intervalMs?: number; timeoutMs?: number } = {}): Promise<MarketplaceJob> {
    const deadline = Date.now() + (options.timeoutMs ?? 120_000);
    let job = await this.job(jobId);
    while ((job.status === "awaiting_payment" || job.status === "paid") && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 1000));
      job = await this.job(jobId);
    }
    return job;
  }

  /** Jobs this agent took part in, newest first. */
  async jobs(role?: "buyer" | "seller"): Promise<MarketplaceJob[]> {
    return (await this.client.get<{ items: MarketplaceJob[] }>(`/agents/${encodeURIComponent(this.id)}/marketplace/jobs`, { role })).items;
  }

  private async resolveDelegationId(capability: string): Promise<string> {
    const { activeDelegations } = await this.authority();
    const match = activeDelegations.find((d) => d.scope.capabilities.includes(capability));
    if (!match) {
      throw new AdaSoulsNoDelegationError(
        `no active delegation grants agent "${this.id}" the "${capability}" capability -- pass delegationId explicitly, or grant one via POST /delegations`
      );
    }
    return match.id;
  }
}
