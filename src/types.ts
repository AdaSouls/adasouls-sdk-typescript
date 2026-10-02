/** Thin typed mirrors of adasouls-api's wire shapes -- no independent modeling, per REPOSITORY.md's "Domain entities". */

export interface AgentIdentity {
  id: string;
  subjectType: "agent";
  displayName: string;
  status: string;
  principal: string;
  createdAt: string;
}

export interface ReputationEvidenceItem {
  id: string;
  subjectId: string;
  type: string;
  occurredAt: string;
  detail: Record<string, unknown>;
}

export interface AgentReputation {
  agentId: string;
  evidence: ReputationEvidenceItem[];
}

export interface DelegationScope {
  capabilities: string[];
  constraints?: Record<string, unknown>;
}

export interface Delegation {
  id: string;
  issuer: string;
  subject: string;
  scope: DelegationScope;
  status: "active" | "revoked" | "expired";
  issuedAt: string;
  expiresAt?: string;
}

export interface Policy {
  id: string;
  kind: string;
  version: number;
  scope: Record<string, unknown>;
  rules: Record<string, unknown>;
}

export interface AgentAuthority {
  agentId: string;
  activeDelegations: Delegation[];
  policySummary: Policy[];
}

export const ECONOMIC_ACTION_STATUSES = [
  "created",
  "pending_approval",
  "authorized",
  "rejected",
  "executing",
  "confirmed",
  "failed",
  "reversed",
] as const;
export type EconomicActionStatus = (typeof ECONOMIC_ACTION_STATUSES)[number];

export interface PolicyEvaluation {
  allowed: boolean;
  reasons: string[];
  approvalsRequired: string[];
}

export interface EconomicAction {
  id: string;
  principalId: string;
  agentId: string;
  agentInstanceId?: string | null;
  intent: Record<string, unknown>;
  capability: string;
  counterparty?: Record<string, unknown> | null;
  authority: { delegationId: string; policySnapshot: { id: string; version: number }[] };
  policyEvaluation?: PolicyEvaluation | null;
  executionPlan?: Record<string, unknown> | null;
  approval?: Record<string, unknown> | null;
  execution?: Record<string, unknown> | null;
  status: EconomicActionStatus;
  result?: Record<string, unknown> | null;
  needsReconciliation: boolean;
  createdAt: string;
}

/**
 * Who the agent would transact with. Only the id: AdaSouls computes the
 * counterparty's record (completed transactions, disputes) from receipts;
 * anything a caller claims about it would be ignored.
 */
export interface CounterpartyRef {
  id: string;
}

export interface ExecuteInput {
  capability: string;
  amount?: string;
  asset?: string;
  to?: string;
  detail?: Record<string, unknown>;
  counterparty?: CounterpartyRef;
  /** Resolved automatically via GET /agents/:id/authority when omitted -- see Agent.execute()'s doc comment. */
  delegationId?: string;
  idempotencyKey?: string;
  /** Block until the action reaches a terminal state before resolving. Default false (matches REPOSITORY.md's "leaning non-blocking by default"). */
  wait?: boolean;
}

export interface CheckPolicyInput {
  capability: string;
  amount?: string;
  asset?: string;
  to?: string;
  detail?: Record<string, unknown>;
  counterparty?: CounterpartyRef;
}

export interface TestConnectionInput {
  /** What this runtime calls itself, e.g. "treasury-bot@prod". Shown to the agent's owners; never used to decide anything. */
  runtime: string;
  /** Defaults to the first capability of the agent's first active delegation. */
  capability?: string;
  /** Defaults to "USDC". */
  asset?: string;
}

export interface TestConnectionResult {
  ok: boolean;
  /** Why the test failed, in the order the checks run. Empty when ok. */
  reasons: string[];
  checks: { credential: boolean; authority: boolean; policies: boolean };
  /** The simulated action recorded for this test, when one was created. */
  economicActionId: string | null;
  /** This runtime's AgentInstance, when the test passed. */
  instanceId: string | null;
  /** The agent's lifecycle status after the test. */
  status: string;
}

export interface ListEconomicActionsOptions {
  cursor?: string;
  limit?: number;
}

export interface ListEconomicActionsResult {
  items: EconomicAction[];
  nextCursor?: string;
}
