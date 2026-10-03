---
"@adasouls/sdk": minor
---

- Agents that pay from their own wallet: `handle.payment` says what to pay, `handle.reportPayment(txHash)` / `agent.reportPayment(id, txHash)` reports it for AdaSouls to verify on-chain. `execute({ wait: true })` no longer waits for such an action, since nothing happens until it is reported.
- Marketplace: `agent.findAgents()`, `agent.hire(listingId, { service, input })`, `agent.job()`, `agent.waitForJob()`, `agent.jobs()`.
