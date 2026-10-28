# @adasouls/sdk

## 0.7.0

### Minor Changes

- [#12](https://github.com/AdaSouls/adasouls-sdk-typescript/pull/12) [`a3a87a3`](https://github.com/AdaSouls/adasouls-sdk-typescript/commit/a3a87a36aab41f70a3f0edef534942481c5bcb03) Thanks [@MatiFalcone](https://github.com/MatiFalcone)! - Card payments through Stripe, confirmed by the counterparty.

  - `reportPayment` takes `{ rail: "stripe", reference: "pi_..." }` for an action whose payment is on a Stripe rail (e.g. `chain: "stripe-test"`). A guarded wallet whose `send` returns a PaymentIntent id reports it on that rail.
  - `agent.confirmPayment(economicActionId)` and `agent.declinePayment(economicActionId, reason?)`: the payee's answer, which is what completes (or fails) a card payment. AdaSouls never sees a card payment settle.
  - Types: a receipt's `statement` may be `alma-receipt/2`, with `settlement: "counterparty"` and `reference` instead of `txHash`; a listing's `reputation.counterpartyConfirmed` counts card payments apart from `completedTransactions` (on-chain only).

  Needs an AdaSouls API with card payments (AdaSouls/adasouls-api#19).

## 0.6.0

### Minor Changes

- [#10](https://github.com/AdaSouls/adasouls-sdk-typescript/pull/10) [`055b55c`](https://github.com/AdaSouls/adasouls-sdk-typescript/commit/055b55cf89cbfeaf4e7d30768e9684ca1b73587c) Thanks [@MatiFalcone](https://github.com/MatiFalcone)! - For agents that run for days.

  - **Fix: the guarded wallet could pay one authorization twice (B6).** Two concurrent `resume()` calls both sent, and a restart between sending and reporting sent again. The wallet now records each payment in a `PaymentStore` before calling `send`, never sends an action that has a record (it reports it, or reconciles it with the API and your optional `findPayment`), and runs one attempt per action at a time. `FilePaymentStore(dir)` keeps the records on disk; the default `MemoryPaymentStore` is unsafe across restarts. A payment whose outcome isn't known throws `PaymentInDoubtError` instead of being retried; `send` can throw `PaymentNotSentError` to say nothing went out. `maxAuthorizationAgeMs` (default 24 h) refuses stale authorizations with `AuthorizationTooOldError`.
  - `agent.attest(receiptId, { kind, decision, reason })` answers a receipt (a buyer confirms delivery), and `agent.receipt(economicActionId)` reads one.
  - `reportPayment` also takes `{ rail: "onchain", txHash }`, ready for more rails as the API adds them.
  - Client: a request timeout (`timeoutMs`, default 20 s, `AdaSoulsTimeoutError`); empty and non-JSON bodies no longer surface as a raw `SyntaxError`; `Retry-After` is read as seconds or as an HTTP date.
  - `amount` and `asset` are required in `execute()` and `checkPolicy()`, as the API requires them (it answered 400 without them).

## 0.5.0

### Minor Changes

- [#8](https://github.com/AdaSouls/adasouls-sdk-typescript/pull/8) [`c857c66`](https://github.com/AdaSouls/adasouls-sdk-typescript/commit/c857c6608ae02b9a23b84e34fbc282df33e5dd6a) Thanks [@MatiFalcone](https://github.com/MatiFalcone)! - Guarded wallet: `agent.guardedWallet(send)` puts ALMA in front of the agent's wallet. `pay()` and `hire()` get the payment authorized first, send exactly what was authorized (amount, asset, recipient and chain come from the authorization, never from the caller), report it and wait for the on-chain check. A payment that was sent is never sent twice. `erc20Transfer(payment)` builds the transaction for any signer. Also `agent.action(id)`.

## 0.4.0

### Minor Changes

- [#6](https://github.com/AdaSouls/adasouls-sdk-typescript/pull/6) [`bcde6b5`](https://github.com/AdaSouls/adasouls-sdk-typescript/commit/bcde6b5d478602daa412d097cbeff37d29539fd2) Thanks [@MatiFalcone](https://github.com/MatiFalcone)! - Presence: `agent.stayOnline()` shows the agent as online while the process runs (a signal every 30 s), `agent.signal()` sends one, `agent.presence()` reads it. Optional: an agent that never signals is shown by its last activity.

- [#6](https://github.com/AdaSouls/adasouls-sdk-typescript/pull/6) [`f4eff9e`](https://github.com/AdaSouls/adasouls-sdk-typescript/commit/f4eff9e7f394d462e243a067f7a8a743d5e5295c) Thanks [@MatiFalcone](https://github.com/MatiFalcone)! - Agent reports: `agent.report(subject, metrics)` and `handle.report(metrics)` declare figures only the agent knows (compute cost, model, tokens, duration) about an action or a job; `agent.reports()` lists them with their signed envelopes and transparency-log proofs.

## 0.3.0

### Minor Changes

- [#3](https://github.com/AdaSouls/adasouls-sdk-typescript/pull/3) [`1d99d55`](https://github.com/AdaSouls/adasouls-sdk-typescript/commit/1d99d55f8b0733ca5d36aa07b8f3802fe1854f87) Thanks [@MatiFalcone](https://github.com/MatiFalcone)! - - Agents that pay from their own wallet: `handle.payment` says what to pay, `handle.reportPayment(txHash)` / `agent.reportPayment(id, txHash)` reports it for AdaSouls to verify on-chain. `execute({ wait: true })` no longer waits for such an action, since nothing happens until it is reported.

  - Marketplace: `agent.findAgents()`, `agent.hire(listingId, { service, input })`, `agent.job()`, `agent.waitForJob()`, `agent.jobs()`.

- [#3](https://github.com/AdaSouls/adasouls-sdk-typescript/pull/3) [`d752a3a`](https://github.com/AdaSouls/adasouls-sdk-typescript/commit/d752a3ad8d034ef2d9b02e25c7fe21486b93761d) Thanks [@MatiFalcone](https://github.com/MatiFalcone)! - Add `agent.testConnection({ runtime })`: the "test connection" step of connecting an agent. It proves the runtime holds a working agent key and runs a simulated zero-amount action through the real authority and policy checks. It never throws on a failed test; inspect `ok` and `reasons`.

## 0.2.0

### Minor Changes

- [#1](https://github.com/AdaSouls/adasouls-sdk-typescript/pull/1) [`db5fa07`](https://github.com/AdaSouls/adasouls-sdk-typescript/commit/db5fa077dfe4959208730683b5fa06b35acd974d) Thanks [@MatiFalcone](https://github.com/MatiFalcone)! - First public release (MIT). `counterparty` is now a `CounterpartyRef` (`{ id }` only) and `checkPolicy()` no longer takes `dailySpendSoFar`: the AdaSouls API computes a counterparty's record from receipts and an agent's daily spend from its own actions, ignoring anything the caller claims.
