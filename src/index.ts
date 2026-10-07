import { AdaSoulsClient, type AdaSoulsClientOptions } from "./client.js";
import { Agent } from "./agent.js";

export { AdaSoulsClient } from "./client.js";
export { Agent } from "./agent.js";
export { EconomicActionHandle } from "./economic-action-handle.js";
export { GuardedWallet, GuardedWalletMismatchError, PaymentNotReportedError, erc20Transfer } from "./guarded-wallet.js";
export type { Erc20TransferCall, GuardedWalletOptions, Paid, PayInput, SendPayment } from "./guarded-wallet.js";
export * from "./errors.js";
export * from "./types.js";

/**
 * `const adasouls = new AdaSouls({ apiKey })`, per 06-api-contracts.md.
 * Everything else hangs off `.agent(agentId)`.
 */
export class AdaSouls {
  private readonly client: AdaSoulsClient;

  constructor(options: AdaSoulsClientOptions) {
    this.client = new AdaSoulsClient(options);
  }

  agent(agentId: string): Agent {
    return new Agent(this.client, agentId);
  }
}
