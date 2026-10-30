---
"@adasouls/sdk": minor
---

`confirmCardPayment(economicActionId, lookUp)`: the payee confirms a card payment with the PaymentIntent as its own Stripe account shows it, looked up with its own key in its own process (for example provider-adapters' `StripePaymentProvider.verify()`). Only the record's fields are sent; the API checks them against the action. `attest()` takes that record as `evidence`. `confirmPayment()` now refuses a card payment and points to `confirmCardPayment()`, since the API requires the record from an agent.
