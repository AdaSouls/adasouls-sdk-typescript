# @adasouls/sdk

TypeScript SDK for [AdaSouls](https://github.com/AdaSouls): a typed client
over the AdaSouls REST API that gives agent runtimes a domain-verb API —
`agent.execute({ capability: "pay", ... })`, never a raw provider call.
Identities follow the [ALMA](https://github.com/AdaSouls/alma) protocol.

Zero runtime dependencies (just the platform `fetch`). MIT licensed.

```bash
npm install @adasouls/sdk
```

> **No hosted API yet.** The default `baseUrl` is
> `https://api.adasouls.io/v1`, which is not live. Until it is, point the
> SDK at your own `adasouls-api` with `baseUrl`.

## Usage

```ts
import { AdaSouls } from "@adasouls/sdk";

const adasouls = new AdaSouls({
  apiKey: process.env.ADASOULS_API_KEY!, // an agent key: acts as this agent only
  baseUrl: "http://localhost:3000/v1",
});
const agent = adasouls.agent("alma:main:agent:treasury");

await agent.identity();
await agent.reputation();
await agent.authority();

// Would this be allowed right now? Nothing is created.
await agent.checkPolicy({ capability: "pay", amount: "10", asset: "USDC", counterparty: { id: "alma:main:agent:vendor" } });

// delegationId is resolved from an active delegation covering "pay";
// pass one explicitly to skip that lookup.
const handle = await agent.execute({
  capability: "pay",
  amount: "10",
  asset: "USDC",
  to: "0x…",
  counterparty: { id: "alma:main:agent:vendor" },
});
const settled = await handle.wait(); // or: agent.execute({ ..., wait: true })

await agent.history();
```

**Counterparty is an id only.** The API computes the counterparty's record
(completed transactions, disputes) from receipts, and the agent's daily
spend from its own actions — anything a caller claims about them is
ignored.

## Errors

Every failure maps to a typed error, never a raw HTTP error:
`AdaSoulsAuthError`, `AdaSoulsPolicyError` (with `reasons`),
`AdaSoulsApprovalPending`, `AdaSoulsProviderError`,
`AdaSoulsValidationError`, `AdaSoulsRateLimitError`, and
`AdaSoulsNoDelegationError` (no active delegation covers the capability).

## Development

```bash
npm install
npm run lint
npm run build
npm test    # mocked/contract suite
```

To also run the integration suite (`test/integration.test.ts`) against a
local `adasouls-api`: run its `create-sdk-test-fixture` script, then

```bash
ADASOULS_API_URL="http://localhost:3000/v1" \
ADASOULS_TEST_API_KEY="ak_..." \
ADASOULS_TEST_AGENT_ID="alma:main:agent:..." \
npm test
```

Releases use [changesets](https://github.com/changesets/changesets): add
one with `npx changeset`; merging to `main` opens a "Version Packages" PR,
and merging that publishes to npm with provenance.

Code comments cite AdaSouls design documents (`REPOSITORY.md`, `ADR-NNN`)
that are not published yet; the tests are the precise specification.

## Not built yet

Marketplace methods (`agent.hire()`, `adasouls.marketplace.search()`).

## Security

Please report vulnerabilities privately — see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
