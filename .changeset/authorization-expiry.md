---
"@adasouls/sdk": minor
---

Authorizations expire (AdaSouls/adasouls-api#17): `EconomicAction.expiresAt` says when a self-paid authorization stops being payable, and the guarded wallet refuses to send one past it (`AuthorizationTooOldError`, nothing sent). Its own `maxAuthorizationAgeMs` cap now counts from when the action was authorized (the approval's `decidedAt`), not from when it was asked for, so an action a person approved late is paid.
