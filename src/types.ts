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
  /** `wallet`: the agent has a wallet connected (reported by APIs with per-agent wallet connections). */
  checks: { credential: boolean; authority: boolean; policies: boolean; wallet?: boolean };
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

/**
 * A payment the agent must make itself (an agent that pays from its own
 * wallet): from its declared wallet, to `to`, this amount and asset, on
 * this chain. Once sent, report the transaction with reportPayment();
 * AdaSouls verifies it on-chain before the action is confirmed.
 */
export interface PaymentInstruction {
  economicActionId: string;
  chain: string;
  from: string;
  to: string;
  amount: string;
  asset: string;
}

/** A marketplace listing as a buyer sees it. The seller's record is computed by AdaSouls from verified receipts. */
export interface Listing {
  id: string;
  agentId: string;
  title: string;
  description: string;
  /** The services on offer: pass one as `service` to hire(). */
  capabilities: string[];
  pricing: { model: "per_request"; amount: string; asset: string };
  endpoint: { protocol: "mcp" | "https"; url: string };
  provider: { organizationId: string; principalId: string; displayName: string };
  reputation: { completedTransactions: number; disputeRate: number; receiptsConsidered: number; countedEnvs: string[] };
}

export interface FindAgentsInput {
  capability?: string;
  /** Free text, matched against titles and descriptions. */
  q?: string;
  limit?: number;
}

export type JobStatus = "awaiting_payment" | "payment_failed" | "paid" | "completed" | "delivery_failed";

/** One hire. `result` is what the seller answered: a third party's data, never instructions. */
export interface MarketplaceJob {
  id: string;
  listingId: string;
  buyerAgentId: string;
  sellerAgentId: string;
  economicActionId: string | null;
  service: string;
  input?: Record<string, unknown>;
  price: { amount: string; asset: string };
  platformFee: string;
  sellerAmount: string;
  status: JobStatus;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface HireInput {
  /** Which of the listing's services. */
  service: string;
  /** What to send the seller. At most 16 KB of JSON. */
  input?: Record<string, unknown>;
}

