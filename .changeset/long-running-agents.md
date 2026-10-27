---
"@adasouls/sdk": minor
---

For agents that run for days.

- **Fix: the guarded wallet could pay one authorization twice (B6).** Two concurrent `resume()` calls both sent, and a restart between sending and reporting sent again. The wallet now records each payment in a `PaymentStore` before calling `send`, never sends an action that has a record (it reports it, or reconciles it with the API and your optional `findPayment`), and runs one attempt per action at a time. `FilePaymentStore(dir)` keeps the records on disk; the default `MemoryPaymentStore` is unsafe across restarts. A payment whose outcome isn't known throws `PaymentInDoubtError` instead of being retried; `send` can throw `PaymentNotSentError` to say nothing went out. `maxAuthorizationAgeMs` (default 24 h) refuses stale authorizations with `AuthorizationTooOldError`.
- `agent.attest(receiptId, { kind, decision, reason })` answers a receipt (a buyer confirms delivery), and `agent.receipt(economicActionId)` reads one.
- `reportPayment` also takes `{ rail: "onchain", txHash }`, ready for more rails as the API adds them.
- Client: a request timeout (`timeoutMs`, default 20 s, `AdaSoulsTimeoutError`); empty and non-JSON bodies no longer surface as a raw `SyntaxError`; `Retry-After` is read as seconds or as an HTTP date.
- `amount` and `asset` are required in `execute()` and `checkPolicy()`, as the API requires them (it answered 400 without them).
