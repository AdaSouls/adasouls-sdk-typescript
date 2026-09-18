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

export interface ExecuteInput {
  capability: string;
  amount?: string;
  asset?: string;
  to?: string;
  detail?: Record<string, unknown>;
  counterparty?: Record<string, unknown>;
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
  counterparty?: Record<string, unknown>;
  dailySpendSoFar?: Record<string, string>;
}

export interface ListEconomicActionsOptions {
  cursor?: string;
  limit?: number;
}

export interface ListEconomicActionsResult {
  items: EconomicAction[];
  nextCursor?: string;
}
