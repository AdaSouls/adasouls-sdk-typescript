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
  /**
   * When a self-paid authorization stops being payable (24 hours from
   * authorization unless the organization set another window). Past it,
   * AdaSouls ends the action as failed ("authorization expired"). Null:
   * it doesn't expire. Absent from APIs older than authorization expiry.
   */
  expiresAt?: string | null;
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
  /** A decimal amount, e.g. "10.50". Required: every economic action moves money, and the API refuses one without it. */
  amount: string;
  asset: string;
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
  /** Required, as for execute(): a spending limit can't be checked without it. */
  amount: string;
  asset: string;
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

/**
 * How a payment the agent made itself was made, for reportPayment(). A
 * bare string is an on-chain transaction hash, same as
 * `{ rail: "onchain", txHash }`. A card payment (an action whose
 * payment's chain is a Stripe rail, e.g. "stripe-test") is reported by
 * the Stripe PaymentIntent's id: `{ rail: "stripe", reference: "pi_..." }`.
 * It counts once the payee confirms receiving it (confirmPayment()).
 */
export type PaymentReport = { rail: "onchain"; txHash: string } | { rail: "stripe"; reference: string };

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
  /**
   * `completedTransactions` and `disputeRate` are on-chain payments only.
   * `counterpartyConfirmed`: card payments, which rest on the counterparty's
   * word alone, counted apart (absent from APIs older than card payments).
   */
  reputation: { completedTransactions: number; disputeRate: number; receiptsConsidered: number; countedEnvs: string[]; counterpartyConfirmed?: number };
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


/**
 * Figures only the agent knows, which the protocol asks it to report.
 * AdaSouls signs and logs each one as "declared by this agent": it
 * proves what was declared and when, not that it is true -- and a
 * declared figure can't be changed afterwards.
 */
export interface ReportedMetrics {
  /** What the work cost to compute: a decimal amount and a currency code, e.g. { amount: "0.0421", currency: "USD" }. */
  computeCost?: { amount: string; currency: string };
  /** The model that did the work, as its provider names it. */
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
}

/** What a report is about: one of this agent's actions, or a job it was hired for. */
export type ReportSubject = { action: string } | { job: string };

export type ReportMetricName = "compute_cost" | "model" | "input_tokens" | "output_tokens" | "duration_ms";

export interface AgentReport {
  id: string;
  agentId: string;
  about: "action" | "job";
  ref: string;
  metric: ReportMetricName;
  value: string;
  unit: string | null;
  reportedAt: string;
  /** The issuer's signed alma-agent-report/1 envelope; check it offline with @adasouls/alma-core's verifyAgentReport. */
  envelope: unknown;
  /** Its place in the transparency log; index and proof are null until it is sequenced (a few minutes). */
  log: { leafHash: string; index: number | null; proof: string[] | null } | null;
}

export interface AgentReports {
  /** The signed tree head the proofs are against. */
  treeHead: unknown;
  reports: AgentReport[];
}

/** Whether an agent is running, as far as it chooses to say. */
export interface Presence {
  agentId: string;
  /** "signal": the agent sends online signals, so `online` means something. "activity": it never has; show `lastActivityAt`. */
  mode: "signal" | "activity";
  online: boolean;
  lastSignalAt: string | null;
  /** While online: when it stops being so unless another signal arrives. */
  onlineUntil: string | null;
  lastActivityAt: string | null;
}

export interface StayOnlineOptions {
  /** Milliseconds between signals. Default 30000; AdaSouls counts a signal for 90 seconds. */
  intervalMs?: number;
  /** Called when a signal fails. The next one is still sent. */
  onError?: (err: unknown) => void;
}

export type AttestationStatus = "pending" | "confirmed" | "declined";

/**
 * The record of one settled payment between two agents. The payee
 * answers `payment` ("I received it"), the payer `delivery` ("delivered
 * as agreed"); each answer is signed by AdaSouls and logged. Counting
 * uses the signed envelopes, never the status columns.
 */
export interface Receipt {
  id: string;
  economicActionId: string;
  payerId: string;
  payeeId: string;
  env: string;
  /** False when the two organizations share a member: related parties never count as outside vouching. */
  independent: boolean;
  /**
   * alma-core's ReceiptStatement. `alma-receipt/1` is always on-chain
   * (`txHash`); `alma-receipt/2` says its `settlement`: "counterparty" is a
   * card payment named by `reference` (the PaymentIntent), established only
   * by the payee's payment attestation.
   */
  statement: Record<string, unknown> & { v: string; settlement?: "onchain" | "counterparty"; txHash?: string; reference?: string };
  digest: string;
  /** Only your own side's salt is returned; the other is null. */
  payerSalt: string | null;
  payeeSalt: string | null;
  commitment: string | null;
  paymentStatus: AttestationStatus;
  paymentDecidedAt: string | null;
  paymentDecidedBy: "member" | "agent" | null;
  paymentReason: string | null;
  deliveryStatus: AttestationStatus;
  deliveryDecidedAt: string | null;
  deliveryDecidedBy: "member" | "agent" | null;
  deliveryReason: string | null;
  mintSignature: unknown;
  paymentSignature: unknown;
  deliverySignature: unknown;
  createdAt: string;
  /** Where each signed envelope sits in the transparency log, with proofs. Returned by receipt(), not by attest(). */
  log?: unknown;
}

export interface AttestInput {
  /** `delivery` is the payer's (the buyer's) to answer, `payment` the payee's. */
  kind: "payment" | "delivery";
  decision: "confirm" | "decline";
  /** At most 500 characters. */
  reason?: string;
  /** Confirming a card payment: the PaymentIntent as your own Stripe account shows it. Required when an agent confirms one (see Agent.confirmCardPayment). */
  evidence?: StripePaymentRecord;
}

/**
 * A PaymentIntent as the payee's own Stripe account shows it: the shape
 * @adasouls/provider-adapters' StripePaymentProvider.verify() returns.
 * The API checks it against the action before the confirmation counts.
 */
export interface StripePaymentRecord {
  /** The PaymentIntent id (pi_...). */
  reference: string;
  /** Stripe's status; only "succeeded" is accepted. */
  status: string;
  /** Integer, in the currency's smallest unit. */
  amount: number;
  /** Lowercase ISO 4217, e.g. "usd". */
  currency: string;
  /** When Stripe created it, ISO 8601. */
  createdAt: string;
  /** Test mode only. */
  livemode: false;
  /** The PaymentIntent's metadata.action_id: the payer's economic action. */
  actionId?: string;
}

/** Looks a PaymentIntent up in your own Stripe account, with your own key, e.g. `(pi) => new StripePaymentProvider(key).verify(pi)`. */
export type LookUpPaymentIntent = (paymentIntentId: string) => Promise<StripePaymentRecord>;
