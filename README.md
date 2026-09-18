# @adasouls/sdk

The public AdaSouls TypeScript SDK — a typed client over `adasouls-api`'s
REST surface, giving customer agent runtimes a domain-verb API
(`agent.execute({ capability: "pay", ... })`, never a raw provider call).
See `docs/06-api-contracts.md` in `alma` for the full contract this
mirrors, and `docs/repositories/adasouls-sdk-typescript/REPOSITORY.md`
for the design.

No runtime dependencies — just the platform `fetch`.

## Install

```bash
npm install @adasouls/sdk
```

## Usage

```ts
import { AdaSouls } from "@adasouls/sdk";

const adasouls = new AdaSouls({ apiKey: process.env.ADASOULS_API_KEY! });
const agent = adasouls.agent("alma:main:agent:...");

await agent.identity();
await agent.reputation();
await agent.authority();

// delegationId is resolved automatically from an active delegation that
// covers "pay" -- pass one explicitly to skip that lookup.
const handle = await agent.execute({ capability: "pay", amount: "10", asset: "USDC", to: "agent_456" });
const confirmed = await handle.wait(); // or: agent.execute({ ..., wait: true })
```

Every failure maps to one of the documented error types
(`AdaSoulsAuthError`, `AdaSoulsPolicyError`, `AdaSoulsApprovalPending`,
`AdaSoulsProviderError`, `AdaSoulsValidationError`, `AdaSoulsRateLimitError`,
plus this SDK's own `AdaSoulsNoDelegationError`) — never a raw HTTP error.

## Local development

```bash
npm install
npm run build
npm run lint
npm test
```

`npm test` runs the mocked/contract suite by default. To also run the
real integration suite (`test/integration.test.ts`) against a locally
running `adasouls-api`:

```bash
# in adasouls-api: podman-compose up -d, npm run dev, then:
cd adasouls-api && npm run create-sdk-test-fixture
# copy the printed export lines, then in this repo:
ADASOULS_API_URL="http://localhost:<port>/v1" \
ADASOULS_TEST_API_KEY="ak_..." \
ADASOULS_TEST_AGENT_ID="alma:main:agent:..." \
npm test
```

## Known gaps

- No publish pipeline set up yet (this package is meant for the public
  npm registry, not GitHub Packages like AdaSouls's internal packages —
  a deliberately separate, more sensitive decision than the private-repo
  case, left for the user to set up with their own `NPM_TOKEN`).
- `test/integration.test.ts` doesn't run in CI — no deployed `dev`
  environment exists yet to point it at (Phase 0's ECS pipeline is still
  deferred).
- Marketplace methods (`agent.hire()`, `adasouls.marketplace.search()`)
  are Phase 13 scope, not built here.
