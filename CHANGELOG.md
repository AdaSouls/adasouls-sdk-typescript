# @adasouls/sdk

## 0.2.0

### Minor Changes

- [#1](https://github.com/AdaSouls/adasouls-sdk-typescript/pull/1) [`db5fa07`](https://github.com/AdaSouls/adasouls-sdk-typescript/commit/db5fa077dfe4959208730683b5fa06b35acd974d) Thanks [@MatiFalcone](https://github.com/MatiFalcone)! - First public release (MIT). `counterparty` is now a `CounterpartyRef` (`{ id }` only) and `checkPolicy()` no longer takes `dailySpendSoFar`: the AdaSouls API computes a counterparty's record from receipts and an agent's daily spend from its own actions, ignoring anything the caller claims.
