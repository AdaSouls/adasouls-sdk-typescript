---
"@adasouls/sdk": minor
---

Guarded wallet: `agent.guardedWallet(send)` puts ALMA in front of the agent's wallet. `pay()` and `hire()` get the payment authorized first, send exactly what was authorized (amount, asset, recipient and chain come from the authorization, never from the caller), report it and wait for the on-chain check. A payment that was sent is never sent twice. `erc20Transfer(payment)` builds the transaction for any signer. Also `agent.action(id)`.
