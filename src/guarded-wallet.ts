import type { Agent } from "./agent.js";
import type { EconomicActionHandle, WaitOptions } from "./economic-action-handle.js";
import { AdaSoulsError } from "./errors.js";
import type { CounterpartyRef, EconomicAction, HireInput, MarketplaceJob, PaymentInstruction } from "./types.js";

/**
 * Sends one payment with the agent's own wallet and returns its
 * transaction hash. This is the only place the raw wallet is used: write
 * it once, around your signer, and hand the agent's tools a
 * GuardedWallet instead of the signer.
 */
export type SendPayment = (payment: Readonly<PaymentInstruction>) => Promise<string>;

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
}

export interface Paid {
  /** The action in its latest state: confirmed when `wait` is on and the payment checked out. */
  action: EconomicAction;
  /** The transaction this wallet sent; null when AdaSouls executes the agent's payments itself. */
  txHash: string | null;
}

/** The authorization came back different from what was asked for: nothing was sent. */
export class GuardedWalletMismatchError extends AdaSoulsError {
  constructor(message: string, readonly economicActionId: string) {
    super(message);
  }
}

/**
 * The payment was sent but reporting it failed. The money moved: don't
 * pay again. Call `wallet.report(economicActionId, txHash)` to finish.
 */
export class PaymentNotReportedError extends AdaSoulsError {
  constructor(message: string, readonly economicActionId: string, readonly txHash: string) {
    super(message);
  }
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
/** "10", "10.0" and "10.00" are the same amount. */
const sameAmount = (a: string, b: string) => {
  const norm = (s: string) => (s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s).replace(/^0+(?=\d)/, "");
  return norm(a.trim()) === norm(b.trim());
};

/**
 * The agent's wallet, with ALMA in front of it.
 *
 * Every payment is authorized by AdaSouls first (the agent's delegation,
 * its limits, its counterparty rules), and what is then sent is exactly
 * what was authorized: the amount, the asset, the recipient and the
 * chain come from the authorization, never from the caller. The payment
 * is reported right after, and AdaSouls checks it on-chain.
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
  /** Authorizations already paid by this wallet, with their transaction: one authorization is never paid twice. */
  private readonly sent = new Map<string, string>();
  private readonly wait: boolean;

  constructor(
    private readonly agent: Agent,
    private readonly send: SendPayment,
    private readonly options: GuardedWalletOptions = {}
  ) {
    this.wait = options.wait ?? true;
  }

  /**
   * Pays, if the agent is allowed to. Throws AdaSoulsPolicyError when its
   * rules refuse, and AdaSoulsApprovalPending when a person must approve
   * first (nothing is sent; call `resume` with the action's id once they
   * have).
   */
  async pay(input: PayInput): Promise<Paid> {
    const handle = await this.agent.execute({ capability: "pay", ...input });
    return this.settle(handle, { amount: input.amount, asset: input.asset, to: input.to });
  }

  /** Hires a listed agent and pays its listed price. The job's result comes from `agent.waitForJob(job.id)`. */
  async hire(listingId: string, input: HireInput): Promise<Paid & { job: MarketplaceJob }> {
    const { job, action } = await this.agent.hire(listingId, input);
    // The price is the listing's, set by the seller: what must match is what the job says was agreed.
    return { job, ...(await this.settle(action, { amount: job.price.amount, asset: job.price.asset })) };
  }

  /** Continues an action that was waiting for approval, or one whose payment wasn't made yet. */
  async resume(economicActionId: string): Promise<Paid> {
    const handle = await this.agent.action(economicActionId);
    const intent = handle.action.intent as { amount?: string; asset?: string; to?: string };
    return this.settle(handle, { amount: intent.amount, asset: intent.asset });
  }

  /** Reports a payment this wallet sent, after a PaymentNotReportedError. */
  async report(economicActionId: string, txHash: string): Promise<Paid> {
    const handle = await this.agent.reportPayment(economicActionId, txHash);
    this.sent.set(economicActionId, txHash);
    return { action: this.wait ? await handle.wait(this.options.waitOptions) : handle.action, txHash };
  }

  private async settle(handle: EconomicActionHandle, asked: { amount?: string; asset?: string; to?: string }): Promise<Paid> {
    const id = handle.action.id;
    const already = this.sent.get(id);
    if (already) return this.report(id, already);

    const payment = handle.payment;
    // AdaSouls executes this agent's payments, or it is already paid: there is nothing for this wallet to send.
    if (!payment) return { action: this.wait ? await handle.wait(this.options.waitOptions) : handle.action, txHash: null };

    const off =
      asked.amount !== undefined && !sameAmount(asked.amount, payment.amount)
        ? `amount ${payment.amount}, asked for ${asked.amount}`
        : asked.asset !== undefined && !same(asked.asset, payment.asset)
          ? `asset ${payment.asset}, asked for ${asked.asset}`
          : asked.to !== undefined && !same(asked.to, payment.to)
            ? `recipient ${payment.to}, asked for ${asked.to}`
            : null;
    if (off) throw new GuardedWalletMismatchError(`the authorization for ${id} isn't what was asked for (${off}); nothing was sent`, id);

    const txHash = await this.send(Object.freeze({ ...payment }));
    if (typeof txHash !== "string" || txHash.trim() === "") throw new AdaSoulsError(`the wallet returned no transaction hash for ${id}; check whether it sent before retrying`);
    this.sent.set(id, txHash);
    try {
      await handle.reportPayment(txHash);
    } catch (err) {
      throw new PaymentNotReportedError(`the payment for ${id} was sent (${txHash}) but reporting it failed: ${err instanceof Error ? err.message : String(err)}`, id, txHash);
    }
    return { action: this.wait ? await handle.wait(this.options.waitOptions) : handle.action, txHash };
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
