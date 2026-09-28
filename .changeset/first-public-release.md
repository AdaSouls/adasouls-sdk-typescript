---
"@adasouls/sdk": minor
---

First public release (MIT). `counterparty` is now a `CounterpartyRef` (`{ id }` only) and `checkPolicy()` no longer takes `dailySpendSoFar`: the AdaSouls API computes a counterparty's record from receipts and an agent's daily spend from its own actions, ignoring anything the caller claims.
