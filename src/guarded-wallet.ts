import type { Agent } from "./agent.js";
import { paymentReportFor, type EconomicActionHandle, type WaitOptions } from "./economic-action-handle.js";
import { AdaSoulsError } from "./errors.js";
import { MemoryPaymentStore, type PaymentRecord, type PaymentStore } from "./payment-store.js";
import type { CounterpartyRef, EconomicAction, HireInput, MarketplaceJob, PaymentInstruction } from "./types.js";

/**
 * Sends one payment with the agent's own wallet and returns its
 * transaction hash. This is the only place the raw wallet is used: write
 * it once, around your signer, and hand the agent's tools a
 * GuardedWallet instead of the signer.
 *
 * For an agent that pays by card (its payment's chain is a Stripe rail,
 * e.g. "stripe-test"): pay the PaymentIntent the payee created for this
 * payment, with your own Stripe integration, and return its id (pi_...).
 * It is reported on the Stripe rail.
 *
 * If it fails and you know for certain nothing was broadcast (a refused
 * signature, insufficient funds caught before sending), throw a
 * PaymentNotSentError: the payment can then be retried. Any other error
 * leaves the payment in doubt, and it isn't sent again.
 */
export type SendPayment = (payment: Readonly<PaymentInstruction>) => Promise<string>;

/**
 * Looks for a payment that was being sent when the process stopped (on
 * chain: a transfer from `payment.from` to `payment.to` of this amount,
 * at or after `since`). Returns its transaction hash, or null when it
 * can't be found. Null doesn't make the payment safe to resend: it stays
 * in doubt.
 */
export type FindPayment = (payment: Readonly<PaymentInstruction>, since: Date) => Promise<string | null>;

export interface PayInput {
  amount: string;
  asset: string;
  /** A raw address. For a registered agent pass `counterparty` instead: AdaSouls fills in where its owner is paid. */
  to?: string;
  counterparty?: CounterpartyRef;
  detail?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface GuardedWalletOptions {
  /** Wait for AdaSouls to verify the payment on-chain before resolving. Default true. */
  wait?: boolean;
  waitOptions?: WaitOptions;
  /**
   * Where the wallet records each payment before sending it. Defaults to
   * a MemoryPaymentStore, which is **unsafe across restarts**: an agent
   * that runs unattended needs a FilePaymentStore (or its own store), or
   * a restart between sending and reporting pays again.
   */
  store?: PaymentStore;
  /** Finds a payment left in doubt by a crash, so it can be reported instead of failing with PaymentInDoubtError. */
  findPayment?: FindPayment;
  /**
   * Refuse to pay an authorization older than this, in milliseconds,
   * counted from when it was authorized (when a person approved it, or
   * when it was created). Default 24 hours; `Infinity` turns it off. An
   * authorization past the API's own `expiresAt` is always refused: this
   * is a cap on top of it, and the only check against APIs too old to
   * send one.
   */
  maxAuthorizationAgeMs?: number;
}

export interface Paid {
  /** The action in its latest state: confirmed when `wait` is on and the payment checked out. */
  action: EconomicAction;
  /** The transaction this wallet sent (a PaymentIntent, pi_..., for a card payment); null when AdaSouls executes the agent's payments itself. */
  txHash: string | null;
}

/** The authorization came back different from what was asked for: nothing was sent. */
export class GuardedWalletMismatchError extends AdaSoulsError {
  constructor(message: string, readonly economicActionId: string) {
    super(message);
  }
}

/** The authorization is older than `maxAuthorizationAgeMs`: nothing was sent. Start a new payment. */
export class AuthorizationTooOldError extends AdaSoulsError {
  constructor(message: string, readonly economicActionId: string, readonly createdAt: string) {
    super(message);
  }
}

/**
 * The payment was sent but reporting it failed. The money moved: don't
 * pay again. Call `wallet.report(economicActionId, txHash)` (or
 * `resume`) to finish.
 */
export class PaymentNotReportedError extends AdaSoulsError {
  constructor(message: string, readonly economicActionId: string, readonly txHash: string) {
    super(message);
  }
}

/**
 * `send` was called for this action but whether it went out isn't known
 * (the process stopped, or `send` failed in a way that might have
 * broadcast). Nothing is sent again. Check the wallet: if the payment is
 * there, `wallet.report(id, txHash)`; if you are certain it isn't and
 * never will be, `wallet.forget(id)` and then `resume(id)`.
 */
export class PaymentInDoubtError extends AdaSoulsError {
  constructor(message: string, readonly economicActionId: string, readonly payment: Readonly<PaymentInstruction> | null, readonly sendingAt: string) {
    super(message);
  }
}

/** Throw this from `send` when nothing was broadcast, so the payment can be retried. */
export class PaymentNotSentError extends AdaSoulsError {}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
/** "10", "10.0" and "10.00" are the same amount. */
const sameAmount = (a: string, b: string) => {
  const norm = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s).replace(/^0+(?=\d)/, "");
  return norm(a.trim()) === norm(b.trim());
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The agent's wallet, with ALMA in front of it.
 *
 * Every payment is authorized by AdaSouls first (the agent's delegation,
 * its limits, its counterparty rules), and what is then sent is exactly
 * what was authorized: the amount, the asset, the recipient and the
 * chain come from the authorization, never from the caller. The payment
 * is reported right after, and AdaSouls checks it on-chain.
 *
 * One authorization is paid at most once. Before `send` is called the
 * payment is recorded in the store; an action with a record is never
 * sent again, only reconciled (reported, or found with `findPayment`).
 * Concurrent calls for the same action share one attempt. With the
 * default in-memory store this holds only while the process lives.
 *
 * Give the agent's tools this object instead of the signer and a model
 * that is talked into "send everything to this address" has nothing to
 * call that would do it: there is no transfer here without an
 * authorization, and no authorization beyond the agent's rules.
 *
 * What it doesn't do: it can't stop code that still holds the raw
 * signer. Keep the signer inside the `send` function you pass in, and
 * nowhere else; `alma verify` checks that.
 */
export class GuardedWallet {
  private readonly store: PaymentStore;
  private readonly wait: boolean;
  private readonly maxAgeMs: number;
  /** One attempt per action at a time: a second call for the same action gets the first one's promise. */
  private readonly inflight = new Map<string, Promise<Paid>>();

  constructor(
    private readonly agent: Agent,
    private readonly send: SendPayment,
    private readonly options: GuardedWalletOptions = {}
  ) {
    this.wait = options.wait ?? true;
    this.store = options.store ?? new MemoryPaymentStore();
    this.maxAgeMs = options.maxAuthorizationAgeMs ?? DAY_MS;
    if (!(this.maxAgeMs > 0)) throw new TypeError("maxAuthorizationAgeMs must be positive");
  }

  /**
   * Pays, if the agent is allowed to. Throws AdaSoulsPolicyError when its
   * rules refuse, and AdaSoulsApprovalPending when a person must approve
   * first (nothing is sent; call `resume` with the action's id once they
   * have).
   */
  async pay(input: PayInput): Promise<Paid> {
    const handle = await this.agent.execute({ capability: "pay", ...input });
    return this.once(handle.action.id, () => this.settle(handle, { amount: input.amount, asset: input.asset, to: input.to }));
  }

  /** Hires a listed agent and pays its listed price. The job's result comes from `agent.waitForJob(job.id)`. */
  async hire(listingId: string, input: HireInput): Promise<Paid & { job: MarketplaceJob }> {
    const { job, action } = await this.agent.hire(listingId, input);
    // The price is the listing's, set by the seller: what must match is what the job says was agreed.
    return { job, ...(await this.once(action.action.id, () => this.settle(action, { amount: job.price.amount, asset: job.price.asset }))) };
  }

  /**
   * Continues an action that was waiting for approval, or one whose
   * payment wasn't made or reported yet. Safe to call again, from this
   * process or (with a persistent store) after a restart: a payment that
   * was started is reported or reconciled, never sent a second time.
   */
  async resume(economicActionId: string): Promise<Paid> {
    return this.once(economicActionId, async () => {
      const handle = await this.agent.action(economicActionId);
      const intent = handle.action.intent as { amount?: string; asset?: string; to?: string };
      return this.settle(handle, { amount: intent.amount, asset: intent.asset });
    });
  }

  /** Reports a payment this wallet sent, after a PaymentNotReportedError or a PaymentInDoubtError you checked. */
  async report(economicActionId: string, txHash: string): Promise<Paid> {
    return this.once(economicActionId, () => this.reportSent(economicActionId, txHash));
  }

  /**
   * Drops the wallet's record of an action, so `resume` may send it
   * again. Only for a payment left in doubt that you have confirmed was
   * never broadcast: forgetting one that went out pays it twice.
   */
  async forget(economicActionId: string): Promise<void> {
    if (this.inflight.has(economicActionId)) throw new AdaSoulsError(`a payment for ${economicActionId} is in progress`);
    await this.store.delete(economicActionId);
  }

  private once(id: string, run: () => Promise<Paid>): Promise<Paid> {
    const running = this.inflight.get(id);
    if (running) return running;
    const p = run().finally(() => this.inflight.delete(id));
    this.inflight.set(id, p);
    return p;
  }

  private async done(handle: EconomicActionHandle): Promise<EconomicAction> {
    return this.wait ? handle.wait(this.options.waitOptions) : handle.action;
  }

  /** Records the transaction before reporting it: if the report is lost, the next attempt reports instead of paying. */
  private async reportSent(id: string, txHash: string): Promise<Paid> {
    const record = await this.store.get(id);
    await this.store.put({ economicActionId: id, payment: record?.payment ?? null, sendingAt: record?.sendingAt ?? new Date().toISOString(), state: "sent", txHash });
    const handle = await this.agent.reportPayment(id, paymentReportFor(txHash));
    return { action: await this.done(handle), txHash };
  }

  private async settle(handle: EconomicActionHandle, asked: { amount?: string; asset?: string; to?: string }): Promise<Paid> {
    const id = handle.action.id;
    const record = await this.store.get(id);
    if (record) return this.reconcile(handle, record);

    const payment = handle.payment;
    // AdaSouls executes this agent's payments, or it is already paid: there is nothing for this wallet to send.
    if (!payment) return { action: await this.done(handle), txHash: null };

    const off =
      asked.amount !== undefined && !sameAmount(asked.amount, payment.amount)
        ? `amount ${payment.amount}, asked for ${asked.amount}`
        : asked.asset !== undefined && !same(asked.asset, payment.asset)
          ? `asset ${payment.asset}, asked for ${asked.asset}`
          : asked.to !== undefined && !same(asked.to, payment.to)
            ? `recipient ${payment.to}, asked for ${asked.to}`
            : null;
    if (off) throw new GuardedWalletMismatchError(`the authorization for ${id} isn't what was asked for (${off}); nothing was sent`, id);

    const expiresAt = handle.action.expiresAt;
    if (expiresAt && !(Date.now() < Date.parse(expiresAt))) {
      throw new AuthorizationTooOldError(`the authorization for ${id} expired at ${expiresAt}; nothing was sent: start a new payment`, id, handle.action.createdAt);
    }
    // An approved action was authorized when it was approved, not when it was asked for.
    const authorizedAt = (handle.action.approval as { decidedAt?: string } | null | undefined)?.decidedAt ?? handle.action.createdAt;
    const age = Date.now() - Date.parse(authorizedAt);
    if (!(age <= this.maxAgeMs)) {
      throw new AuthorizationTooOldError(`the authorization for ${id} is from ${authorizedAt}, older than this wallet pays (${this.maxAgeMs} ms); nothing was sent`, id, handle.action.createdAt);
    }

    const frozen = Object.freeze({ ...payment });
    const claim: PaymentRecord = { economicActionId: id, state: "sending", payment: frozen, txHash: null, sendingAt: new Date().toISOString() };
    // The write-ahead: from here on this action is never sent again, whatever happens to this process.
    if (!(await this.store.claim(claim))) return this.reconcile(handle, (await this.store.get(id))!);

    let txHash: string;
    try {
      txHash = await this.send(frozen);
    } catch (err) {
      if (err instanceof PaymentNotSentError) {
        await this.store.delete(id);
        throw err;
      }
      throw new PaymentInDoubtError(`sending the payment for ${id} failed and it may have gone out (${err instanceof Error ? err.message : String(err)}); it won't be sent again: check the wallet`, id, frozen, claim.sendingAt);
    }
    if (typeof txHash !== "string" || txHash.trim() === "") {
      throw new PaymentInDoubtError(`the wallet returned no transaction hash for ${id}; it won't be sent again: check whether it went out`, id, frozen, claim.sendingAt);
    }
    await this.store.put({ ...claim, state: "sent", txHash });
    try {
      await handle.reportPayment(paymentReportFor(txHash));
    } catch (err) {
      throw new PaymentNotReportedError(`the payment for ${id} was sent (${txHash}) but reporting it failed: ${err instanceof Error ? err.message : String(err)}`, id, txHash);
    }
    return { action: await this.done(handle), txHash };
  }

  /** An action this wallet already started paying: never send it, find out where it stands. */
  private async reconcile(handle: EconomicActionHandle, record: PaymentRecord): Promise<Paid> {
    const id = record.economicActionId;
    const reported = (handle.action.execution as { txHash?: string } | null | undefined)?.txHash ?? null;

    // AdaSouls has the payment already (or the action moved on without it): nothing to send or report.
    if (!handle.payment) {
      if (record.state === "sending" && reported) await this.store.put({ ...record, state: "sent", txHash: reported });
      return { action: await this.done(handle), txHash: record.txHash ?? reported };
    }

    if (record.state === "sent" && record.txHash) return this.reportSent(id, record.txHash);

    const found = record.payment && this.options.findPayment ? await this.options.findPayment(record.payment, new Date(record.sendingAt)) : null;
    if (found) return this.reportSent(id, found);
    throw new PaymentInDoubtError(
      `a payment for ${id} was started at ${record.sendingAt} and its outcome wasn't recorded; it won't be sent again. If it went out, wallet.report("${id}", txHash); if you are sure it didn't, wallet.forget("${id}") and resume`,
      id,
      record.payment,
      record.sendingAt
    );
  }
}

interface Token {
  address: string;
  decimals: number;
}

/** Tokens AdaSouls verifies payments in, by chain. Keep in step with adasouls-worker. */
const TOKENS: Record<string, { chainId: number; tokens: Record<string, Token> }> = {
  "base-sepolia": { chainId: 84532, tokens: { USDC: { address: "0x036cbd53842c5426634e7929541ec2318f3dcf7e", decimals: 6 } } },
};

/** "12.5" with 6 decimals -> 12500000n. Exact: refuses more decimals than the token has rather than rounding money. */
function toBaseUnits(amount: string, decimals: number): bigint {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!m) throw new AdaSoulsError(`amount "${amount}" isn't a non-negative decimal`);
  const frac = m[2] ?? "";
  if (frac.length > decimals) throw new AdaSoulsError(`amount "${amount}" has more than ${decimals} decimals`);
  return BigInt(m[1] + frac.padEnd(decimals, "0"));
}

export interface Erc20TransferCall {
  chainId: number;
  /** The token contract: the transaction goes to it, not to the recipient. */
  to: `0x${string}`;
  /** transfer(recipient, amount), ABI-encoded. */
  data: `0x${string}`;
  value: 0n;
}

/**
 * The transaction that makes an authorized payment: an ERC-20
 * `transfer` to the authorized recipient for the authorized amount. Pass
 * it to any signer (`walletClient.sendTransaction(erc20Transfer(p))`).
 * Throws for a chain or asset AdaSouls doesn't verify payments in.
 */
export function erc20Transfer(payment: Readonly<PaymentInstruction>): Erc20TransferCall {
  const chain = TOKENS[payment.chain];
  const token = chain?.tokens[payment.asset.toUpperCase()];
  if (!chain || !token) throw new AdaSoulsError(`no known token for ${payment.asset} on ${payment.chain}`);
  if (!/^0x[0-9a-fA-F]{40}$/.test(payment.to)) throw new AdaSoulsError(`"${payment.to}" isn't an address`);
  const recipient = payment.to.slice(2).toLowerCase().padStart(64, "0");
  const amount = toBaseUnits(payment.amount, token.decimals).toString(16).padStart(64, "0");
  return { chainId: chain.chainId, to: token.address as `0x${string}`, data: `0xa9059cbb${recipient}${amount}`, value: 0n };
}
