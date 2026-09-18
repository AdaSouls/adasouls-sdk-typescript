import type { AdaSoulsClient } from "./client.js";
import { EconomicActionHandle } from "./economic-action-handle.js";
import { AdaSoulsApprovalPending, AdaSoulsNoDelegationError, AdaSoulsPolicyError } from "./errors.js";
import type {
  AgentAuthority,
  AgentIdentity,
  AgentReputation,
  EconomicAction,
  ExecuteInput,
  ListEconomicActionsOptions,
  ListEconomicActionsResult,
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
    return input.wait ? new EconomicActionHandle(this.client, await handle.wait()) : handle;
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
