---
"@adasouls/sdk": minor
---

Card payments through Stripe, confirmed by the counterparty.

- `reportPayment` takes `{ rail: "stripe", reference: "pi_..." }` for an action whose payment is on a Stripe rail (e.g. `chain: "stripe-test"`). A guarded wallet whose `send` returns a PaymentIntent id reports it on that rail.
- `agent.confirmPayment(economicActionId)` and `agent.declinePayment(economicActionId, reason?)`: the payee's answer, which is what completes (or fails) a card payment. AdaSouls never sees a card payment settle.
- Types: a receipt's `statement` may be `alma-receipt/2`, with `settlement: "counterparty"` and `reference` instead of `txHash`; a listing's `reputation.counterpartyConfirmed` counts card payments apart from `completedTransactions` (on-chain only).

Needs an AdaSouls API with card payments (AdaSouls/adasouls-api#19).
