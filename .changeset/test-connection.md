---
"@adasouls/sdk": minor
---

Add `agent.testConnection({ runtime })`: the "test connection" step of connecting an agent. It proves the runtime holds a working agent key and runs a simulated zero-amount action through the real authority and policy checks. It never throws on a failed test; inspect `ok` and `reasons`.
