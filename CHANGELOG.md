# @adasouls/sdk

## 0.3.0

### Minor Changes

- [#3](https://github.com/AdaSouls/adasouls-sdk-typescript/pull/3) [`1d99d55`](https://github.com/AdaSouls/adasouls-sdk-typescript/commit/1d99d55f8b0733ca5d36aa07b8f3802fe1854f87) Thanks [@MatiFalcone](https://github.com/MatiFalcone)! - - Agents that pay from their own wallet: `handle.payment` says what to pay, `handle.reportPayment(txHash)` / `agent.reportPayment(id, txHash)` reports it for AdaSouls to verify on-chain. `execute({ wait: true })` no longer waits for such an action, since nothing happens until it is reported.

  - Marketplace: `agent.findAgents()`, `agent.hire(listingId, { service, input })`, `agent.job()`, `agent.waitForJob()`, `agent.jobs()`.

- [#3](https://github.com/AdaSouls/adasouls-sdk-typescript/pull/3) [`d752a3a`](https://github.com/AdaSouls/adasouls-sdk-typescript/commit/d752a3ad8d034ef2d9b02e25c7fe21486b93761d) Thanks [@MatiFalcone](https://github.com/MatiFalcone)! - Add `agent.testConnection({ runtime })`: the "test connection" step of connecting an agent. It proves the runtime holds a working agent key and runs a simulated zero-amount action through the real authority and policy checks. It never throws on a failed test; inspect `ok` and `reasons`.

## 0.2.0

### Minor Changes

- [#1](https://github.com/AdaSouls/adasouls-sdk-typescript/pull/1) [`db5fa07`](https://github.com/AdaSouls/adasouls-sdk-typescript/commit/db5fa077dfe4959208730683b5fa06b35acd974d) Thanks [@MatiFalcone](https://github.com/MatiFalcone)! - First public release (MIT). `counterparty` is now a `CounterpartyRef` (`{ id }` only) and `checkPolicy()` no longer takes `dailySpendSoFar`: the AdaSouls API computes a counterparty's record from receipts and an agent's daily spend from its own actions, ignoring anything the caller claims.
