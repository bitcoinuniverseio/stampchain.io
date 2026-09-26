# Stampchain API

The public REST API for Bitcoin Stamps. This document covers the things you need before your
first request: where the contract lives, how versioning works, authentication, rate limits, and
what is deliberately not public.

For the endpoint list itself, read the OpenAPI document. Do not read this page instead of it.

| Surface | Where |
| --- | --- |
| Machine-readable contract | [`schema.yml`](../schema.yml) at the repository root, OpenAPI 3.0.3 |
| Browsable documentation | `/docs` on a running instance, or [stampchain.io/docs](https://stampchain.io/docs) |
| Base URL | `https://stampchain.io` |

`static/swagger/openapi.yml` is a symlink to `schema.yml`. It exists so the bundled Swagger UI
can find the document at a conventional path. Point tooling at `schema.yml`, not at the symlink:
a Git-based consumer that reads the symlink path out of the tree gets the string
`../../schema.yml`, not YAML.

## The contract is enforced at runtime

`schema.yml` is not decoration. `routes/api/_middleware.ts` runs it twice on every API request:

1. **Request validation** before the handler. A request that violates the schema is rejected
   with a 400 and the validation detail.
2. **Response validation** after the handler, alongside version transformation.

Both passes are skipped when `OPENAPI_VALIDATION_DISABLED=true`.

The practical consequence: **an inaccurate `schema.yml` breaks the API, not just the docs.** If
you add or change an endpoint, change the schema in the same commit.

## Versioning

All public endpoints live under `/api/v2/`. Version negotiation is handled by
`server/middleware/apiVersionMiddleware.ts` and response shaping by
`server/middleware/schemaTransformer.ts`, so a single handler can serve more than one response
shape. `GET /api/v2/versions` and `GET /api/v2/versions/changelog` report what is available.

There is no `/api/v1`. A request to an unrecognised path under `/api/v2/` is answered by
`routes/api/v2/[...path].ts` with a structured 404 rather than an HTML error page.

## Authentication

Authentication is by API key in the `X-API-Key` header.

**A key is optional.** Anonymous requests are served, at lower rate limits. The
`security` block in `schema.yml` declares `ApiKeyAuth` globally, which reads stricter than the
implementation actually is.

Get a free key by posting an email address to `POST /api/v2/keys`. Signup itself is limited to
3 attempts per IP per hour. `GET /api/v2/keys/usage` reports consumption against the key's
daily quota.

Three tiers exist in `server/middleware/rateLimiter.ts`:

| Tier | Behaviour |
| --- | --- |
| Anonymous | Per-IP limits below. Exceeding a limit blocks that IP for 30 seconds. |
| Free (registered key) | Higher per-key limits, no blocking, plus a daily quota. Exceeding the daily quota returns 429 with `Retry-After: 3600`. |
| Partner | Rate limiting bypassed entirely. |

Client IP is taken from `CF-Connecting-IP`, then `X-Forwarded-For`, then `X-Real-IP`.

## Rate limits

Limits are per minute, matched against the longest path prefix.

| Path prefix | Anonymous | Free key |
| --- | --- | --- |
| `/api/v2/src20` | 60 | 300 |
| `/api/v2/stamps` | 100 | 480 |
| `/api/v2/blocks` | 120 | 600 |
| `/api/v2` (everything else) | 150 | 600 |

SRC-20 is the strictest tier because its queries are the heaviest against the database.

Every response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`.
A 429 also carries `Retry-After` in seconds.

Rate limit counters live in Redis. **The limiter fails open**: if Redis is unreachable the
request is served rather than rejected. Do not treat rate limiting as a security control.

## What is covered

The contract declares 55 paths across 13 tags:

| Tag | Paths |
| --- | --- |
| Stamps | 15 |
| SRC-20 | 13 |
| SRC-101 | 11 |
| Balance | 6 |
| System | 5 |
| Collections, Cursed Stamps, Dispensers | 3 each |
| Blocks, Minting, API Keys | 2 each |
| Documentation, UTXO | 1 each |

**SRC-101 is live, not in development.** Eleven paths serve deploys, mints, token lookups,
per-address balances, and transaction lookups.

Around 17 route files under `routes/api/v2/` are not in the contract. Most are transaction
construction and composition helpers (`/create/*`, `/trx/*`, `/olga/estimate`,
`/fairmint/*`, `/src20/multisig/*`) plus a few lookups (`/src20/search`,
`/collections/by-name/{name}`, `/utxo/ancestors/{address}`). They work, but they are not
covered by the contract, are not validated by the middleware, and may change without a version
bump. Treat only what is in `schema.yml` as the public API.

## What is not public

`routes/api/internal/` holds 20 routes that back the site's own front end: fee estimation,
BTC price, carousel data, CSRF tokens, cache purges, monitoring, and connection pool controls.
They are gated by `InternalApiFrontendGuard.requireInternalAccess` and are deliberately absent
from `schema.yml`. Do not build against them.

`routes/api/proxy/` holds two pass-through proxies used by the front end for external content.
Also not part of the public API.

## Errors

Error responses are produced by `ApiResponseUtil` in
`lib/utils/api/responses/apiResponseUtil.ts`, so shape is consistent across endpoints. The
`schema.yml` `components/responses` section declares `BadRequest`, `NotFound`, and
`InternalServerError` and endpoints reference them.

| Status | Cause |
| --- | --- |
| 400 | Request failed OpenAPI validation, or a handler rejected a parameter. |
| 404 | Unknown path under `/api/v2/`, or a resource that does not exist. |
| 429 | Rate limit or daily quota exceeded. Read `Retry-After`. |
| 500 | Handler error. |

## Data source

This service does not index the chain. It reads a MySQL database populated by the
[Bitcoin Stamps indexer](https://github.com/bitcoinuniverseio/btc_stamps), and its database user
is expected to be read-only. Anything about how a transaction became a stamp, which activation
height applies, or why a mint was clamped is answered by the indexer's
[consensus reference](https://github.com/bitcoinuniverseio/btc_stamps/blob/main/docs/CONSENSUS.md),
not here.

The indexer notifies this service on new blocks and reorgs through the webhook at
`/api/internal/bitcoinNotifications` so caches can be invalidated.

## Working on the contract

```sh
npm run validate:schema       # redocly lint against schema.yml (the real validator)
deno task test:api:schema     # scripts/validate-openapi-schema.sh
deno task test:api:contracts  # Newman contract tests, needs Docker
deno task check               # deno fmt --check, deno lint, deno check
```

`deno task validate` chains the full gate, including `npm run validate:schema`.

CI runs `api-schema-validation.yml` and `schema-validation.yml` on the contract, and
`newman-comprehensive-tests.yml` against the running API.
